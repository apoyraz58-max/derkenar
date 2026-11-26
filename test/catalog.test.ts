import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadAuthority } from "../src/catalog/authority.js";
import { renderEdition } from "../src/catalog/citation.js";
import { ingestFile } from "../src/catalog/ingest.js";
import { otherVolume, parseEditionNumber, publicationScope, type RecordInput, turkeyPlace, validIsbn } from "../src/catalog/model.js";
import { collectK10plusQuery, collectOzgur, collectOzgurKbart } from "../src/catalog/sources/collect.js";
import { collectCrossref, crossrefParts } from "../src/catalog/sources/crossref.js";
import { itemRecord } from "../src/catalog/sources/files.js";
import { ozgurKbart } from "../src/catalog/sources/kbart.js";
import { marcFile } from "../src/catalog/sources/marc.js";
import { Catalog } from "../src/catalog/store.js";
import { cslJson, formatAs } from "../src/core/exporters.js";
import { parseFile } from "../src/core/importers.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
import { zoteroRdf } from "../src/core/zoteroexport.js";

const root = (file: string) => fileURLToPath(new URL(`../${file}`, import.meta.url));
const readStyle = (file: string) => readFileSync(root(`data/styles/${file}`), "utf8");
const temp = mkdtempSync(join(tmpdir(), "derkenar-catalog-"));
const databases: Catalog[] = [];
const catalog = (file = ":memory:") => {
  const c = new Catalog(file);
  databases.push(c);
  return c;
};
afterEach(() => {
  for (const c of databases.splice(0)) c.close();
});
process.once("exit", () => rmSync(temp, { recursive: true, force: true }));

describe("bibliyografik katalog", () => {
  it("ISBN-10 ve ISBN-13'ü denetler; biçimsel olarak yanlış numarayı reddeder", () => {
    expect(validIsbn("0-8044-2957-X")).toBe("9780804429573");
    expect(validIsbn("978-975-16-0443-9")).toBe("9789751604439");
    expect(validIsbn("9789751604438")).toBeNull();
    expect(validIsbn("8111111111111")).toBeNull();
    expect(validIsbn("0/8044/2957/X")).toBeNull();
  });

  it("baskı numarasını baskı ifadesinden okur", () => {
    const cases: [string, string | undefined][] = [["2", "2"], ["02", "2"], ["2. baskı", "2"], ["Gözden geçirilmiş 2. baskı", "2"],
      ["II. basım", "2"], ["IV. Baskı", "4"], ["ikinci baskı", "2"], ["Üçüncü Basım", "3"], ["3. Aufl.", "3"], ["2nd ed.", undefined],
      ["2. ed.", "2"], ["1. tab'ı", undefined], ["Çapa ewil", undefined], ["Genişletilmiş baskı", undefined], ["2 Editör", undefined],
      ["1. basımevi", undefined], ["", undefined]];
    for (const [value, expected] of cases) expect(parseEditionNumber(value), value).toBe(expected);
  });

  it("aynı ISBN'li ve baskı ifadesi farklı kaydı ayrı baskı olarak tutar", () => {
    const db = catalog();
    const make = (id: string, edition: string, date: string): RecordInput => ({
      id, raw: id, url: `https://example.org/${id}`, creators: [],
      fields: Object.entries({ title: "Ok, Tüfek ve At", ISBN: "9789751604439", place: "Ankara", publisher: "Türk Tarih Kurumu", edition, date })
        .map(([field, value]) => ({ field, value, path: field })),
    });
    db.job("k10plus", "e", "e");
    db.batch("k10plus", "e", 0, [make("a", "1", "2023"), make("b", "Gözden geçirilmiş 2. baskı", "2026"), make("c", "2. baskı", "2026")], true);
    expect(db.stats().counts.editions).toBe(2);
    expect(db.review(0, 10)).not.toContainEqual(expect.objectContaining({ code: "identifier-conflict" }));
    expect(db.details(2)?.validation).toContainEqual(expect.objectContaining({ code: "shared-identifier" }));
  });

  it("ortak ISBN'li takımın farklı ciltlerini ayrı baskı olarak tutar", () => {
    expect(otherVolume("Masonluk Tarihimizde 1920-1924. Cilt 1", "Masonluk Tarihimizde 1920-1924. Cilt 3")).toBe(true);
    expect(otherVolume("Rethinking Mosque Architecture. 01", "Rethinking Mosque Architecture. 02")).toBe(true);
    expect(otherVolume("Sürgünde Muhalefet. 1 (1868-1869)", "Sürgünde Muhalefet. 2 (1869-1870)")).toBe(true);
    expect(otherVolume("Kitap. 01", "Kitap. 1")).toBe(false);
    expect(otherVolume("Bir Kitap. 1", "Başka Kitap. 2")).toBe(false);
    expect(otherVolume("Ok, Tüfek ve At", "Ok, Tüfek ve At")).toBe(false);
    const db = catalog();
    const make = (id: string, title: string): RecordInput => ({ id, raw: id, url: `https://example.org/${id}`, creators: [],
      fields: Object.entries({ title, ISBN: "9789751604439", place: "Ankara", publisher: "TTK" }).map(([field, value]) => ({ field, value, path: field })) });
    db.job("k10plus", "v", "v");
    db.batch("k10plus", "v", 0, [make("a", "Takım. Cilt 1"), make("b", "Takım. Cilt 2"), make("c", "Takım. Cilt 2")], true);
    expect(db.stats().counts.editions).toBe(2);
    expect(db.review(0, 10)).not.toContainEqual(expect.objectContaining({ code: "identifier-conflict" }));
  });

  it("ISBN'siz çift kaydı yalnız ortak OCLC numarası ve uyuşan künyeyle birleştirir", () => {
    const db = catalog();
    const make = (id: string, oclc: string, extra: Record<string, string> = {}): RecordInput => ({ id, raw: id, url: `https://example.org/${id}`,
      creators: [{ creator: { creatorType: "author", lastName: "Kaya", firstName: "Ali" }, path: "100" }],
      fields: Object.entries({ title: "ISBN'siz Kitap", place: "Ankara", publisher: "Yayınevi", date: "1976", OCLC: oclc, ...extra })
        .map(([field, value]) => ({ field, value, path: field })) });
    db.job("k10plus", "o", "o");
    db.batch("k10plus", "o", 0, [make("a", "123"), make("b", "123"), make("c", "999"), make("d", "123", { date: "1980" })], true);
    expect(db.stats().counts.editions).toBe(2);
    expect(db.details(1)?.validation).toContainEqual(expect.objectContaining({ code: "oclc-match" }));
    const review = db.review(0, 10);
    expect(review).toContainEqual(expect.objectContaining({ external_id: "c", code: "possible-duplicate" }));
    expect(review.filter(r => (r as { external_id: string }).external_id === "b")).toEqual([]);
  });

  it("tarihî ve çok yerli yayın yeri yazımlarında Türkiye kapsamını tanır", () => {
    for (const place of ["Konstantinopel", "Constantinople", "Dersaadet", "Der-i Saadet", "Smyrna", "Angora", "İstanbul [u.a.]",
      "Ankara ; Berlin", "Istanbul : Selbstverl.", "Eskişehir", "Istanbul, Turkiye", "Sarıyer/Istanbul", "Kadıköy-Istanbul",
      "Kızılay, Ankara", "Istanbul - Türkiyä", "Imak, Istanbul", "İst[anbul]", "Dersaʿādet (=Der-i Saʿādet) [=İstanbul]",
      "Dersaadet [d.i. İstanbul]", "(Ankara [usw.]", "[Ḳosṭanṭinīye", "Qusṭanṭinīye", "Qośṭandina [Konstantinopel]", "En Smyrnē"]) expect(turkeyPlace(place), place).toBe(true);
    for (const place of ["Berlin", "Wien [u.a.]", "London ; New York", "Kahire", "Paris", "Frankfurt am Main", "Barcelona, Spain", "Garmisch-Partenkirchen", "Van Nuys, Calif.",
      "Nea Smyrnē", "[Chicago:] Field Mus. of Natural History", "Los Angeles"]) expect(turkeyPlace(place), place).toBe(false);
    expect(publicationScope({ place: "Konstantinopel" })).toBe("TR");
    expect(publicationScope({ place: "Berlin ; İstanbul", country: "gw" })).toBe("conflict");
    expect(publicationScope({ place: "Imak, Istanbul", country: "gw" })).toBe("conflict");
    expect(publicationScope({ place: "Berlin", otherPlaces: "İstanbul" })).toBe("TR");
    expect(publicationScope({ place: "Berlin", otherPlaces: "İstanbul", country: "gw" })).toBe("conflict");
    expect(publicationScope({ place: "Berlin", otherPlaces: "Wien" })).toBe("unknown");
  });

  it("pilot anlık görüntüsüne kaldığı satırdan devam eder ve tekrar aktarmaz", async () => {
    const db = catalog(join(temp, "pilot.sqlite"));
    const file = root("data/catalog/pilot/ttk.jsonl");
    expect(await ingestFile(db, "ttk", file, { limit: 2 })).toEqual({ cursor: 2, state: "paused" });
    expect(await ingestFile(db, "ttk", file)).toEqual({ cursor: 7, state: "completed" });
    expect(await ingestFile(db, "ttk", file)).toEqual({ cursor: 7, state: "completed" });
    await ingestFile(db, "asbu", root("data/catalog/pilot/asbu.jsonl"));
    expect(db.stats().counts).toMatchObject({ raw: 8, editions: 7, works: 6 });
    const [six, seven] = db.ids(0, 2);
    expect(six!.work_id).toBe(seven!.work_id);
    expect(db.item(six!.id)?.fields).toMatchObject({ ISBN: "9789751604439", edition: "6", date: "2018", numPages: "117" });
    expect(db.item(seven!.id)?.fields).toMatchObject({ ISBN: "9789751604439", edition: "7", date: "2020" });
    expect(db.details(six!.id)?.evidence).toContainEqual(expect.objectContaining({ field: "numPages", source: "asbu", path: "Tanım / sayfa", selected: 1 }));
  });

  it("ISBN çakışmalarını ve kanıtsız Türkiye kapsamını incelemeye ayırır", () => {
    const db = catalog();
    const make = (id: string, title: string, isbn: string, place = "Ankara"): RecordInput => ({
      id, raw: JSON.stringify({ id, title, isbn, place }), url: `https://example.org/${id}`, creators: [],
      fields: Object.entries({ title, ISBN: isbn, place, date: "2018" }).map(([field, value]) => ({ field, value, path: field })),
    });
    db.job("exchange", "test", "test");
    db.batch("exchange", "test", 0, [
      make("1", "Başlık", "9789751604439"),
      make("2", "Ayrı Eser", "9789751604439"),
      make("3", "Başka Eser", "9789751604438", ""),
    ], true);
    expect(db.stats().counts.editions).toBe(1);
    expect(db.review(0, 25)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "identifier-conflict", target_id: 1 }),
      expect.objectContaining({ code: "scope-unknown" }),
      expect.objectContaining({ code: "invalid-isbn" }),
    ]));
    expect(() => db.batch("exchange", "test", 0, [], true)).toThrow("değiştirildi");
  });

  it("bağımsız MARC adaptörlerinde yayın yeri ve katkı rollerini korur", async () => {
    const xml = readFileSync(root("test/fixtures/k10plus-9786054791712.xml"), "utf8");
    const file = join(temp, "doab.xml");
    const record = xml.match(/<record xmlns=[\s\S]+?<\/record>/)?.[0]!;
    writeFileSync(file, `<collection xmlns="http://www.loc.gov/MARC21/slim">${record}</collection>`);
    const db = catalog();
    await ingestFile(db, "k10plus", root("test/fixtures/k10plus-9786054791712.xml"));
    const entries = [];
    for await (const entry of marcFile(file, "doab")) entries.push(entry);
    expect(entries).toHaveLength(1);
    expect(db.item(1)?.fields).toMatchObject({ place: "İstanbul", ISBN: "9786054791712", edition: "1" });
    expect(db.item(1)?.creators.map(c => c.creatorType)).toEqual(expect.arrayContaining(["author", "translator", "editor"]));
  });

  it("MARC ortak yayınında sonraki yayın yerlerini kapsam kanıtı olarak saklar", async () => {
    const xml = `<collection xmlns="http://www.loc.gov/MARC21/slim"><record><leader>00000nam a2200000 i 4500</leader>
      <controlfield tag="001">ortak-1</controlfield><controlfield tag="008">261124s2026    gw            000 0 ger d</controlfield>
      <datafield tag="020" ind1=" " ind2=" "><subfield code="a">9789751604439</subfield></datafield>
      <datafield tag="245" ind1="1" ind2="0"><subfield code="a">Ortak Kitap</subfield></datafield>
      <datafield tag="264" ind1=" " ind2="1"><subfield code="a">Berlin</subfield><subfield code="a">İstanbul</subfield><subfield code="b">Verlag</subfield><subfield code="c">2026</subfield></datafield>
    </record><record><leader>00000nam a2200000 i 4500</leader>
      <controlfield tag="001">ortak-2</controlfield><controlfield tag="008">261124s2026    xx            000 0 tur d</controlfield>
      <datafield tag="245" ind1="1" ind2="0"><subfield code="a">İkinci Ortak Kitap</subfield></datafield>
      <datafield tag="264" ind1=" " ind2="1"><subfield code="a">Wien</subfield><subfield code="b">A</subfield><subfield code="c">2025</subfield></datafield>
      <datafield tag="264" ind1=" " ind2="1"><subfield code="a">Ankara</subfield><subfield code="b">B</subfield></datafield>
    </record></collection>`;
    const file = join(temp, "ortak.xml");
    writeFileSync(file, xml);
    const db = catalog();
    await ingestFile(db, "k10plus", file);
    expect(db.review(0, 10)).toContainEqual(expect.objectContaining({ external_id: "ortak-1", code: "scope-conflict" }));
    expect(db.stats().counts.editions).toBe(1);
    expect(db.item(1)?.fields).toMatchObject({ title: "İkinci Ortak Kitap", place: "Wien" });
    expect(db.details(1)?.evidence).toContainEqual(expect.objectContaining({ field: "otherPlaces", observed: "Ankara", path: "264$a[1…]" }));
  });

  it("DOAB'ın sabit leader ve 008 ülke kodunu kanıt saymadan yayın yerine göre ayırır", async () => {
    const db = catalog();
    await ingestFile(db, "doab", root("test/fixtures/doab-sample.xml"));
    expect(db.stats().counts).toMatchObject({ raw: 2, editions: 1 });
    const turkish = db.item(1)!;
    expect(turkish.fields).toMatchObject({ title: "Current Issues in Archival Science", place: "İstanbul",
      publisher: "Istanbul University Press", ISBN: "9786050717839", numPages: "104", language: "en" });
    expect(turkish.fields.country).toBeUndefined();
    expect(db.details(1)?.evidence).toContainEqual(expect.objectContaining({ field: "place", source: "doab", observed: "Istanbul, Turkiye", path: "260$a" }));
    expect(db.review(0, 10)).toContainEqual(expect.objectContaining({ code: "scope-unknown" }));
  });

  it("Türkiye ön süzgeciyle yalnız Türkiye kanıtlı kayıtları saklar ve devamda aynı konumdan sürer", async () => {
    const db = catalog();
    expect(await ingestFile(db, "doab", root("test/fixtures/doab-sample.xml"), { onlyTurkey: true, limit: 1 })).toEqual({ cursor: 1, state: "paused" });
    expect(db.stats().counts).toMatchObject({ raw: 0, editions: 0 });
    expect(await ingestFile(db, "doab", root("test/fixtures/doab-sample.xml"), { onlyTurkey: true })).toEqual({ cursor: 2, state: "completed" });
    expect(db.stats().counts).toMatchObject({ raw: 1, editions: 1 });
    expect(db.item(1)?.fields.title).toBe("Current Issues in Archival Science");
    expect(db.review(0, 10)).toEqual([]);
  });

  it("yayınevi MARC dosyasını ayrı kaynak olarak toplar ve kaydın bağlantısını saklar", async () => {
    const sample = readFileSync(root("test/fixtures/k10plus-9786054791712.xml"), "utf8");
    const record = sample.match(/<record xmlns=[\s\S]+?<\/record>/)?.[0]!;
    const link = "https://www.ozguryayinlari.com/book/example";
    const xml = record.replace("</record>", `<datafield tag="856"><subfield code="u">${link}</subfield></datafield></record>`);
    const file = join(temp, "publisher.xml");
    const mock: typeof fetch = async url => {
      expect(String(url)).toBe("https://www.ozguryayinlari.com/site/libraryFiles/downloadPublic/15");
      return new Response(xml, { headers: { "Content-Type": "text/xml" } });
    };
    await collectOzgur(file, mock);
    const db = catalog();
    await ingestFile(db, "ozgur", file);
    expect(db.stats().sources).toContainEqual(expect.objectContaining({ id: "ozgur", raw: 1, editions: 1 }));
    expect(db.details(1)?.evidence).toContainEqual(expect.objectContaining({ source: "ozgur", url: link }));
  });

  it("K10plus sorgusunu sayfalayarak tek MARCXML koleksiyonuna yazar", async () => {
    const sample = readFileSync(root("test/fixtures/k10plus-9786054791712.xml"), "utf8");
    const record = sample.match(/<record xmlns=[\s\S]+?<\/record>/)?.[0]!;
    const starts: string[] = [];
    let failures = 1;
    const mock: typeof fetch = async url => {
      const params = new URL(String(url)).searchParams;
      expect(params.get("query")).toBe("pica.lcd=XB-TR and pica.mat=B");
      if (failures-- > 0) return new Response("busy", { status: 503 });
      starts.push(params.get("startRecord")!);
      const n = Number(params.get("maximumRecords"));
      const body = Array.from({ length: n }, (_, i) =>
        `<zs:record><zs:recordData>${record.replace(/(<controlfield tag="001">)[^<]*/, `$1TEST${params.get("startRecord")}-${i}`)}</zs:recordData></zs:record>`).join("");
      return new Response(`<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:numberOfRecords>5</zs:numberOfRecords><zs:records>${body}</zs:records></zs:searchRetrieveResponse>`,
        { headers: { "Content-Type": "text/xml" } });
    };
    const file = join(temp, "k10plus-query.xml");
    expect(await collectK10plusQuery("pica.lcd=XB-TR and pica.mat=B", file, { pageSize: 2, limit: 3 }, mock))
      .toEqual({ query: "pica.lcd=XB-TR and pica.mat=B", total: 5, written: 3 });
    expect(starts).toEqual(["1", "3"]);
    const entries = [];
    for await (const entry of marcFile(file, "k10plus")) entries.push(entry.id);
    expect(entries).toEqual(["TEST1-0", "TEST1-1", "TEST3-0"]);
  }, 20_000);

  it("Crossref Türkiye üyelerinin kitaplarını toplar, taşıyıcılara ayırır ve konumu kapsam kanıtı saymaz", async () => {
    const works = [
      { DOI: "10.1234/Kitap.1", type: "monograph", title: ["Bir Kitap"], subtitle: ["Alt Başlık"], publisher: "Örnek Yayınları",
        "publisher-location": "Ankara", "isbn-type": [{ value: "9789751604439", type: "print" }, { value: "9786054791712", type: "electronic" }],
        "published-print": { "date-parts": [[2020]] }, issued: { "date-parts": [[2020, 5]] }, "edition-number": "2",
        author: [{ given: "Ayşe", family: "YILMAZ", sequence: "additional" }, { given: "Ali", family: "Kaya", sequence: "first" }],
        editor: [{ name: "Örnek Enstitüsü", sequence: "first" }], translator: [{ given: "Deniz", family: "Ak", sequence: "first" }],
        reference: [{ key: "atılmalı" }] },
      { DOI: "10.1234/kitap.2", type: "book", title: ["Yersiz Kitap"], publisher: "Örnek Yayınları", ISBN: ["9789753381086"],
        issued: { "date-parts": [[2019]] }, author: [{ given: "Can", family: "Demir", sequence: "first" }] },
      { DOI: "10.1234/bolum", type: "book-chapter", title: ["Bölüm"] },
    ];
    const urls: string[] = [];
    const mock: typeof fetch = async url => {
      urls.push(String(url));
      const u = new URL(String(url));
      if (u.pathname === "/members") {
        const cursor = u.searchParams.get("cursor");
        const items = cursor === "*" ? [
          { id: 7, "primary-name": "Örnek", location: "Ankara, Turkey", "counts-type": { all: { monograph: 1, book: 1 } } },
          { id: 8, "primary-name": "Başka", location: "Berlin, Germany", "counts-type": { all: { book: 9 } } },
          { id: 9, "primary-name": "Dergi", location: "Türkiye", "counts-type": { all: { "journal-article": 9 } } },
        ] : [];
        return Response.json({ message: { items, "next-cursor": "c2" } });
      }
      expect(u.pathname).toBe("/members/7/works");
      expect(u.searchParams.get("filter")).toContain("type:edited-book");
      return Response.json({ message: { items: u.searchParams.get("cursor") === "*" ? works : [], "next-cursor": "n2" } });
    };
    const file = join(temp, "crossref.jsonl");
    expect(await collectCrossref(file, {}, mock)).toEqual({ members: 1, written: 3 });
    const db = catalog();
    await ingestFile(db, "crossref", file);
    expect(db.stats().counts).toMatchObject({ raw: 3, editions: 2 });
    const print = db.item(1)!;
    expect(print.fields).toMatchObject({ title: "Bir Kitap: Alt Başlık", ISBN: "9789751604439", date: "2020", edition: "2", place: "Ankara" });
    expect(db.details(1)?.evidence).toContainEqual(expect.objectContaining({ field: "format", source: "crossref", observed: "Basılı", selected: 1 }));
    expect(print.fields.DOI).toBeUndefined();
    expect(print.creators.map(c => [c.creatorType, c.lastName ?? c.name])).toEqual([["author", "Kaya"], ["author", "YILMAZ"], ["editor", "Örnek Enstitüsü"], ["translator", "Ak"]]);
    expect(readFileSync(file, "utf8")).not.toContain("atılmalı");
    expect(db.item(2)?.fields).toMatchObject({ ISBN: "9786054791712" });
    expect(db.details(2)?.evidence).toContainEqual(expect.objectContaining({ field: "format", observed: "Elektronik", selected: 1 }));
    expect(db.details(1)?.evidence).toContainEqual(expect.objectContaining({ field: "place", source: "crossref", path: "publisher-location" }));
    expect(db.review(0, 10)).toContainEqual(expect.objectContaining({ external_id: "10.1234/kitap.2", code: "scope-unknown" }));
  });

  it("Crossref kitap bölümlerini baskı saymadan saklar ve tek baskıya ISBN ile bağlar", async () => {
    const chapters = [
      { DOI: "10.1234/Bolum.1", type: "book-chapter", title: ["Birinci Bölüm"], page: "1-20", "container-title": ["Ortak Kitap"],
        "isbn-type": [{ value: "978-975-160-443-9", type: "print" }], author: [{ given: "Ece", family: "Kılıç", sequence: "first" }] },
      { DOI: "10.1234/bolum.2", type: "book-chapter", title: ["Sonradan Bağlanan"], ISBN: ["9786054791712"], page: "21-40" },
      { DOI: "10.1234/bolum.3", type: "book-chapter", title: ["İki Baskılı"], ISBN: ["9789753381086"] },
      { DOI: "10.1234/kitap", type: "book", title: ["Kitap Atlanır"] },
    ];
    const mock: typeof fetch = async url => {
      const u = new URL(String(url));
      expect(u.searchParams.get("filter")).toBe("type:book-chapter,type:book-section,type:book-part");
      return Response.json({ message: { items: u.searchParams.get("cursor") === "*" ? chapters : [], "next-cursor": "x" } });
    };
    const file = join(temp, "crossref-bolum.jsonl");
    expect(await collectCrossref(file, { members: ["7"], parts: true }, mock)).toEqual({ members: 1, written: 4 });
    const db = catalog();
    const book = (id: string, isbn: string, extra: Record<string, string> = {}): RecordInput => ({ id, raw: id, url: `https://example.org/${id}`, creators: [],
      fields: Object.entries({ title: `Kitap ${id}`, ISBN: isbn, place: "Ankara", ...extra }).map(([field, value]) => ({ field, value, path: field })) });
    db.job("k10plus", "b", "b");
    db.batch("k10plus", "b", 0, [book("a", "9789751604439"), book("c1", "9789753381086", { edition: "1" }), book("c2", "9789753381086", { title: "Kitap c1", edition: "2" })], true);
    const parts = [];
    for await (const part of crossrefParts(file)) parts.push(part);
    expect(parts).toHaveLength(3);
    expect(db.addParts("crossref", parts)).toEqual({ parts: 3, linked: 1 });
    expect(db.addParts("crossref", parts)).toEqual({ parts: 3, linked: 1 });
    expect(db.stats().counts).toMatchObject({ editions: 3, parts: 3, linkedParts: 1 });
    expect(db.details(1)?.parts).toEqual([expect.objectContaining({ doi: "10.1234/bolum.1", title: "Birinci Bölüm", pages: "1-20",
      creators: [expect.objectContaining({ creatorType: "author", lastName: "Kılıç" })] })]);
    db.job("k10plus", "d", "d");
    db.batch("k10plus", "d", 0, [book("d", "9786054791712")], true);
    expect(db.relinkParts()).toEqual({ linked: 1 });
    expect(db.stats().counts).toMatchObject({ parts: 3, linkedParts: 2 });
  });

  it("KBART satırını taşıyıcılarına ayırır ve yayın yeri kanıtı yoksa incelemeye alır", async () => {
    const columns = ["publication_type", "publication_title", "publisher_name", "title_url", "title_id",
      "print_identifier", "online_identifier", "date_monograph_published_print", "date_monograph_published_online",
      "monograph_volume", "monograph_edition", "first_author", "first_editor"];
    const row = ["monograph", "Kitap", "Özgür Yayınları", "https://www.ozguryayinlari.com/site/catalog/book/1",
      "10.1111/example", "9789751604439", "9786054791712", "2018", "2026", "", "", "Yazar Soyadı", "Editör Soyadı"];
    const tsv = [columns, row].map(cells => cells.join("\t")).join("\n");
    const file = join(temp, "publisher.tsv");
    const mock: typeof fetch = async url => {
      expect(String(url)).toBe("https://www.ozguryayinlari.com/site/tr/libraryFiles/downloadPublic/16");
      return new Response(tsv, { headers: { "Content-Type": "text/plain" } });
    };
    await collectOzgurKbart(file, mock);
    const records = [];
    for await (const record of ozgurKbart(file)) records.push(record);
    expect(records.map(r => r.id)).toEqual(["10.1111/example:online", "10.1111/example:print"]);
    expect(records[0]?.fields).toContainEqual({ field: "firstEditor", value: "Editör Soyadı", path: "first_editor" });
    expect(records[0]?.fields).toContainEqual({ field: "workDOI", value: "10.1111/example", path: "title_id" });
    expect(records[0]?.creators).toEqual([]);
    const db = catalog();
    await ingestFile(db, "ozgur-kbart", file);
    expect(db.stats().counts).toMatchObject({ raw: 2, editions: 0 });
    expect(db.review(0, 25).map(x => (x as { code: string }).code)).toEqual(["scope-unknown", "scope-unknown"]);
  });

  it("kapsamı kanıtlanan ham kaydı kaynağıyla bağlar ve ISBN çelişkisini korur", () => {
    const db = catalog();
    const record = (id: string, fields: Record<string, string>): RecordInput => ({
      id, raw: JSON.stringify(fields), url: `https://example.org/${id}`, creators: [],
      fields: Object.entries({ title: "Bir Kitap", ...fields }).map(([field, value]) => ({ field, value, path: field })),
    });
    const doi = "10.1111/example";
    const isbn = "9789751604439";
    db.job("ozgur-kbart", "sample", "sample");
    db.batch("ozgur-kbart", "sample", 0, [
      record("verified", { DOI: doi, ISBN: isbn, publisher: "Özgür Yayınları" }),
      record("different-isbn", { DOI: doi, ISBN: "9786054791712" }),
      record("unknown", { DOI: "10.1111/other", ISBN: "not-an-isbn" }),
    ], true);
    db.job("ozgur-kunye", "proof", "proof");
    db.batch("ozgur-kunye", "proof", 0, [record("proof", { DOI: doi, ISBN: isbn, place: "Gaziantep" })], true);
    expect(db.recheckScope("ozgur-kbart", 0, 2)).toEqual({ examined: 2, matched: 1, stillUnknown: 0, changedIssue: 1, after: 2 });
    expect(db.recheckScope("ozgur-kbart", 2, 2)).toEqual({ examined: 1, matched: 0, stillUnknown: 1, changedIssue: 0, after: 3 });
    expect(db.recheckScope("ozgur-kbart", 0, 5).matched).toBe(0);
    expect(db.stats().counts).toMatchObject({ raw: 4, editions: 1 });
    expect(db.item(1)?.fields).toMatchObject({ ISBN: isbn, place: "Gaziantep", publisher: "Özgür Yayınları" });
    expect(db.details(1)?.evidence).toContainEqual(expect.objectContaining({ field: "publisher", source: "ozgur-kbart", selected: 1 }));
    db.job("ttk", "page", "page");
    db.batch("ttk", "page", 0, ["https://example.org/sayfa-a", "https://example.org/sayfa-b"].map((url, i) =>
      record(`page-${i}`, { DOI: doi, ISBN: isbn, place: "Gaziantep", url })), true);
    expect(db.details(1)?.validation).not.toContainEqual(expect.objectContaining({ code: "field-conflict", detail: "url" }));
    const review = db.review(0, 25);
    expect(review).toContainEqual(expect.objectContaining({ external_id: "different-isbn", code: "identifier-conflict" }));
    expect(review.filter(r => (r as { code: string }).code === "invalid-isbn")).toHaveLength(1);
  });

  it("katkı adlarını alan sırasından bağımsız karşılaştırır, ad farkını incelemeye bırakır", () => {
    const db = catalog();
    const make = (id: string, creators: string[]): RecordInput => ({
      id, raw: id, url: `https://example.org/${id}`,
      creators: creators.map(value => ({ creator: JSON.parse(value), path: "100", kind: "person" as const })),
      fields: Object.entries({ title: "Bir Kitap", ISBN: "9789751604439", place: "Gaziantep", date: "2026" })
        .map(([field, value]) => ({ field, value, path: field })),
    });
    db.job("ozgur-kunye", "a", "a");
    db.batch("ozgur-kunye", "a", 0, [make("a", ['{"creatorType":"author","firstName":"Ozan Ekin","lastName":"Derin"}'])], true);
    db.job("ozgur", "b", "b");
    db.batch("ozgur", "b", 0, [make("b", ['{"creatorType":"author","lastName":"Derin","firstName":"Ozan Ekin"}'])], true);
    expect(db.details(1)?.validation.map(v => (v as { code: string }).code)).not.toContain("contributor-conflict");
    db.job("ttk", "c", "c");
    db.batch("ttk", "c", 0, [make("c", ['{"creatorType":"author","lastName":"Dérin","firstName":"Ozan Ekin"}'])], true);
    expect(db.details(1)?.validation).toContainEqual(expect.objectContaining({ code: "contributor-conflict", detail: "author" }));
  });

  it("ISBN ve DOI ayrı baskıları gösteriyorsa kaydı tek baskıya bağlamaz", () => {
    const db = catalog();
    const record = (id: string, fields: Record<string, string>): RecordInput => ({
      id, raw: JSON.stringify(fields), url: `https://example.org/${id}`, creators: [],
      fields: Object.entries({ place: "Ankara", ...fields }).map(([field, value]) => ({ field, value, path: field })),
    });
    const isbn = "9789751604439";
    const doi = "10.1111/example";
    db.job("exchange", "identity", "identity");
    db.batch("exchange", "identity", 0, [
      record("a", { title: "Bir Kitap", ISBN: isbn }),
      record("b", { title: "Başka Kitap", DOI: doi }),
      record("conflict", { title: "Bir Kitap", ISBN: isbn, DOI: doi }),
    ], true);
    expect(db.stats().counts.editions).toBe(2);
    expect(db.item(1)?.fields.DOI).toBeUndefined();
    expect(db.review(0, 10)).toContainEqual(expect.objectContaining({ external_id: "conflict", code: "identifier-conflict" }));
  });

  it("iki kimliği ortak olan başlık varyantını gerekçeyle bağlar ve seçili künye değerlerini korur", () => {
    const db = catalog();
    const make = (id: string, fields: Record<string, string>): RecordInput => ({
      id, raw: JSON.stringify(fields), url: `https://example.org/${id}`, creators: [],
      fields: Object.entries({ date: "2026", format: "PDF", ...fields }).map(([field, value]) => ({ field, value, path: field })),
    });
    const isbn = "9789751604439";
    const doi = "10.1111/example";
    db.job("exchange", "target", "target");
    db.batch("exchange", "target", 0, [make("target", { title: "Sayı", ISBN: isbn, DOI: doi, place: "Gaziantep", publisher: "Publisher" })], true);
    db.job("ttk", "variants", "variants");
    db.batch("ttk", "variants", 0, [
      make("variant", { title: "Sayılar", ISBN: isbn, DOI: doi, publisher: "Yayınevi" }),
      make("incorrect", { title: "Sayılar", ISBN: "9786054791712", DOI: doi }),
      make("date-conflict", { title: "Sayılar", ISBN: isbn, DOI: doi, date: "2024" }),
    ], true);
    expect(() => db.approveTitleVariant(3, 1, "Yanlış ISBN")).toThrow(/ISBN ve DOI/);
    expect(() => db.approveTitleVariant(4, 1, "Farklı tarih")).toThrow(/Yayın ve katkı/);
    expect(db.approveTitleVariant(2, 1, "İki kayıtta da aynı ISBN ve DOI görüldü.")).toEqual({ raw: 2, edition: 1, changed: true });
    expect(db.approveTitleVariant(2, 1, "Yeniden deneme")).toEqual({ raw: 2, edition: 1, changed: false });
    expect(db.item(1)?.fields).toMatchObject({ title: "Sayı", publisher: "Publisher", place: "Gaziantep" });
    expect(db.details(1)?.evidence).toContainEqual(expect.objectContaining({ field: "title", source: "ttk", observed: "Sayılar", selected: 0 }));
    expect(db.details(1)?.validation).toContainEqual(expect.objectContaining({ code: "review:title-variant", detail: "İki kayıtta da aynı ISBN ve DOI görüldü." }));
    expect(db.review(0, 25)).not.toContainEqual(expect.objectContaining({ external_id: "variant" }));
  });

  it("Vefeyât yazımını kaynak kişi bağlantısıyla saklar", async () => {
    const file = join(temp, "vefeyat.csv");
    writeFileSync(file, "\uFEFFKısa Ad;Tam Ad;Orijinal Ad;Vefat Tarihi;Tanıtım;Kaynak Link\r\nİbn Haldûn;---;---;---;;https://islamansiklopedisi.org.tr/ibn-haldun\r\n");
    const db = catalog();
    await ingestFile(db, "ttk", root("data/catalog/pilot/ttk.jsonl"), { authority: loadAuthority(file) });
    expect(db.item(3)?.creators).toContainEqual({ creatorType: "author", name: "İbn Haldûn" });
    const evidence = db.details(3)?.evidence.find(r => (r as { field: string }).field === "creator:author") as { authority: string; observed: string };
    expect(JSON.parse(evidence.authority)).toMatchObject({ url: "https://islamansiklopedisi.org.tr/ibn-haldun", path: "Kısa Ad" });
    expect(evidence.observed).toContain("İbn Haldun");
  });

  it("CSL-JSON, BibTeX, RIS ve Zotero RDF ile kitap alışverişi yapar", async () => {
    const db = catalog();
    await ingestFile(db, "ttk", root("data/catalog/pilot/ttk.jsonl"));
    const item = db.item(4)!;
    const anonymous = db.item(7)!;
    expect(anonymous.creators.map(c => c.creatorType)).toEqual(["hazirlayan", "nasir"]);
    const zotero = await parseFile(zoteroRdf([anonymous], []), "anonim.rdf");
    expect(zotero.items[0]?.creators.map(c => c.creatorType)).toEqual(["hazirlayan", "nasir"]);
    const formats = [
      ["test.json", cslJson([item])],
      ["test.bib", await formatAs([item], "bibtex")],
      ["test.ris", await formatAs([item], "ris")],
      ["test.rdf", zoteroRdf([item], [])],
    ] as const;
    for (const [filename, raw] of formats) {
      const { items } = await parseFile(raw, filename);
      expect(items[0]?.fields.title, filename).toBe(item.fields.title);
      if (filename === "test.rdf" || filename === "test.json") {
        expect(items[0]?.creators.map(c => c.creatorType)).toEqual(expect.arrayContaining(["author", "translator", "muhakkik"]));
      }
    }
  });

  it.each([
    { section: "2.4", marker: "İslam’da İnanç Esasları", first: "25", later: "36" },
    { section: "2.3", marker: "Düşünceleriyle Atatürk", first: "54-58", later: "62" },
    { section: "2.5", marker: "1950’li Yılları", first: "7", later: "7" },
  ])("İSNAD $section için katalogdan ilk dipnot, sonraki dipnot ve kaynakça üretir", ({ section, marker, first, later }) => {
    const { items } = parseZoteroRdf(readFileSync(root("test/fixtures/isnad/isnad2-eserler.rdf"), "utf8"), "file:isnad");
    const example = items.find(i => i.fields.title?.replaceAll("'", "’").includes(marker))!;
    const examples = JSON.parse(readFileSync(root("test/fixtures/isnad/guide-examples.json"), "utf8")) as {
      no: string; first: string[]; later: string[]; bib: string[];
    }[];
    const expected = examples.find(e => e.no === section)!;
    const db = catalog();
    const raw = itemRecord(example, JSON.stringify(example), `isnad-${section}`, "https://www.isnadsistemi.org/guide/isnad2/isnad-dipnotlu/2-kitap/");
    db.job("exchange", "guide", "guide");
    db.batch("exchange", "guide", 0, [raw], true);
    expect(renderEdition(db.item(1)!, readStyle, { first, later })).toEqual({
      first: expected.first.find(x => x.includes(marker)),
      later: expected.later.find(x => x.includes(marker)),
      bibliography: [expected.bib.find(x => x.includes(marker))],
    });
  });
});

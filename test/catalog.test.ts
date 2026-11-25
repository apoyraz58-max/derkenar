import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadAuthority } from "../src/catalog/authority.js";
import { renderEdition } from "../src/catalog/citation.js";
import { ingestFile } from "../src/catalog/ingest.js";
import { type RecordInput, validIsbn } from "../src/catalog/model.js";
import { collectOzgur, collectOzgurKbart } from "../src/catalog/sources/collect.js";
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

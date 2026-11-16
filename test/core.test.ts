import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitPlan, emptyState, planRefresh, putCitation, signature, syncWorks } from "../src/core/docstate.js";
import { Renderer, styleMeta } from "../src/core/engine.js";
import { backup, cslJson, isBackup, parseBackup } from "../src/core/exporters.js";
import { htmlToSegments, htmlToText } from "../src/core/html.js";
import { cleanDoi, cleanIsbn, detectFormat, parseFile, splitName, zoteroToItems } from "../src/core/importers.js";
import { applyFix, checkItem, fixEncoding, nameCase, sentenceCase } from "../src/core/isnad.js";
import { collectionTree, findDuplicates, inView, mergeItems, sortItems, tagCounts } from "../src/core/library.js";
import { SearchIndex, fold } from "../src/core/search.js";
import { BUILTIN_STYLES } from "../src/core/styles.js";
import { type Item, changeItemType, creatorTypesOf, emptyItem, fieldsOf, fromCsl, itemTypeLabel, parseDate, toCsl, toZoteroData } from "../src/core/zotero.js";

const dir = new URL("../data/styles/", import.meta.url);
const style = (id: string) => readFileSync(new URL(`${id}.csl`, dir), "utf8");
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8");
  } catch {
    return undefined;
  }
};
const isnad = () => new Renderer(style("isnad-dipnotlu"), locales);

function item(key: string, itemType: string, fields: Record<string, string>, creators: Item["creators"] = []): Item {
  return { ...emptyItem(itemType), key, fields, creators };
}

const GAZZALI = item("GAZ", "book", { title: "el-Müstasfâ min ʿilmi’l-uṣûl", publisher: "el-Câmiʿatü’l-İslâmiyye", place: "Medine", numberOfVolumes: "4" }, [
  { creatorType: "author", lastName: "Gazzâlî", firstName: "Ebû Hâmid Muhammed b. Muhammed" },
  { creatorType: "muhakkik", lastName: "Hâfız", firstName: "Hamza b. Züheyr" },
]);
const YILMAZ = item("YIL", "journalArticle", { title: "Kelâm ilminin tarihî gelişimi", publicationTitle: "İslâm Araştırmaları Dergisi", volume: "12", pages: "45-78", date: "2004" }, [{ creatorType: "author", lastName: "Yılmaz", firstName: "Ahmet" }]);
const MUKADDIME = item("MUK", "book", { title: "Mukaddime", publisher: "Dergâh", place: "İstanbul", date: "1982" }, [
  { creatorType: "author", lastName: "İbn Haldûn", firstName: "Abdurrahman" },
  { creatorType: "translator", lastName: "Uludağ", firstName: "Süleyman" },
  { creatorType: "nasir", lastName: "Nâşir", firstName: "Ali" },
  { creatorType: "hazirlayan", lastName: "Hazır", firstName: "Veli" },
  { creatorType: "sadelestiren", lastName: "Sade", firstName: "Can" },
]);
const DIA = item("DIA", "encyclopediaArticle", { title: "Gazzâlî", encyclopediaTitle: "Türkiye Diyanet Vakfı İslâm Ansiklopedisi", publisher: "TDV Yayınları", place: "İstanbul", date: "1996", volume: "13", pages: "489-505" }, [{ creatorType: "author", lastName: "Çağrıcı", firstName: "Mustafa" }]);

describe("Zotero model", () => {
  it("has Zotero's item types with Turkish labels and the İSNAD roles", () => {
    expect(itemTypeLabel("book")).toBe("Kitap");
    expect(fieldsOf("book")[0]).toBe("title");
    expect(creatorTypesOf("book")).toEqual(expect.arrayContaining(["author", "editor", "muhakkik", "nasir", "hazirlayan", "sadelestiren"]));
  });
  it("maps fields and roles to CSL", () => {
    const c = toCsl(MUKADDIME);
    expect(c.type).toBe("book");
    expect(c["publisher-place"]).toBe("İstanbul");
    expect(c["editorial-director"]).toEqual([{ family: "Nâşir", given: "Ali" }]);
    expect(c.director).toEqual([{ family: "Hazır", given: "Veli" }]);
    expect(c["reviewed-author"]).toEqual([{ family: "Sade", given: "Can" }]);
    expect(toCsl(DIA)["container-title"]).toBe("Türkiye Diyanet Vakfı İslâm Ansiklopedisi");
  });
  it("reads İSNAD roles from Zotero's Extra field", () => {
    const i = item("X", "book", { title: "T", extra: "editorial-director: Nâşir || Ali\nthk: Hâfız || Hamza\nbaşka not" });
    const c = toCsl(i);
    expect(c["editorial-director"]).toEqual([{ family: "Nâşir", given: "Ali" }]);
    expect(c["collection-editor"]).toEqual([{ family: "Hâfız", given: "Hamza" }]);
    expect(c.note).toBe("başka not");
  });
  it("dates: hicrî/milâdî stays literal, Turkish months parse", () => {
    expect(parseDate("1413/1993")).toEqual({ literal: "1413/1993" });
    expect(parseDate("12 Mart 2024")).toEqual({ "date-parts": [[2024, 3, 12]] });
    expect(parseDate("03.05.2004")).toEqual({ "date-parts": [[2004, 5, 3]] });
    expect(parseDate("ts.")).toBeUndefined();
  });
  it("round-trips through CSL and Zotero data", () => {
    const back = fromCsl(toCsl(MUKADDIME), "test", "MUK");
    expect(back.fields.place).toBe("İstanbul");
    expect(back.creators.map((c) => c.creatorType).sort()).toEqual(["author", "hazirlayan", "nasir", "sadelestiren", "translator"]);
    const z = toZoteroData(GAZZALI) as { creators: { creatorType: string }[] };
    expect(z.creators.map((c) => c.creatorType)).toEqual(["author", "seriesEditor"]);
    const zm = toZoteroData(MUKADDIME) as { extra: string };
    expect(zm.extra).toContain("editorial-director: Nâşir || Ali");
  });
  it("changing the type keeps values", () => {
    const t = changeItemType(item("T", "book", { title: "A", publisher: "P" }), "thesis");
    expect(t.fields.university).toBe("P");
  });
});

describe("İSNAD rendering", () => {
  it("muhakkik, nâşir, hazırlayan, sadeleştiren, cilt/sayfa", () => {
    const r = isnad();
    const st = emptyState();
    putCitation(st, "1", [{ id: "GAZ", locator: "1/45" }], { GAZ: GAZZALI });
    putCitation(st, "2", [{ id: "MUK", locator: "12" }], { MUK: MUKADDIME });
    putCitation(st, "3", [{ id: "DIA", locator: "490" }], { DIA });
    putCitation(st, "4", [{ id: "GAZ", locator: "2/10" }], {});
    const plan = planRefresh(st, ["1", "2", "3", "4"].map((id, i) => ({ id, noteIndex: i + 1, text: "" })), r);
    const t = (id: string) => htmlToText(plan.updates.get(id)!);
    expect(t("1")).toBe("Ebû Hâmid Muhammed b. Muhammed Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, thk. Hamza b. Züheyr Hâfız (Medine: el-Câmiʿatü’l-İslâmiyye, ts.), 1/45.");
    expect(t("2")).toContain("sad. Can Sade, nşr. Ali Nâşir, haz. Veli Hazır, çev. Süleyman Uludağ");
    expect(t("3")).toBe("Mustafa Çağrıcı, “Gazzâlî”, Türkiye Diyanet Vakfı İslâm Ansiklopedisi (İstanbul: TDV Yayınları, 1996), 13/490.");
    expect(t("4")).toBe("Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, 2/10.");
  });
  it("a citation inserted before takes the full form, the old one shortens", () => {
    const r = isnad();
    const st = emptyState();
    putCitation(st, "a", [{ id: "YIL", locator: "50" }], { YIL: YILMAZ });
    let plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], r);
    commitPlan(st, plan);
    expect(htmlToText(st.rendered.a!)).toContain("Ahmet Yılmaz, “Kelâm");
    putCitation(st, "b", [{ id: "YIL", locator: "46" }], {});
    plan = planRefresh(st, [{ id: "b", noteIndex: 1, text: "" }, { id: "a", noteIndex: 2, text: "x" }], r);
    expect(htmlToText(plan.updates.get("b")!)).toContain("Ahmet Yılmaz, “Kelâm");
    expect(htmlToText(plan.updates.get("a")!)).toBe("Yılmaz, “Kelâm ilminin tarihî gelişimi”, 50.");
    commitPlan(st, plan);
    // Deleting the first one: the remaining one is full again.
    plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "x" }], r);
    expect(htmlToText(plan.updates.get("a")!)).toContain("Ahmet Yılmaz, “Kelâm");
  });
  it("cilt sayısı in the Cilt field: the citation's cilt wins, the check moves it", () => {
    const mahsul = item("MAH", "book", { title: "el-Maḥsûl", publisher: "Müʾessesetüʾr-Risâle", place: "Riyaḍ", date: "1997", volume: "6" }, [
      { creatorType: "author", lastName: "Râzî", firstName: "Ebû ʿAbdillâh Muḥammed b. ʿÖmer b. Ḥuseyn Faḫreddîn er-" },
      { creatorType: "muhakkik", lastName: "el-ʿAlvânî", firstName: "Tâhâ Câbir Feyyâż" },
    ]);
    const r = isnad();
    const st = emptyState();
    putCitation(st, "m", [{ id: "MAH", volume: "1", locator: "80-81" }], { MAH: mahsul });
    let plan = planRefresh(st, [{ id: "m", noteIndex: 1, text: "" }], r);
    expect(htmlToText(plan.updates.get("m")!)).toMatch(/1997\), 1\/80-81\.$/);
    // Even before the record is fixed, the bibliography gives the number of volumes.
    expect(htmlToText(plan.bibliography!.entries[0]!.html)).toContain("el-ʿAlvânî. 6 Cilt. Riyaḍ");
    const fix = checkItem(mahsul).find((i) => i.code === "volume-count")!;
    const moved = applyFix(mahsul, fix.fix!);
    expect(moved.fields).toMatchObject({ numberOfVolumes: "6" });
    expect(moved.fields.volume).toBeUndefined();
    st.items.MAH = moved;
    plan = planRefresh(st, [{ id: "m", noteIndex: 1, text: "" }], r, true);
    expect(htmlToText(plan.updates.get("m")!)).toMatch(/1997\), 1\/80-81\.$/);
    expect(htmlToText(plan.bibliography!.entries[0]!.html)).toContain("6 Cilt");
  });
  it("signature changes only when order changes", () => {
    expect(signature([{ id: "a", noteIndex: 1 }, { id: "b", noteIndex: 2 }])).not.toBe(signature([{ id: "b", noteIndex: 1 }, { id: "a", noteIndex: 2 }]));
  });
  it("edited library items flow into the document", () => {
    const st = emptyState();
    putCitation(st, "a", [{ id: "YIL" }], { YIL: YILMAZ });
    const edited = { ...YILMAZ, fields: { ...YILMAZ.fields, pages: "45-80" }, dateModified: "2099-01-01T00:00:00Z" };
    expect(syncWorks(st, (k) => (k === "YIL" ? edited : undefined))).toEqual(["YIL"]);
    expect(st.items.YIL!.fields.pages).toBe("45-80");
  });
  it("both İSNAD styles are known", () => {
    for (const s of BUILTIN_STYLES) expect(styleMeta(style(s.id)).note).toBe(s.note);
  });
  it("1000 notes render in a few seconds", () => {
    const r = isnad();
    const st = emptyState();
    const works: Record<string, Item> = {};
    for (let i = 0; i < 200; i++) works[`w${i}`] = { ...GAZZALI, key: `w${i}`, fields: { ...GAZZALI.fields, title: `Eser ${i}` } };
    const found = Array.from({ length: 1000 }, (_, i) => {
      putCitation(st, `c${i}`, [{ id: `w${i % 200}`, locator: String(i) }], works);
      return { id: `c${i}`, noteIndex: i + 1, text: "" };
    });
    const t = performance.now();
    expect(planRefresh(st, found, r).updates.size).toBe(1000);
    expect(performance.now() - t).toBeLessThan(6000);
  });
});

describe("search", () => {
  const index = new SearchIndex([GAZZALI, YILMAZ, MUKADDIME, { ...DIA, tags: [{ tag: "kelam" }] }]);
  it("folds Turkish and transliteration", () => {
    expect(fold("İhyâü ‘Ulûmi’d-Dîn")).toBe("ihyau ulumid-din");
    expect(index.search("gazzali mustasfa").map((h) => h.item.key)).toEqual(["GAZ"]);
    expect(index.search("hafiz").map((h) => h.item.key)).toEqual(["GAZ"]);
    expect(index.search("yilmaz 2004")[0]!.item.key).toBe("YIL");
    expect(index.search("kelam").map((h) => h.item.key)).toContain("DIA");
  });
  it("20 000 items under 100 ms", () => {
    const big = new SearchIndex(Array.from({ length: 20000 }, (_, i) => ({ ...YILMAZ, key: `x${i}`, fields: { ...YILMAZ.fields, title: `Eser ${i}` } })));
    const t = performance.now();
    big.search("yilmaz eser 19999");
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe("html", () => {
  it("keeps italics and entities", () => {
    expect(htmlToSegments("a <i>b</i> &#38; c")).toEqual([{ text: "a " }, { text: "b", italic: true }, { text: " & c" }]);
  });
});

describe("İSNAD denetimi", () => {
  it("finds and fixes the usual slips", () => {
    const bad = item("B", "book", { title: "İHYÂÜ ULÛMİ'D-DÎN.", edition: "2. Baskı", volume: "C. 3" }, [{ creatorType: "author", lastName: "GAZZÂLÎ, EBÛ HÂMİD" }]);
    const issues = checkItem(bad);
    const codes = issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["need-place", "need-publisher", "caps", "title-period", "edition", "volume", "name-caps", "name-comma"]));
    let fixed = bad;
    for (const i of issues) if (i.fix && i.code !== "title-period") fixed = applyFix(fixed, i.fix);
    expect(fixed.fields.place).toBe("y.y.");
    expect(fixed.fields.publisher).toBe("y.y.y.");
    expect(fixed.fields.edition).toBe("2");
    expect(fixed.fields.volume).toBe("3");
  });
  it("pages, DOI, encoding", () => {
    const i = item("P", "journalArticle", { title: "KelÃ¢m ve Ä°slÃ¢m", publicationTitle: "D", volume: "1", pages: "s. 45 – 78", date: "2004", DOI: "https://doi.org/10.1000/abc" });
    const issues = checkItem(i);
    expect(issues.find((x) => x.code === "pages")!.fix!.value).toBe("45-78");
    expect(issues.find((x) => x.code === "doi-url")!.fix!.value).toBe("10.1000/abc");
    expect(issues.find((x) => x.code === "encoding")!.fix!.value).toBe("Kelâm ve İslâm");
  });
  it("clean records pass", () => {
    expect(checkItem(DIA).filter((i) => i.level !== "info")).toEqual([]);
    expect(checkItem(GAZZALI).filter((i) => i.level === "error")).toEqual([]);
  });
  it("case helpers", () => {
    expect(sentenceCase("KELÂM İLMİ: GİRİŞ")).toBe("Kelâm ilmi: Giriş");
    expect(nameCase("AHMET YILMAZ")).toBe("Ahmet Yılmaz");
    expect(fixEncoding("Ä±ÅŸÄŸ")).toBe("ışğ");
  });
});

describe("library", () => {
  const coll = [{ key: "A", name: "Tez" }, { key: "B", name: "Usûl", parentKey: "A" }];
  it("views, tree, sort, tags", () => {
    const i = { ...YILMAZ, collections: ["B"], tags: [{ tag: "kelam" }] };
    expect(inView(i, { kind: "collection", key: "A" }, coll)).toBe(false);
    expect(inView(i, { kind: "collection", key: "A", deep: true }, coll)).toBe(true);
    expect(inView({ ...i, deleted: true }, { kind: "all" })).toBe(false);
    expect(collectionTree(coll).map((x) => `${x.depth}${x.c.name}`)).toEqual(["0Tez", "1Usûl"]);
    expect(sortItems([YILMAZ, GAZZALI], "creator").map((x) => x.key)).toEqual(["GAZ", "YIL"]);
    expect(tagCounts([i])).toEqual([{ tag: "kelam", count: 1, automatic: false }]);
  });
  it("duplicates and merge", () => {
    const a = { ...YILMAZ, key: "A1", tags: [{ tag: "x" }] };
    const b = { ...YILMAZ, key: "B1", fields: { ...YILMAZ.fields, DOI: "10.1/z" }, tags: [{ tag: "y" }] };
    const c = { ...YILMAZ, key: "C1", fields: { ...YILMAZ.fields, date: "1999" } };
    const groups = findDuplicates([a, b, c, GAZZALI]);
    expect(groups.map((g) => g.map((x) => x.key).sort())).toEqual([["A1", "B1"]]);
    const m = mergeItems(a, [b]);
    expect(m.fields.DOI).toBe("10.1/z");
    expect(m.tags.map((t) => t.tag)).toEqual(["x", "y"]);
  });
});

describe("import / export", () => {
  it("detects formats", () => {
    expect(detectFormat("<rdf:RDF xmlns:rdf=")).toBe("zotero-rdf");
    expect(detectFormat("[{}]")).toBe("csl-json");
    expect(detectFormat("@book{x,}")).toBe("bibtex");
    expect(detectFormat("TY  - BOOK\n")).toBe("ris");
  });
  it("Zotero RDF: collections, notes, tags, relations, roles, containers", async () => {
    const r = await parseFile(readFileSync(new URL("fixtures/zotero.rdf", import.meta.url), "utf8"), "kutuphane.rdf");
    expect(r.format).toBe("zotero-rdf");
    expect(r.items).toHaveLength(3);
    const book = r.items.find((i) => i.itemType === "book")!;
    expect(book.fields.place).toBe("Medine");
    expect(book.fields.publisher).toBe("el-Câmiʿatü’l-İslâmiyye");
    expect(book.creators.map((c) => c.creatorType)).toEqual(["author", "muhakkik", "nasir"]);
    expect(book.tags).toEqual([{ tag: "usûl" }, { tag: "fıkıh", type: 1 }]);
    expect(book.notes[0]!.note).toBe("<p>Önemli nüsha</p>");
    const art = r.items.find((i) => i.itemType === "journalArticle")!;
    expect(art.fields).toMatchObject({ publicationTitle: "İslâm Araştırmaları Dergisi", volume: "12", issue: "2", DOI: "10.1000/xyz", ISSN: "1301-3289", pages: "45–78" });
    expect(book.relations).toEqual([art.key]);
    const sec = r.items.find((i) => i.itemType === "bookSection")!;
    expect(sec.fields).toMatchObject({ bookTitle: "Derleme Kitap", publisher: "İSAM", place: "İstanbul", ISBN: "9789753891234" });
    expect(sec.creators.map((c) => c.creatorType)).toEqual(["author", "editor"]);
    expect(r.collections.map((c) => c.name).sort()).toEqual(["Tez", "Usûl"]);
    const tez = r.collections.find((c) => c.name === "Tez")!;
    expect(r.collections.find((c) => c.name === "Usûl")!.parentKey).toBe(tez.key);
    expect(book.collections).toEqual([tez.key]);
  });
  it("BibTeX with LaTeX accents", async () => {
    const { items } = await parseFile("@book{gazzali1982, author={Gazz{\\^a}l{\\^\\i}, Eb{\\^u} H{\\^a}mid}, title={{\\.I}hy{\\^a}}, year={1982}, keywords={tasavvuf, ahlak}}", "a.bib");
    expect(items[0]!.creators[0]).toEqual({ creatorType: "author", lastName: "Gazzâlî", firstName: "Ebû Hâmid" });
    expect(items[0]!.fields.title).toBe("İhyâ");
    expect(items[0]!.fields.date).toBe("1982");
  });
  it("RIS keeps a stable key", async () => {
    const ris = "TY  - JOUR\nAU  - Yılmaz, Ahmet\nTI  - Kelâm\nPY  - 2004\nER  - \n";
    expect((await parseFile(ris, "x.ris")).items[0]!.key).toBe((await parseFile(ris, "x.ris")).items[0]!.key);
  });
  it("Zotero API objects with child notes and Extra roles", () => {
    const items = zoteroToItems(
      [
        { key: "ABCD2345", version: 5, data: { itemType: "book", title: "T", creators: [{ creatorType: "seriesEditor", lastName: "Hâfız", firstName: "H" }], tags: [{ tag: "kelam" }], collections: ["C1"], extra: "hazırlayan: Hazır || Veli" } },
        { key: "NOTE2345", version: 5, data: { itemType: "note", parentItem: "ABCD2345", note: "<p>n</p>" } },
        { key: "ATT23456", version: 5, data: { itemType: "attachment" } },
      ],
      "users/1",
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.creators.map((c) => c.creatorType)).toEqual(["muhakkik", "hazirlayan"]);
    expect(items[0]!.notes[0]!.note).toBe("<p>n</p>");
    expect(items[0]!.fields.extra).toBeUndefined();
  });
  it("backup round trip and CSL JSON export", () => {
    const text = backup([GAZZALI], [{ key: "A", name: "Tez" }]);
    expect(isBackup(text)).toBe(true);
    expect(parseBackup(text).items[0]!.key).toBe("GAZ");
    const csl = JSON.parse(cslJson([MUKADDIME]))[0];
    expect(csl.note).toContain("editorial-director: Nâşir || Ali");
  });
  it("DOI, ISBN and names", () => {
    expect(cleanDoi("https://doi.org/10.1000/xyz.")).toBe("10.1000/xyz");
    expect(cleanIsbn("978-975-389-123-4")).toBe("9789753891234");
    expect(splitName("Ahmet Yılmaz")).toEqual({ lastName: "Yılmaz", firstName: "Ahmet" });
  });
});

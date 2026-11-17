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
  it("missing imprint: b.y., y.y., ts. written automatically, record stays empty", () => {
    const bare = item("BAR", "book", { title: "Risâle" }, [{ creatorType: "author", lastName: "Yazar", firstName: "Ali" }]);
    const st = emptyState();
    putCitation(st, "x", [{ id: "BAR", locator: "5" }], { BAR: bare });
    const plan = planRefresh(st, [{ id: "x", noteIndex: 1, text: "" }], isnad());
    expect(htmlToText(plan.updates.get("x")!)).toBe("Ali Yazar, Risâle (b.y.: y.y., ts.), 5.");
    expect(htmlToText(plan.bibliography!.entries[0]!.html)).toBe("Yazar, Ali. Risâle. b.y.: y.y., ts.");
    expect(st.items.BAR!.fields.place).toBeUndefined();
    const typed = checkItem(item("T", "book", { title: "A", place: "y.y.", publisher: "y.y.y." }));
    expect(typed.filter((i) => i.code === "abbr-in-field").map((i) => i.field)).toEqual(["place", "publisher"]);
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
    expect(codes).toEqual(expect.arrayContaining(["caps", "title-period", "edition", "volume", "name-caps", "name-comma"]));
    let fixed = bad;
    for (const i of issues) if (i.fix && i.code !== "title-period") fixed = applyFix(fixed, i.fix);
    expect(issues.find((i) => i.code === "need-place")!.message).toContain("b.y.");
    expect(issues.find((i) => i.code === "need-publisher")!.message).toContain("y.y.");
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

describe("0.3: Zotero features", () => {
  it("advanced search: conditions, all/any, collections with sub-collections, dates", async () => {
    const { matches, describe: desc } = await import("../src/core/searchquery.js");
    const coll = [{ key: "A", name: "Tez" }, { key: "B", name: "Usûl", parentKey: "A" }];
    const y = { ...YILMAZ, collections: ["B"], tags: [{ tag: "kelam" }], dateAdded: "2026-11-10T00:00:00Z" };
    const s = { mode: "all" as const, conditions: [{ field: "title", op: "contains" as const, value: "kelam" }, { field: "year", op: "isAfter" as const, value: "2000" }] };
    expect(matches(y, s)).toBe(true);
    expect(matches(GAZZALI, s)).toBe(false);
    expect(matches(y, { mode: "all", conditions: [{ field: "collection", op: "is", value: "A" }] }, coll)).toBe(true);
    expect(matches(y, { mode: "any", conditions: [{ field: "tag", op: "is", value: "fıkıh" }, { field: "creator", op: "contains", value: "yilmaz" }] })).toBe(true);
    expect(matches(y, { mode: "all", conditions: [{ field: "dateAdded", op: "isInTheLast", value: "30" }] }, [], Date.parse("2026-11-16T00:00:00Z"))).toBe(true);
    expect(matches(MUKADDIME, { mode: "all", conditions: [{ field: "creator", op: "contains", value: "naşir" }] })).toBe(true);
    expect(desc(s)).toBe('Başlık içerir "kelam" ve Yıl sonra "2000"');
  });
  it("Zotero RDF export reads back with keys, collections, notes, roles", async () => {
    const { zoteroRdf } = await import("../src/core/zoteroexport.js");
    const { parseZoteroRdf } = await import("../src/core/rdf.js");
    const book = { ...GAZZALI, key: "ABCD2345", collections: ["CDEF2345"], notes: [{ key: "N", note: "<p>nüsha</p>", dateModified: "" }], tags: [{ tag: "usûl" }], fields: { ...GAZZALI.fields, date: "1413/1993" } };
    const xml = zoteroRdf([book, { ...MUKADDIME, key: "MUKA2345" }], [{ key: "CDEF2345", name: "Tez" }]);
    const back = parseZoteroRdf(xml, "file:x.rdf");
    const b = back.items.find((i) => i.key === "ABCD2345")!;
    expect(b.fields).toMatchObject({ title: book.fields.title, place: "Medine", publisher: "el-Câmiʿatü’l-İslâmiyye", date: "1413/1993", numberOfVolumes: "4" });
    expect(b.creators.map((c) => c.creatorType)).toEqual(["author", "muhakkik"]);
    expect(b.notes[0]!.note).toBe("<p>nüsha</p>");
    expect(b.collections).toEqual(["CDEF2345"]);
    expect(back.collections).toEqual([{ key: "CDEF2345", name: "Tez" }]);
    const m = back.items.find((i) => i.key === "MUKA2345")!;
    expect(m.creators.map((c) => c.creatorType).sort()).toEqual(["author", "hazirlayan", "nasir", "sadelestiren", "translator"]);
  });
  it("CSV has Zotero's columns", async () => {
    const { zoteroCsv } = await import("../src/core/zoteroexport.js");
    const csv = zoteroCsv([GAZZALI]);
    expect(csv.split("\r\n")[0]).toContain('"Item Type","Publication Year","Author","Title"');
    expect(csv).toContain('"Gazzâlî, Ebû Hâmid Muhammed b. Muhammed"');
  });
  it("quick format: cilt/sayfa, s., vr.; a year stays a year", async () => {
    const { parseQuick } = await import("../src/core/search.js");
    expect(parseQuick("gazzali 1/45")).toEqual({ words: "gazzali", volume: "1", locator: "45" });
    expect(parseQuick("gazzali s. 45-47")).toEqual({ words: "gazzali", locator: "45-47" });
    expect(parseQuick("kemalpaşazade vr. 12b")).toEqual({ words: "kemalpaşazade", locator: "12b" });
    expect(parseQuick("gazzali 1982")).toEqual({ words: "gazzali 1982" });
    expect(parseQuick("gazzali 45")).toEqual({ words: "gazzali", locator: "45" });
  });
  it("push to Zotero: versions, İSNAD roles in Extra, conflicts reported", async () => {
    const { pushToZotero } = await import("../src/core/importers.js");
    let sent: Record<string, unknown>[] = [];
    const fake = async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ successful: { "0": { key: sent[0]!.key, version: 12 } }, failed: { "1": { key: sent[1]!.key, code: 412, message: "x" } } }), { headers: { "Last-Modified-Version": "12" } });
    };
    const a = { ...MUKADDIME, key: "AAAA2345", source: "zotero:users/1", version: 5, dirty: true, collections: ["C1", "LOCAL"] };
    const b = { ...YILMAZ, key: "BBBB2345", source: "zotero:users/1", version: 3, dirty: true };
    const res = await pushToZotero({ library: "users/1", apiKey: "k" }, [a, b], new Set(["C1"]), fake as typeof fetch);
    expect(sent[0]).toMatchObject({ key: "AAAA2345", version: 5, collections: ["C1"] });
    expect(String(sent[0]!.extra)).toContain("editorial-director: Nâşir || Ali");
    expect(sent[0]!.dateModified).toBeUndefined();
    expect(res.saved).toHaveLength(1);
    expect(res.saved[0]!.version).toBe(12);
    expect(res.saved[0]!.dirty).toBeUndefined();
    expect(res.failed[0]!.message).toContain("Çevrimiçi kütüphanede de değişmiş");
  });
  it("PMID and arXiv lookups", async () => {
    const { lookupPmid, lookupArxiv, cleanArxiv, cleanPmid } = await import("../src/core/importers.js");
    const pm = await lookupPmid("12345678", (async () => new Response(JSON.stringify({ result: { "12345678": { title: "A study.", authors: [{ name: "Smith J", authtype: "Author" }], fulljournalname: "Journal", volume: "3", pages: "1-9", pubdate: "2001 Jan", articleids: [{ idtype: "doi", value: "10.1/x" }] } } }))) as typeof fetch);
    expect(pm.fields).toMatchObject({ title: "A study", publicationTitle: "Journal", date: "2001", DOI: "10.1/x" });
    const ax = await lookupArxiv("2101.01234", (async () => new Response("<feed><entry><title>Deep\n Things</title><published>2021-01-05T00:00:00Z</published><summary>Abs</summary><author><name>Ada Lovelace</name></author></entry></feed>")) as typeof fetch);
    expect(ax.itemType).toBe("preprint");
    expect(ax.fields.title).toBe("Deep Things");
    expect(ax.creators[0]).toEqual({ creatorType: "author", lastName: "Lovelace", firstName: "Ada" });
    expect(cleanArxiv("arXiv:2101.01234v2")).toBe("2101.01234");
    expect(cleanPmid("PMID: 12345678")).toBe("12345678");
  });
  it("standalone notes and title case", async () => {
    const { titleOf: t, titleCase, sentenceCaseTitle } = await import("../src/core/zotero.js");
    expect(t({ ...emptyItem("note"), notes: [{ key: "n", note: "<p>İlk satır</p><p>ikinci</p>", dateModified: "" }] })).toBe("İlk satır");
    expect(titleCase("kelâm ilminin doğuşu ve gelişimi")).toBe("Kelâm İlminin Doğuşu ve Gelişimi");
    expect(sentenceCaseTitle("KELÂM İLMİ: GİRİŞ")).toBe("Kelâm ilmi: Giriş");
  });
});

describe("DOI lookup", () => {
  it("falls back from Crossref to doi.org and flattens Crossref lists", async () => {
    const { lookupDoi } = await import("../src/core/importers.js");
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.includes("crossref")) return new Response("Resource not found.", { status: 404 });
      return new Response(JSON.stringify({ type: "monograph", title: ["Osmanlı Düşünce Tarihi"], author: [{ family: "Kara", given: "İsmail" }], publisher: "Dergâh", "publisher-place": "İstanbul", ISBN: ["9789759951234", "9789759951234"], issued: { "date-parts": [[2015]] }, DOI: "10.5000/abc" }));
    }) as typeof fetch;
    const item = await lookupDoi("10.5000/abc", fake);
    expect(urls.length).toBe(2);
    expect(item.itemType).toBe("book");
    expect(item.fields).toMatchObject({ title: "Osmanlı Düşünce Tarihi", publisher: "Dergâh", place: "İstanbul", ISBN: "9789759951234", date: "2015", DOI: "10.5000/abc" });
  });
  it("says why it failed", async () => {
    const { lookupDoi } = await import("../src/core/importers.js");
    await expect(lookupDoi("10.1/none", (async () => new Response("", { status: 404 })) as typeof fetch)).rejects.toThrow("hiçbir kayıt kuruluşunda");
    await expect(lookupDoi("10.1/none", (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch)).rejects.toThrow("ulaşılamadı");
  });
});

describe("library copy in the document", () => {
  it("packs, unpacks and merges (newer wins, missing added)", async () => {
    const { packLibrary, unpackLibrary, mergeLibrary } = await import("../src/core/librarycopy.js");
    const many = Array.from({ length: 500 }, (_, i) => ({ ...GAZZALI, key: `G${i}`, fields: { ...GAZZALI.fields, title: `Eser ${i}` } }));
    const xml = packLibrary({ items: many, collections: [{ key: "C", name: "Tez" }], searches: [], tagColors: [] });
    expect(xml.length).toBeLessThan(40000);
    const copy = unpackLibrary(xml)!;
    expect(copy.items).toHaveLength(500);
    const newer = { ...many[0]!, fields: { ...many[0]!.fields, title: "Yeni" }, dateModified: "2099-01-01T00:00:00Z" };
    const m = mergeLibrary({ items: [many[1]!], collections: [], searches: [] }, { ...copy, items: [newer, ...copy.items.slice(1)] });
    expect(m.items).toHaveLength(500);
    expect(m.added).toBe(499);
    expect(m.items.find((i) => i.key === "G0")!.fields.title).toBe("Yeni");
    expect(unpackLibrary("<x/>")).toBeNull();
  });
});

describe("ISBN: several catalogues", async () => {
  const { isbnForms, lookupIsbnAll, marcToItem } = await import("../src/core/isbn.js");
  const marc = readFileSync(new URL("./fixtures/k10plus-9786054791712.xml", import.meta.url), "utf8");

  it("ISBN-10 and ISBN-13 forms", () => {
    expect(isbnForms("975-437-076-1")).toEqual(["9789754370768", "9754370761"]);
    expect(isbnForms("9789754370768")).toEqual(["9789754370768", "9754370761"]);
  });

  it("reads a K10plus MARC record: roles, place, publisher; no publisher series, no first edition", () => {
    const it = marcToItem(marc)!;
    expect(it.fields.title).toBe("Kelam ve akaid risaleleri");
    expect(it.fields.place).toBe("İstanbul");
    expect(it.fields.publisher).toBe("Misvak Neşriyat");
    expect(it.fields.series).toBeUndefined();
    expect(it.fields.edition).toBeUndefined();
    expect(it.creators.map((c) => c.creatorType)).toEqual(["author", "translator", "editor"]);
  });

  it("asks all catalogues, keeps the fullest record and fills gaps from the others", async () => {
    const fetchFn = async (url: string) => {
      if (url.includes("k10plus")) return new Response(marc);
      if (url.includes("openlibrary")) return new Response(JSON.stringify({ "ISBN:9786054791712": { title: "Kelam ve Akaid Risaleleri", number_of_pages: 240 } }));
      if (url.includes("googleapis")) return new Response("{}", { status: 429 });
      if (url.includes("crossref")) return new Response(JSON.stringify({ message: { items: [] } }));
      return new Response("<x/>");
    };
    const it = await lookupIsbnAll("978-605-4791-71-2", { fetchFn });
    expect(it.fields.publisher).toBe("Misvak Neşriyat");
    expect(it.fields.numPages).toBe("240");
    expect(it.fields.ISBN).toBe("9786054791712");
  });

  it("says when nothing is found and when Google's quota is the reason", async () => {
    const fetchFn = async (url: string) => (url.includes("googleapis") ? new Response("{}", { status: 429 }) : url.includes("openlibrary") || url.includes("crossref") ? new Response("{}") : new Response("<x/>"));
    await expect(lookupIsbnAll("9786258910605", { fetchFn })).rejects.toThrow(/bulunamadı.*kota/);
  });
});

describe("İSNAD spelling on the way in", async () => {
  const { isnadTitle, isnadName, isnadPlace, isnadPublisher, shortTitleOf, cleanYear } = await import("../src/core/isnadstyle.js");
  const { autoFix } = await import("../src/core/isnad.js");

  it("title case: Turkish and English words capitalised, Arabic only the first word", () => {
    expect(isnadTitle("Kelam ve akaid risaleleri")).toBe("Kelam ve Akaid Risaleleri");
    expect(isnadTitle("İslam’da inanç esasları")).toBe("İslam’da İnanç Esasları");
    expect(isnadTitle("Kur’an mesajı: meal-tefsir")).toBe("Kur’an Mesajı: Meal-Tefsir");
    expect(isnadTitle("Kur’ân-ı Kerîm meâli")).toBe("Kur’ân-ı Kerîm Meâli");
    expect(isnadTitle("the venture of islam: conscience and history")).toBe("The Venture of Islam: Conscience and History");
    expect(isnadTitle("İLHAD NE BÜYÜK CEHALETTİR!")).toBe("İlhad Ne Büyük Cehalettir!");
    expect(isnadTitle("El-makâsıd: kelâm ilminin maksatları")).toBe("el-Makâsıd: Kelâm İlminin Maksatları");
    // Left alone: Arabic titles, acronyms, Roman numerals, German.
    for (const t of ["el-Maḥsûl fî ʿilmi uṣûli’l-fıḳh", "İhyâü ulûmi’d-dîn", "İSNAD Atıf Sistemi", "Uluslararası İlişkiler-I", "Geschichte des arabischen Schrifttums", "el-Fihrisü’ş-şâmil: el-fıkh ve usûluhû"]) expect(isnadTitle(t)).toBe(t);
  });

  it("names, places, publishers, years, short titles", () => {
    expect(isnadName("MARANGOZOĞLU")).toBe("Marangozoğlu");
    expect(isnadName("el-gazzâlî")).toBe("el-Gazzâlî");
    expect(isnadPlace("Istanbul")).toBe("İstanbul");
    expect(isnadPlace("İstanbul, Türkiye")).toBe("İstanbul");
    expect(isnadPlace("Beirut")).toBe("Beyrut");
    expect(isnadPlace("London")).toBe("London");
    expect(isnadPublisher("Ketebe", true)?.value).toBe("Ketebe Yayınları");
    expect(isnadPublisher("Otuken Nesriyat", true)?.value).toBe("Ötüken Neşriyat");
    expect(isnadPublisher("isam yay.", true)?.value).toBe("İSAM Yayınları");
    expect(isnadPublisher("Ketebe Yayınevi", true)).toBeNull();
    expect(isnadPublisher("Türk Dil Kurumu", true)).toBeNull();
    expect(isnadPublisher("Brill", false)).toBeNull();
    expect(cleanYear("[2015?]")).toBe("2015");
    expect(cleanYear("1413/1993")).toBeNull();
    expect(shortTitleOf("el-Maḥsûl fî ʿilmi uṣûli’l-fıḳh")).toBe("el-Maḥsûl");
    expect(shortTitleOf("The Venture of Islam: Conscience and History")).toBe("The Venture of Islam");
    expect(shortTitleOf("İslam’da İnanç Esasları")).toBeNull();
    // As the İSNAD guide's own records shorten them.
    expect(shortTitleOf("Telḫîṣü’l-edille li-ḳavâʿidi’t-tevḥîd")).toBe("Telḫîṣü’l-edille");
    expect(shortTitleOf("Miftâḥu’s-saʿâde ve miṣbâḥu’s-siyâde fî mevżûʿâti’l-ʿulûm")).toBe("Miftâḥu’s-saʿâde");
    expect(shortTitleOf("Kitāb al-Ṭarīgah al-Muḥammadīyah")).toBe("al-Ṭarīgah al-Muḥammadīyah");
    expect(shortTitleOf("Mâtürîdî Kelâm Ekolünde Nesefîler ve Ebû Hafs Ömer en-Nesefî’nin İtikâdî Görüşleri")).toBe("Mâtürîdî Kelâm Ekolünde Nesefîler");
    expect(shortTitleOf("İslam Ceza Hukukunda Suça Teşebbüsten Vazgeçme")).toBe("Suça Teşebbüsten Vazgeçme");
    expect(shortTitleOf("Konsiller Tarihi İznik’ten II. Vatikan’a")).toBe("Konsiller Tarihi");
    expect(shortTitleOf("Galata Mahkemesi 90 Numaralı Sicil (1073-1074/1663)")).toBe("Galata Mahkemesi 90 Numaralı Sicil");
    expect(shortTitleOf("İstanbul Vakıfları Tahrir Defteri 953 Tarihli")).toBe("İstanbul Vakıfları Tahrir Defteri");
    expect(shortTitleOf("Klasik Dönem İslam Düşüncesinde İrade Hürriyeti")).toBe("İrade Hürriyeti");
    expect(shortTitleOf("Sessiz Diplomasi: Osmanlı Topraklarında Ağırlanan Romanovlar")).toBe("Sessiz Diplomasi");
    expect(shortTitleOf("Tasavvuf Üzerine")).toBeNull();
  });

  it("lost Turkish letters come back; correct and English text is left alone", async () => {
    const { restoreTurkish } = await import("../src/core/isnadstyle.js");
    expect(restoreTurkish("Recep Tayyip Erdogan Universitesi")).toBe("Recep Tayyip Erdoğan Üniversitesi");
    expect(restoreTurkish("Ataturk Universitesi Ilahiyat Fakultesi")).toBe("Atatürk Üniversitesi İlahiyat Fakültesi");
    expect(restoreTurkish("ISAM Yayinlari")).toBe("İSAM Yayınları");
    expect(restoreTurkish("Istanbul")).toBe("İstanbul");
    for (const t of ["The Venture of Islam", "Islamic Law", "Brill", "Recep Tayyip Erdoğan Üniversitesi", "el-Maḥsûl"]) expect(restoreTurkish(t)).toBe(t);
    const thesis = emptyItem("thesis", "manual");
    thesis.fields = { title: "Bir Tez", university: "Recep Tayyip Erdogan Universitesi", place: "Rize" };
    expect(autoFix(thesis).item.fields.university).toBe("Recep Tayyip Erdoğan Üniversitesi");
  });

  it("autoFix: a catalogue record becomes an İSNAD record; a short publisher stays a warning", () => {
    const it = emptyItem("book", "isbn");
    it.fields = { title: "kelam ilminin doğuşu ve gelişimi: başlangıçtan günümüze", place: "Istanbul", publisher: "Otuken Nesriyat", date: "c2015" };
    it.creators = [{ creatorType: "author", lastName: "YILMAZ", firstName: "AHMET" }];
    const r = autoFix(it);
    expect(r.item.fields).toMatchObject({ title: "Kelam İlminin Doğuşu ve Gelişimi: Başlangıçtan Günümüze", place: "İstanbul", publisher: "Ötüken Neşriyat", date: "2015", shortTitle: "Kelam İlminin Doğuşu ve Gelişimi" });
    expect(r.item.creators[0]).toMatchObject({ lastName: "Yılmaz", firstName: "Ahmet" });
    const short = emptyItem("book", "isbn");
    short.fields = { title: "Bir Kitap", place: "Ankara", publisher: "Gündoğan" };
    expect(autoFix(short).item.fields.publisher).toBe("Gündoğan");
    expect(checkItem(short).some((i) => i.code === "publisher-short")).toBe(true);
  });
});

describe("Mevzuat: madde (md.)", async () => {
  const { parseQuick } = await import("../src/core/search.js");
  it("\"fsek md. 35/4\" is an article, not volume 35 page 4", () => {
    expect(parseQuick("fsek md. 35/4")).toEqual({ words: "fsek", locator: "35/4", label: "sub verbo" });
  });
});

describe("hicrî/milâdî", async () => {
  const { hijriToGregorian, hijriPair } = await import("../src/core/isnadstyle.js");
  it("the guide's pairs", () => {
    for (const [h, g] of [[1408, 1988], [1364, 1945], [1431, 2010], [1432, 2011], [1424, 2003]]) expect(hijriToGregorian(h)).toBe(g);
  });
  it("a lone hicrî year on an Arabic print gets its milâdî pair; Turkish prints and pairs are left alone", () => {
    expect(hijriPair("1408", "Kahire", "Mektebetü’l-Külliyyâti’l-Ezheriyye")).toBe("1408/1988");
    expect(hijriPair("1418", "", "Dâru’l-Kütübi’l-İlmiyye")).toMatch(/^1418\/199[78]$/);
    expect(hijriPair("1408/1988", "Kahire", "")).toBeNull();
    expect(hijriPair("1988", "Kahire", "")).toBeNull();
    expect(hijriPair("1325", "İstanbul", "Matbaa-i Âmire")).toBeNull();
  });
});

describe("kaynakça türlere ayrılır", async () => {
  const { withSections } = await import("../src/core/docstate.js");
  it("bölüm başlıkları, sırayla; boş bölüm yok; arşiv belgesi ayrı", () => {
    const mk = (key: string, itemType: string, fields: Record<string, string> = {}): Item => ({ ...emptyItem(itemType, "m"), key, fields: { title: key, ...fields } });
    const items = { A: mk("A", "book"), B: mk("B", "journalArticle"), C: mk("C", "manuscript"), D: mk("D", "letter", { archive: "BOA" }), E: mk("E", "webpage") };
    const bib = { entries: ["A", "B", "C", "D", "E"].map((k) => ({ ids: [k], html: k })), hangingIndent: true, lineSpacing: 1, entrySpacing: 0, secondFieldAlign: false };
    const out = withSections(bib, items).entries.map((e) => (e.heading ? `# ${e.html}` : e.html));
    expect(out).toEqual(["# Arşiv Belgeleri", "D", "# Yazma Eserler", "C", "# Kitaplar ve Kitap Bölümleri", "A", "# Makaleler ve Bildiriler", "B", "# Elektronik Kaynaklar", "E"]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitPlan, emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer, styleMeta } from "../src/core/engine.js";
import { htmlToSegments, htmlToText } from "../src/core/html.js";
import { cleanDoi, cleanIsbn, detectFormat, parseFile, splitName, zoteroToLibrary } from "../src/core/importers.js";
import { SearchIndex, authorLine, fold } from "../src/core/search.js";
import { BUILTIN_STYLES } from "../src/core/styles.js";
import type { CslItem, LibraryItem } from "../src/core/types.js";

const dir = new URL("../data/styles/", import.meta.url);
const style = (id: string) => readFileSync(new URL(`${id}.csl`, dir), "utf8");
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8");
  } catch {
    return undefined;
  }
};

const GAZZALI: CslItem = { id: "a", type: "book", title: "İhyâü ulûmi'd-dîn", author: [{ family: "Gazzâlî", given: "Ebû Hâmid" }], publisher: "Dâru'l-Ma'rife", "publisher-place": "Beyrut", issued: { "date-parts": [[1982]] } };
const YILMAZ: CslItem = { id: "b", type: "article-journal", title: "Kelâm ilminin tarihî gelişimi", author: [{ family: "Yılmaz", given: "Ahmet" }], "container-title": "İslâm Araştırmaları Dergisi", volume: "12", page: "45-78", issued: { "date-parts": [[2004]] } };
const lib = (csl: CslItem, tags: string[] = []): LibraryItem => ({ key: csl.id, csl, source: "test", tags });

describe("fold", () => {
  it("ignores Turkish case, circumflex and apostrophes", () => {
    expect(fold("İhyâü ‘Ulûmi’d-Dîn")).toBe("ihyau ulumid-din");
    expect(fold("IŞIK ışık")).toBe("isik isik");
  });
});

describe("SearchIndex", () => {
  const index = new SearchIndex([lib(GAZZALI), lib(YILMAZ, ["kelam"]), lib({ id: "c", type: "book", title: "Gazzâlî üzerine", author: [{ family: "Kara", given: "Ali" }], issued: { "date-parts": [[1990]] } })]);
  it("finds by author, title word and year without diacritics", () => {
    expect(index.search("gazzali ihya").map((h) => h.item.key)).toEqual(["a"]);
    expect(index.search("yilmaz 2004")[0]!.item.key).toBe("b");
    expect(index.search("kelam").map((h) => h.item.key)).toEqual(["b"]);
  });
  it("ranks the author above a title mention", () => {
    expect(index.search("gazzali").map((h) => h.item.key)).toEqual(["a", "c"]);
  });
  it("is fast on a large library", () => {
    const many = Array.from({ length: 20000 }, (_, i) => lib({ ...YILMAZ, id: `x${i}`, title: `Eser ${i}` }));
    const big = new SearchIndex(many);
    const t = performance.now();
    big.search("yilmaz eser 19999");
    expect(performance.now() - t).toBeLessThan(100);
  });
  it("short author line", () => {
    expect(authorLine({ id: "z", type: "book", author: [{ family: "A" }, { family: "B" }] })).toBe("A ve B");
  });
});

describe("htmlToSegments", () => {
  it("keeps italics, small caps and entities", () => {
    const s = htmlToSegments('Gazzâlî, <i>İhyâ</i> &#38; <span style="font-variant:small-caps;">x</span>.');
    expect(s).toEqual([{ text: "Gazzâlî, " }, { text: "İhyâ", italic: true }, { text: " & " }, { text: "x", smallCaps: true }, { text: "." }]);
  });
  it("flattens bibliography divs", () => {
    expect(htmlToText('  <div class="csl-entry"><div class="csl-left-margin">[1]</div><div class="csl-right-inline">A. B.</div></div>\n')).toBe("[1] A. B.");
  });
  it("normal inside italic", () => {
    expect(htmlToSegments('<i>a <span style="font-style:normal;">b</span></i>')).toEqual([{ text: "a ", italic: true }, { text: "b" }]);
  });
});

describe("Renderer", () => {
  it("knows every built-in style", () => {
    for (const s of BUILTIN_STYLES) {
      const m = styleMeta(style(s.id));
      expect(m.note, s.id).toBe(s.note);
      expect(m.hasBibliography).toBe(true);
    }
  });
  it("ISNAD notes: full first, short later", () => {
    const r = new Renderer(style("isnad-dipnotlu"), locales);
    r.setItems({ a: GAZZALI, b: YILMAZ });
    const out = r.renderCitations([
      { id: "c1", items: [{ id: "a", locator: "12" }], noteIndex: 1 },
      { id: "c2", items: [{ id: "b" }], noteIndex: 2 },
      { id: "c3", items: [{ id: "a", locator: "15" }], noteIndex: 3 },
    ]);
    expect(htmlToText(out.get("c1")!)).toBe("Ebû Hâmid Gazzâlî, İhyâü ulûmi’d-dîn (Beyrut: Dâru’l-Ma’rife, 1982), 12.");
    expect(htmlToText(out.get("c3")!)).toBe("Gazzâlî, İhyâü ulûmi’d-dîn, 15.");
    const bib = r.bibliography()!;
    expect(bib.entries.map((e) => htmlToText(e.html))).toEqual([
      "Gazzâlî, Ebû Hâmid. İhyâü ulûmi’d-dîn. Beyrut: Dâru’l-Ma’rife, 1982.",
      "Yılmaz, Ahmet. “Kelâm ilminin tarihî gelişimi”. İslâm Araştırmaları Dergisi 12 (2004), 45-78.",
    ]);
  });
  it("APA in-text", () => {
    const r = new Renderer(style("apa"), locales, "tr-TR");
    r.setItems({ a: GAZZALI, b: YILMAZ });
    const out = r.renderCitations([{ id: "c1", items: [{ id: "a", locator: "12" }, { id: "b" }], noteIndex: 0 }]);
    expect(htmlToText(out.get("c1")!)).toBe("(Gazzâlî, 1982, s. 12; Yılmaz, 2004)");
    expect(htmlToText(r.preview([{ id: "b", locator: "3", label: "volume" }]))).toContain("Yılmaz, 2004");
  });
  it("renders all styles without errors", () => {
    for (const s of BUILTIN_STYLES) {
      const r = new Renderer(style(s.id), locales, "tr-TR");
      r.setItems({ a: GAZZALI, b: YILMAZ });
      const out = r.renderCitations([{ id: "c1", items: [{ id: "a" }], noteIndex: 1 }, { id: "c2", items: [{ id: "b" }], noteIndex: 2 }]);
      expect(htmlToText(out.get("c1")!).length, s.id).toBeGreaterThan(2);
      expect(r.bibliography()!.entries.length, s.id).toBe(2);
    }
  });
});

describe("refresh plan", () => {
  it("rewrites only what changed and follows document order", () => {
    const r = new Renderer(style("isnad-dipnotlu"), locales);
    const st = emptyState();
    putCitation(st, "c1", [{ id: "a", locator: "12" }], { a: GAZZALI });
    putCitation(st, "c2", [{ id: "a", locator: "15" }], { a: GAZZALI });
    let plan = planRefresh(st, [{ id: "c1", noteIndex: 1, text: "" }, { id: "c2", noteIndex: 2, text: "" }], r);
    expect(plan.updates.size).toBe(2);
    expect(htmlToText(plan.updates.get("c2")!)).toBe("Gazzâlî, İhyâü ulûmi’d-dîn, 15.");
    commitPlan(st, plan);
    plan = planRefresh(st, [{ id: "c1", noteIndex: 1, text: "x" }, { id: "c2", noteIndex: 2, text: "x" }], r);
    expect(plan.updates.size).toBe(0);
    expect(plan.bibliographyChanged).toBe(false);
    // c2 moved before c1: both change (full form moves to the first one).
    plan = planRefresh(st, [{ id: "c2", noteIndex: 1, text: "x" }, { id: "c1", noteIndex: 2, text: "x" }], r);
    expect([...plan.updates.keys()].sort()).toEqual(["c1", "c2"]);
    expect(plan.orphans).toEqual([]);
    plan = planRefresh(st, [{ id: "zz", noteIndex: 1, text: "x" }], r);
    expect(plan.orphans).toEqual(["zz"]);
    expect(plan.unused).toEqual(["a"]);
  });
  it("renders 1000 notes quickly", () => {
    const r = new Renderer(style("isnad-dipnotlu"), locales);
    const st = emptyState();
    const works: Record<string, CslItem> = {};
    for (let i = 0; i < 200; i++) works[`w${i}`] = { ...GAZZALI, id: `w${i}`, title: `Eser ${i}` };
    const found = Array.from({ length: 1000 }, (_, i) => {
      putCitation(st, `c${i}`, [{ id: `w${i % 200}`, locator: String(i) }], works);
      return { id: `c${i}`, noteIndex: i + 1, text: "" };
    });
    const t = performance.now();
    const plan = planRefresh(st, found, r);
    expect(plan.updates.size).toBe(1000);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe("importers", () => {
  it("detects formats", () => {
    expect(detectFormat("[{}]")).toBe("csl-json");
    expect(detectFormat("@book{x,}")).toBe("bibtex");
    expect(detectFormat("TY  - BOOK\n")).toBe("ris");
  });
  it("BibTeX with LaTeX accents", async () => {
    const [x] = await parseFile("@book{gazzali1982, author={Gazz{\\^a}l{\\^\\i}, Eb{\\^u} H{\\^a}mid}, title={{\\.I}hy{\\^a}}, year={1982}}", "a.bib");
    expect(x!.key).toBe("gazzali1982");
    expect(x!.csl.author![0]!.family).toBe("Gazzâlî");
    expect(x!.csl.title).toBe("İhyâ");
  });
  it("RIS gets a stable id", async () => {
    const ris = "TY  - JOUR\nAU  - Yılmaz, Ahmet\nTI  - Kelâm\nPY  - 2004\nER  - \n";
    const [a] = await parseFile(ris, "x.ris");
    const [b] = await parseFile(ris, "x.ris");
    expect(a!.key).toBe(b!.key);
    expect(a!.csl.id).toBe(a!.key);
  });
  it("Zotero objects", () => {
    const items = zoteroToLibrary(
      [
        { key: "ABCD1234", version: 5, data: { itemType: "book", collections: ["C1"], tags: [{ tag: "kelam" }] }, csljson: { id: "1/ABCD1234", type: "book", title: "T" } },
        { key: "NOTE0001", version: 5, data: { itemType: "note" } },
      ],
      "users/1",
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.csl.id).toBe("ABCD1234");
    expect(items[0]!.tags).toEqual(["kelam"]);
  });
  it("DOI, ISBN and names", () => {
    expect(cleanDoi("https://doi.org/10.1000/xyz.")).toBe("10.1000/xyz");
    expect(cleanIsbn("978-975-389-123-4")).toBe("9789753891234");
    expect(splitName("Ahmet Yılmaz")).toEqual({ family: "Yılmaz", given: "Ahmet" });
  });
});

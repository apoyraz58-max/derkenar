import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { catalogItem, catalogSource, searchCatalog, type CatalogEntry } from "../src/core/shamela.js";
import { plainTranscription } from "../src/core/transcription.js";

const styles = new URL("../data/styles/", import.meta.url);
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, styles), "utf8");
  } catch {
    return undefined;
  }
};

describe("transkripsiyonsuz yazım", () => {
  it("drops DİA's marks the way DİA writes names in running text", () => {
    expect(plainTranscription("el-Câmiʿu’ṣ-ṣaḥîḥ")).toBe("el-Câmiu’s-sahîh");
    expect(plainTranscription("Aʿyânü’l-ʿaṣr ve aʿvânü’n-naṣr")).toBe("A‘yânü’l-asr ve a‘vânü’n-nasr");
    expect(plainTranscription("İġās̱etü’l-lehfân fî meṣâyidi’ş-şeyṭân")).toBe("İğâsetü’l-lehfân fî mesâyidi’ş-şeytân");
    expect(plainTranscription("Mecmaʿu’z-zevâʾid ve menbaʿu’l-fevâʾid")).toBe("Mecmau’z-zevâid ve menbau’l-fevâid");
    expect(plainTranscription("Aḥkâmü’l-Ḳurʾân")).toBe("Ahkâmü’l-Kur’ân");
    expect(plainTranscription("eṭ-Ṭabaḳātü’l-kübrâ")).toBe("et-Tabakâtü’l-kübrâ");
    expect(plainTranscription("el-ʿİlel")).toBe("el-İlel");
    expect(plainTranscription("Merâtibü’l-icmâʿ")).toBe("Merâtibü’l-icmâ‘");
    expect(plainTranscription("Esmâʾü’r-ricâl ve’l-esmâʾ")).toBe("Esmâü’r-ricâl ve’l-esmâ");
    // Only a capital marked letter in it.
    expect(plainTranscription("el-Ḳader")).toBe("el-Kader");
    expect(plainTranscription("Tefsîrü’l-Ḥaddâd")).toBe("Tefsîrü’l-Haddâd");
    // A title not transcribed is left alone (a Turkish apostrophe included).
    expect(plainTranscription("Kur’an’da Ahlak")).toBe("Kur’an’da Ahlak");
  });
});

const entry: CatalogEntry = {
  id: 5756,
  ar: "عمدة القاري شرح صحيح البخاري",
  title: "ʿUmdetü’l-ḳārî şerḥu Ṣaḥîḥi’l-Buḫârî",
  plain: "Umdetü’l-kârî şerhu Sahîhi’l-Buhârî",
  authors: [{ dia: "Aynî, Bedreddin", diaFull: "Ebû Muhammed (Ebü’s-Senâ) Bedrüddîn Mahmûd b. Ahmed b. Mûsâ b. Ahmed el-Aynî", group: "Arap", shamela: "بدر الدين العيني", death: 855, match: "kesin" }],
};

describe("Şamile kataloğu", () => {
  it("an entry becomes an İSNAD record that says where it came from", () => {
    const it = catalogItem(entry);
    expect(it).toMatchObject({ itemType: "book", source: "samile", fields: { title: entry.title, language: "ar", libraryCatalog: "el-Mektebetü’ş-Şâmile" } });
    expect(it.creators[0]).toEqual({ creatorType: "author", lastName: "Aynî", firstName: "Bedreddin el-" });
    expect(catalogSource(it)).toEqual({ catalog: "el-Mektebetü’ş-Şâmile", id: "5756" });
    expect(it.fields.extra).toContain("Transkripsiyonsuz başlık: Umdetü’l-kârî şerhu Sahîhi’l-Buhârî");
  });
  it("the document chooses the transcribed or the plain title; the record stays the same", () => {
    const it = { ...catalogItem(entry), key: "UMDE" };
    const render = (plain: boolean) => {
      const st = emptyState();
      st.plainTitles = plain;
      putCitation(st, "a", [{ id: "UMDE", locator: "12" }], { UMDE: it });
      const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales));
      return { note: htmlToText(p.updates.get("a")!), bib: htmlToText(p.bibliography!.entries[0]!.html) };
    };
    const t = render(false);
    const p = render(true);
    expect(t.note).toContain("ʿUmdetü’l-ḳārî şerḥu Ṣaḥîḥi’l-Buḫârî");
    expect(p.note).toContain("Umdetü’l-kârî şerhu Sahîhi’l-Buhârî");
    // The source program is not printed.
    expect(`${t.note} ${t.bib}`).not.toContain("Şâmile");
    expect(it.fields.title).toBe(entry.title);
  });
});

describe("the book card", () => {
  it("brings the print's place, publisher, year, edition and the muhakkiks; the first edition is not written", () => {
    const it = catalogItem({ ...entry, thk: "Muḥammed Fuâd ʿAbdülbâḳī; Muḥibbüddîn el-Ḫaṭîb", ed: "Dârü’l-maʿrife", place: "Beyrut", date: "1379/1959", edition: 1, volumes: 25 });
    expect(it.fields).toMatchObject({ publisher: "Dârü’l-maʿrife", place: "Beyrut", date: "1379/1959", numberOfVolumes: "25" });
    expect(it.fields.edition).toBeUndefined();
    expect(it.creators.filter((c) => c.creatorType === "muhakkik").map((c) => c.name)).toEqual(["Muḥammed Fuâd ʿAbdülbâḳī", "Muḥibbüddîn el-Ḫaṭîb"]);
    expect(catalogItem({ ...entry, edition: 3 }).fields.edition).toBe("3");
  });
  it("a thesis on the card becomes a thesis: university and degree, no publisher", () => {
    const it = catalogItem({ ...entry, university: "Câmiʿatü’l-İmâm Muḥammed b. Suʿûd el-İslâmiyye", thesisType: "Yüksek Lisans Tezi", place: "Riyad", date: "1438/2017", ed: "x" });
    expect(it.itemType).toBe("thesis");
    expect(it.fields).toMatchObject({ university: "Câmiʿatü’l-İmâm Muḥammed b. Suʿûd el-İslâmiyye", thesisType: "Yüksek Lisans Tezi", place: "Riyad" });
    expect(it.fields.publisher).toBeUndefined();
  });
  it("an entry from another source keeps its own source and identifier", () => {
    const it = catalogItem({ ...entry, id: 900001, catalog: "OpenITI", ref: "0255Jahiz.Bayan" });
    expect(it.fields.libraryCatalog).toBe("OpenITI");
    expect(catalogSource(it)).toEqual({ catalog: "OpenITI", id: "0255Jahiz.Bayan" });
  });
  it("an article in a journal issue becomes an article: the journal, its volume and issue, no publisher or place", () => {
    const it = catalogItem({ ...entry, journal: "Mecelletü’l-Câmiati’l-İslâmiyye", volume: "34", issue: "115", place: "Medine", date: "1422/2002", ed: "x" });
    expect(it.itemType).toBe("journalArticle");
    expect(it.fields).toMatchObject({ publicationTitle: "Mecelletü’l-Câmiati’l-İslâmiyye", volume: "34", issue: "115", date: "1422/2002" });
    expect(it.fields.publisher).toBeUndefined();
    expect(it.fields.place).toBeUndefined();
  });
});

describe("searching the catalog", () => {
  const catalog = { name: "el-Mektebetü’ş-Şâmile", source: "test", entries: [entry, { ...entry, id: 1, ar: "المصنف", title: "el-Muṣannef", plain: "el-Musannef", authors: [{ dia: "Abdürrezzâk es-San‘ânî", shamela: "عبد الرزاق الصنعاني", death: 211 }] }] };
  it("finds a book by its title with or without marks, by its author, or in Arabic", () => {
    const ids = (q: string) => searchCatalog(q, catalog).map((e) => e.id);
    expect(ids("umdetul kari")).toEqual([5756]);
    expect(ids("ʿUmdetü’l-ḳārî")).toEqual([5756]);
    expect(ids("Aynî umde")).toEqual([5756]);
    expect(ids("عمدة القاري")).toEqual([5756]);
    expect(ids("musannef")).toEqual([1]);
    expect(ids("xyz")).toEqual([]);
  });
});

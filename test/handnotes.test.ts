import { describe, expect, it } from "vitest";
import { readHandNotes, splitNote } from "../src/core/handnotes.js";
import { emptyItem } from "../src/core/zotero.js";

const lib = (() => {
  const k = emptyItem("journalArticle");
  k.creators = [{ creatorType: "author", firstName: "Sönmez", lastName: "Kutlu" }];
  k.fields = { title: "İlk Mürciî Metinler", publicationTitle: "Ankara Üniversitesi İlahiyat Fakültesi Dergisi", volume: "37", date: "1997", pages: "317-331" };
  return [k];
})();

const show = (notes: string[]) =>
  readHandNotes(notes, lib).map((n) => (n.refs ? n.refs.map((r) => `${r.prefix ? r.prefix + " " : ""}${r.item.fields.title}${r.isNew ? "*" : ""}${r.volume ? ` c.${r.volume}` : ""}${r.locator ? ` s.${r.locator}` : ""}`).join(" ; ") : `KALDI: ${n.reason}`));

describe("hand-typed footnotes", () => {
  it("splits on ; outside quotes and parentheses", () => {
    expect(splitNote("A, “x; y”, 3; B (İstanbul: Z; Y, 2000), 4.")).toEqual(["A, “x; y”, 3", "B (İstanbul: Z; Y, 2000), 4."]);
  });
  it("reads full, short, a.g.e. and library works", () => {
    expect(
      show([
        "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45.",
        "a.g.e., 46.",
        "Sönmez Kutlu, “İlk Mürciî Metinler”, Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 320.",
        "Bk. Kara, Tasavvuf ve Tarikatlar, 47-49; Kutlu, “İlk Mürciî Metinler”, 322.",
        "Bu konuda farklı görüşler için ileride bakılacaktır.",
        "Ebû Hâmid Muhammed el-Gazzâlî, el-Mustasfâ, thk. Hamza b. Züheyr Hâfız (Medine: el-Câmiatü'l-İslâmiyye, 1413/1993), 2/45.",
        "Gazzâlî, el-Mustasfâ, 1/12.",
        "Ibid.",
        "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 50.",
      ]),
    ).toEqual([
      "Tasavvuf ve Tarikatlar Tarihi* s.45",
      "Tasavvuf ve Tarikatlar Tarihi* s.46",
      "İlk Mürciî Metinler s.320",
      "bk. Tasavvuf ve Tarikatlar Tarihi* s.47-49 ; İlk Mürciî Metinler s.322",
      "KALDI: künye olarak okunamadı",
      "el-Mustasfâ* c.2 s.45",
      "el-Mustasfâ* c.1 s.12",
      "el-Mustasfâ* c.1",
      "Tasavvuf ve Tarikatlar Tarihi* s.50",
    ]);
    // One record per work, however often it is cited.
    const r = readHandNotes(["Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45.", "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 50."], lib);
    expect(r[0]!.refs![0]!.item).toBe(r[1]!.refs![0]!.item);
  });
});

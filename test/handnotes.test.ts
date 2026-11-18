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

describe("hand-typed footnotes, eski usul", () => {
  it("reads the pre-İSNAD form of Turkish theses", () => {
    expect(
      show([
        "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi, Dergâh Yay., İstanbul 2005, s. 45.",
        "Kara, a.g.e., s. 47.",
        "Süleyman Uludağ, Tasavvuf Terimleri Sözlüğü, Marifet Yayınları, İstanbul 1995, s. 12-13.",
        "Kara, a.g.e., s. 50; Uludağ, a.g.e., s. 14.",
        'Ahmet Yaşar Ocak, "Kalenderîler", Belleten, XLV/1 (1981), s. 45.',
        "Ocak, a.g.m., s. 47.",
        "Uludağ, Tasavvuf Terimleri, s. 20.",
        "İbn Haldun, Mukaddime, çev. Süleyman Uludağ, Dergâh Yayınları, İstanbul 1982, I, 245.",
        "Geniş bilgi için bk. Kara, a.g.e., s. 60.",
        "KARA, Mustafa, Tasavvuf ve Tarikatlar Tarihi, Dergâh Yayınları, İstanbul, 2005, c. II, s. 12.",
        "Bu konuda Kara'nın görüşleri tartışmalıdır.",
      ]),
    ).toEqual([
      "Tasavvuf ve Tarikatlar Tarihi* s.45",
      "Tasavvuf ve Tarikatlar Tarihi* s.47",
      "Tasavvuf Terimleri Sözlüğü* s.12-13",
      "Tasavvuf ve Tarikatlar Tarihi* s.50 ; Tasavvuf Terimleri Sözlüğü* s.14",
      "Kalenderîler* s.45",
      "Kalenderîler* s.47",
      "Tasavvuf Terimleri Sözlüğü* s.20",
      "Mukaddime* c.I s.245",
      "geniş bilgi için bk. Tasavvuf ve Tarikatlar Tarihi* s.60",
      "Tasavvuf ve Tarikatlar Tarihi* c.II s.12",
      "KALDI: künye olarak okunamadı",
    ]);
  });
});

import { readInText } from "../src/core/handnotes.js";

describe("hand-typed in-text citations", () => {
  const mk = (last: string, year: string, title: string) => {
    const i = emptyItem("book");
    i.creators = [{ creatorType: "author", firstName: "X", lastName: last }];
    i.fields = { title, date: year };
    return i;
  };
  const libr = [mk("Kara", "2005", "Tasavvuf"), mk("Uludağ", "1995", "Sözlük"), mk("Ocak", "1996", "Bakışlar"), mk("Ocak", "1996", "Kalenderîler")];
  it("matches author and year, takes the page", () => {
    const r = readInText("Metin (Kara, 2005: 45). Başka (Uludag 1995, s. 12-13; bk. Kara, 2005). Yine (Ocak, 1996b, 7) ve (Ocak, 1996) ile (bkz. 1. bölüm, 2005 yılı).", libr);
    expect(r.map((x) => `${x.match} → ${x.refs.map((y) => `${y.prefix ?? ""}${y.item.fields.title}${y.locator ? `:${y.locator}` : ""}`).join(" ; ")}`)).toEqual([
      "(Kara, 2005: 45) → Tasavvuf:45",
      "(Uludag 1995, s. 12-13; bk. Kara, 2005) → Sözlük:12-13 ; bk.Tasavvuf",
      "(Ocak, 1996b, 7) → Kalenderîler:7",
    ]);
  });
});

describe("hand-typed in-text citations, hicrî and cilt", () => {
  it("reads (Gazzâlî, 1413/1993, Cilt 1, s. 45)", () => {
    const g = emptyItem("book");
    g.creators = [{ creatorType: "author", firstName: "Ebû Hâmid", lastName: "Gazzâlî" }];
    g.fields = { title: "el-Mustasfâ", date: "1413/1993" };
    const r = readInText("x (Gazzâlî, 1413/1993, Cilt 1, s. 45) y", [g]);
    expect(r.map((x) => [x.refs[0]!.volume, x.refs[0]!.locator])).toEqual([["1", "45"]]);
  });
});

import { ageCount } from "../src/core/citecheck.js";

describe("a.g.e. typed by hand", () => {
  it("is counted, words like 'age' in a sentence are not", () => {
    expect(ageCount("a.g.e., s. 4. Kara, a.g.e., 5. A.e. 7. Ibid. a.g.m., 3. Bu çağda age değil; ae. hayır")).toBe(5);
  });
});

import { expandSameAuthor } from "../src/core/freetext.js";

describe("———. / a.mlf. in a typed bibliography", () => {
  it("takes the author of the line before", () => {
    expect(
      expandSameAuthor([
        "Kara, Mustafa. Tasavvuf ve Tarikatlar Tarihi. İstanbul: Dergâh Yayınları, 2005.",
        "———. Bursa’da Tarikatlar ve Tekkeler. Bursa: Uludağ Yayınları, 1990.",
        "a.mlf. Metinlerle Günümüz Tasavvuf Hareketleri. İstanbul: Dergâh Yayınları, 2002.",
        "Ocak, Ahmet Yaşar. Türk Sufîliğine Bakışlar. İstanbul: İletişim Yayınları, 1996.",
        "———, “Kalenderîler”, Belleten 45 (1981), 1-20.",
      ]),
    ).toEqual([
      "Kara, Mustafa. Tasavvuf ve Tarikatlar Tarihi. İstanbul: Dergâh Yayınları, 2005.",
      "Kara, Mustafa. Bursa’da Tarikatlar ve Tekkeler. Bursa: Uludağ Yayınları, 1990.",
      "Kara, Mustafa. Metinlerle Günümüz Tasavvuf Hareketleri. İstanbul: Dergâh Yayınları, 2002.",
      "Ocak, Ahmet Yaşar. Türk Sufîliğine Bakışlar. İstanbul: İletişim Yayınları, 1996.",
      "Ocak, Ahmet Yaşar. “Kalenderîler”, Belleten 45 (1981), 1-20.",
    ]);
  });
});

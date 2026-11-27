import { describe, expect, it } from "vitest";
import { readHandNotes, splitNote, unkeptWords } from "../src/core/handnotes.js";
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

import { expandSameAuthor, parseReference } from "../src/core/freetext.js";

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

describe("a.mlf. in a footnote", () => {
  it("is the author cited just before", () => {
    expect(show(["Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45; a.mlf., Bursa’da Tarikatlar ve Tekkeler (Bursa: Uludağ Yayınları, 1990), 12."])).toEqual(["Tasavvuf ve Tarikatlar Tarihi* s.45 ; Bursa’da Tarikatlar ve Tekkeler* s.12"]);
    const r = readHandNotes(["Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45; a.mlf., Bursa’da Tarikatlar ve Tekkeler (Bursa: Uludağ Yayınları, 1990), 12."], []);
    expect(r[0]!.refs![1]!.item.creators[0]).toMatchObject({ lastName: "Kara", firstName: "Mustafa" });
  });
});

describe("hand-typed footnotes: manuscripts, dictionaries, âyet, vd.", () => {
  it("reads what theses in ilahiyat cite most", () => {
    const r = readHandNotes(
      [
        "Ebû Şekûr Muhammed b. Abdüsseyyid es-Sâlimî el-Keşşî, et-Temhîd fî beyâni’t-tevḥîd (İstanbul: Süleymaniye Kütüphanesi, Şehit Ali Paşa, 1153), 77b.",
        "Keşşî, et-Temhîd (Şehit Ali Paşa, 1153), 78a.",
        "Muhammed Aʿlâ b. Ali et-Tehânevî, Keşşâfü ıṣṭılâḥâti’l-fünûn ve’l-‘ulûm, nşr. Ali Dahrûc - Abdullah Hâlidî (Beyrut: Mektebetü Lübnan, 1996), “delîl”, 1/793-799.",
        "Tehânevî, “delîl”, 1/797.",
        "Kur’ân-ı Kerîm Meâli, çev. Halil Altuntaş - Muzaffer Şahin (Ankara: Diyanet İşleri Başkanlığı Yayınları, 2009), el-Enfâl 8/2.",
        "el-Bakara 2/14.",
        "Bekir Topaloğlu vd., İslam’da İnanç Esasları (İstanbul: MÜ İlâhiyat Fakültesi Vakfı Yayınları, 1998), 25.",
        "Topaloğlu vd., İslam’da İnanç Esasları, 36.",
        "Fuat Sezgin, Geschichte des arabischen Schrifttums (Leiden: Brill, 1967-2015), 1/44-45.",
        "Sezgin, GAS, 1/48-56.",
      ],
      [],
    );
    const ref = (i: number) => r[i]!.refs![0]!;
    expect(ref(0).item).toMatchObject({ itemType: "manuscript", fields: { archive: "Süleymaniye Kütüphanesi", archiveLocation: "Şehit Ali Paşa, 1153" } });
    expect(ref(0).locator).toBe("77b");
    expect(ref(1).item).toBe(ref(0).item);
    expect(ref(1).locator).toBe("78a");
    expect([ref(2).madde, ref(2).volume, ref(2).locator]).toEqual(["delîl", "1", "793-799"]);
    expect(ref(3).item).toBe(ref(2).item);
    expect([ref(3).madde, ref(3).locator]).toEqual(["delîl", "797"]);
    expect([ref(4).sure, ref(4).ayet]).toEqual(["8", "2"]);
    expect(ref(5).item).toBe(ref(4).item);
    expect([ref(5).sure, ref(5).ayet]).toEqual(["2", "14"]);
    expect(ref(7).item).toBe(ref(6).item);
    expect(ref(9).item).toBe(ref(8).item);
  });
});

describe("hand-typed footnotes: newspapers, month and year", () => {
  it("reads İSNAD's newspaper forms and a book dated Kasım 1996", () => {
    const r = readHandNotes(["Milliyet, “Yetki Kanunları” (17 Eylül 1971), 1.", "Milliyet, “Yetki Kanunları”, 1.", "Ahmet Hakan, “Bir Yazı”, Hürriyet (12 Mart 2010), 5.", "Aristoteles, Metafizik, çev. Ahmet Arslan (İstanbul: Sosyal Yayınlar, Kasım 1996), 171."], []);
    expect(r[0]!.refs![0]!.item).toMatchObject({ itemType: "newspaperArticle", fields: { publicationTitle: "Milliyet", title: "Yetki Kanunları", date: "1971-09-17" } });
    expect(r[1]!.refs![0]!.item).toBe(r[0]!.refs![0]!.item);
    expect(r[2]!.refs![0]!.item.fields).toMatchObject({ publicationTitle: "Hürriyet", date: "2010-03-12" });
    expect(r[3]!.refs![0]!.item.fields.date).toBe("1996");
  });
});

describe("hand-typed footnotes: a body as author", () => {
  it("reads “Kurum (KISALTMA), Başlık (Haziran 2019)” and its short form", () => {
    const r = readHandNotes(["Hazine ve Maliye Bakanlığı (HMB), Aylık Bütçe Bülteni (Haziran 2019), 45-46.", "HMB, Aylık Bütçe Bülteni, 40.", "Meclis Araştırması Komisyonu (MAK), Çocuklara Yönelik İstismar Olaylarının Araştırılması Komisyonu Raporu (Ankara: TBMM, 2016), 45.", "MAK, İstismar Olaylarının Araştırılması Raporu, 47."], []);
    expect(r[0]!.refs![0]!.item).toMatchObject({ itemType: "report", fields: { title: "Aylık Bütçe Bülteni", date: "2019-06" }, creators: [{ lastName: "HMB", firstName: "Hazine ve Maliye Bakanlığı" }] });
    expect(r[1]!.refs![0]!.item).toBe(r[0]!.refs![0]!.item);
    expect(r[2]!.refs![0]!.item.fields).toMatchObject({ institution: "TBMM", place: "Ankara", date: "2016" });
    expect(r[3]!.refs![0]!.item).toBe(r[2]!.refs![0]!.item);
  });
});

describe("hand-typed footnotes: mevzuat", () => {
  it("reads Resmî Gazete laws and other regulations, md. as the place", () => {
    const r = readHandNotes(["Fikir ve Sanat Eserleri Kanunu (FSEK), Resmî Gazete 7981 (13 Aralık 1951), Kanun No. 5846, md. 35/4.", "FSEK, md. 35/4.", "Yükseköğretim Kurumları Etik Davranış İlkeleri (YKEDİ), Yükseköğretim Kurulu (2014), md. 1/1.", "YKEDİ, md. 2."], []);
    expect(r[0]!.refs![0]!.item).toMatchObject({ itemType: "statute", fields: { shortTitle: "FSEK", code: "Resmî Gazete", codeNumber: "7981", publicLawNumber: "5846", date: "1951-12-13" } });
    expect(r[0]!.refs![0]).toMatchObject({ locator: "35/4", label: "sub verbo" });
    expect(r[1]!.refs![0]!.item).toBe(r[0]!.refs![0]!.item);
    expect(r[2]!.refs![0]!.item).toMatchObject({ itemType: "statute", fields: { shortTitle: "YKEDİ", date: "2014" } });
    expect(r[3]!.refs![0]!.item).toBe(r[2]!.refs![0]!.item);
  });
});

describe("vd.", () => {
  it("is flagged: the other authors are to be added", () => {
    const r = readHandNotes(["Bekir Topaloğlu vd., İslam’da İnanç Esasları (İstanbul: MÜ İlâhiyat Fakültesi Vakfı Yayınları, 1998), 25."], []);
    expect(r[0]!.refs![0]!.unsure).toEqual(["diğer yazarlar (vd.)"]);
    expect(parseReference("Topaloğlu, Bekir vd. İslam’da İnanç Esasları. İstanbul: MÜ İlâhiyat Fakültesi Vakfı Yayınları, 1998.")?.unsure).toContain("diğer yazarlar (vd.)");
    expect(parseReference("Kara, Mustafa. Tasavvuf ve Tarikatlar Tarihi. İstanbul: Dergâh Yayınları, 2005.")?.unsure).not.toContain("diğer yazarlar (vd.)");
  });
});

describe("hand-typed footnotes: court decisions", () => {
  it("reads “Yargıtay 11. Hukuk Dairesi (Yargıtay), K. 2019/1204 (22 Ağustos 2019)” and “Yargıtay, K. 2019/1204”", () => {
    const r = readHandNotes(["Yargıtay 11. Hukuk Dairesi (Yargıtay), K. 2019/1204 (22 Ağustos 2019).", "Yargıtay, K. 2019/1204.", "Anayasa Mahkemesi (AYM) K. 2015/19953 (26 Haziran 2019).", "AYM, K. 2015/19953."], []);
    expect(r[0]!.refs![0]!.item).toMatchObject({ itemType: "case", fields: { court: "Yargıtay", docketNumber: "2019/1204", dateDecided: "2019-08-22" } });
    expect(r[1]!.refs![0]!.item).toBe(r[0]!.refs![0]!.item);
    expect(r[3]!.refs![0]!.item).toBe(r[2]!.refs![0]!.item);
  });
});

import { checkBibliography } from "../src/core/handnotes.js";

describe("footnotes against the bibliography", () => {
  it("lists works cited but not listed, and listed but not cited", () => {
    const r = checkBibliography(
      [
        "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45.",
        "Ahmet Yaşar Ocak, Türk Sufîliğine Bakışlar (İstanbul: İletişim Yayınları, 1996), 12.",
        "Kara, Tasavvuf ve Tarikatlar, 47.",
        "Bu konuda başka görüşler de vardır.",
      ],
      ["Kara, Mustafa. Tasavvuf ve Tarikatlar Tarihi. İstanbul: Dergâh Yayınları, 2005.", "Uludağ, Süleyman. Tasavvuf Terimleri Sözlüğü. İstanbul: Marifet Yayınları, 1995."],
    );
    expect(r.missing.map((m) => `${m.item.fields.title} ${m.notes.join(",")}`)).toEqual(["Türk Sufîliğine Bakışlar 2"]);
    expect(r.uncited).toEqual(["Uludağ, Süleyman. Tasavvuf Terimleri Sözlüğü. İstanbul: Marifet Yayınları, 1995."]);
    expect([r.citedCount, r.listedCount]).toEqual([2, 2]);
  });
});

import { checkInTextBibliography } from "../src/core/handnotes.js";

describe("in-text citations against the bibliography", () => {
  it("matches by surname and year, narrative ones too", () => {
    const r = checkInTextBibliography("Tasavvuf (Kara, 2005: 45) böyledir. Ocak (1996) aksini söyler; (Uludağ 1995, s. 12; bk. Kara, 2005). Gazzâlî (ö. 505/1111) de.", [
      "Kara, Mustafa. Tasavvuf ve Tarikatlar Tarihi. İstanbul: Dergâh Yayınları, 2005.",
      "Ocak, Ahmet Yaşar. Türk Sufîliğine Bakışlar. İstanbul: İletişim Yayınları, 1996.",
      "Yılmaz, Hasan Kâmil. Anahatlarıyla Tasavvuf ve Tarikatlar. İstanbul: Ensar Neşriyat, 2004.",
    ]);
    expect(r.missing).toEqual(["Uludağ 1995, s. 12"]);
    expect(r.uncited).toEqual(["Yılmaz, Hasan Kâmil. Anahatlarıyla Tasavvuf ve Tarikatlar. İstanbul: Ensar Neşriyat, 2004."]);
  });
});

describe("full first, short after, no a.g.e.", () => {
  it("finds short first mentions, full repeats and a.g.e.", () => {
    const r = checkBibliography(
      [
        "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45.",
        "a.g.e., 46.",
        "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 50.",
        "Kutlu, “İlk Mürciî Metinler”, 322.",
        "Kara, Tasavvuf ve Tarikatlar, 51.",
        "Kara, Tasavvuf, 52.",
        "Kara, Tasavvuf, 53.",
      ],
      [],
      lib,
    );
    expect(r.shortVariants.map((x) => x.forms)).toEqual([["Kara, Tasavvuf ve Tarikatlar", "Kara, Tasavvuf"]]);
    expect(r.age).toEqual([2]);
    expect(r.fullAgain.map((x) => [x.item.fields.title, x.notes])).toEqual([["Tasavvuf ve Tarikatlar Tarihi", [3]]]);
    expect(r.shortFirst.map((x) => [x.item.fields.title, x.note])).toEqual([["İlk Mürciî Metinler", 4]]);
  });
});

describe("hand-typed footnotes: hadith", () => {
  it("reads “Kitâb”, bâb (no.) and the old unquoted form", () => {
    const r = readHandNotes(
      [
        "Ebû Abdillâh Muhammed b. İsmâîl el-Buhârî, el-Câmiʿu’ṣ-ṣaḥîḥ (İstanbul: Çağrı Yayınları, 1992), “Îmân”, 2.",
        "Buhârî, “Menâḳıb”, 24.",
        "Buhârî, Îmân, 3.",
        "Ebü’l-Hüseyn Müslim b. el-Haccâc, el-Câmiʿu’ṣ-ṣaḥîḥ, nşr. Muhammed Fuâd Abdülbâkī (Kahire: y.y., 1955), “Îmân”, 12 (no. 34).",
        "Müslim, “Ticârât”, 45.",
      ],
      [],
    );
    const ref = (i: number) => r[i]!.refs![0]!;
    expect([ref(0).kitab, ref(0).bab]).toEqual(["Îmân", "2"]);
    expect(ref(1).item).toBe(ref(0).item);
    expect([ref(1).kitab, ref(1).bab]).toEqual(["Menâḳıb", "24"]);
    expect([ref(2).item === ref(0).item, ref(2).kitab, ref(2).bab]).toEqual([true, "Îmân", "3"]);
    expect([ref(3).kitab, ref(3).bab, ref(3).hadisNo]).toEqual(["Îmân", "12", "34"]);
    expect([ref(4).item === ref(3).item, ref(4).kitab, ref(4).bab]).toEqual([true, "Ticârât", "45"]);
  });
});

import { SHORT_UNKNOWN } from "../src/core/handnotes.js";

describe("short reference to a work not known", () => {
  it("says so, and links once the library has the work", () => {
    expect(readHandNotes(["Buhârî, “Îmân”, 2."], [])[0]!.reason).toBe(SHORT_UNKNOWN);
    const sahih = emptyItem("book");
    sahih.creators = [{ creatorType: "author", lastName: "Buhârî", firstName: "Ebû Abdillâh Muhammed b. İsmâîl el-" }];
    sahih.fields = { title: "el-Câmiʿu’ṣ-ṣaḥîḥ", place: "İstanbul", publisher: "Çağrı Yayınları", date: "1992" };
    const r = readHandNotes(["Buhârî, “Îmân”, 2."], [sahih])[0]!.refs![0]!;
    expect([r.item, r.kitab, r.bab]).toEqual([sahih, "Îmân", "2"]);
    expect(readHandNotes(["Bu görüş için ileride bakılacaktır."], [])[0]!.reason).toBe("künye olarak okunamadı");
  });
});

describe("uyum: short references resolved through the bibliography", () => {
  it("a hadith collection given in full only in the bibliography counts as cited", () => {
    const r = checkBibliography(["Buhârî, “Îmân”, 2.", "Buhârî, “Menâḳıb”, 24."], ["Buhârî, Ebû Abdillâh Muhammed b. İsmâîl. el-Câmiʿu’ṣ-ṣaḥîḥ. İstanbul: Çağrı Yayınları, 1992."]);
    expect([r.citedCount, r.missing.length, r.uncited.length]).toEqual([1, 0, 0]);
    expect(r.shortFirst.length).toBe(1);
  });
});

describe("well-known names: İbn Mâce, Ahmed b. Hanbel", () => {
  it("keeps them whole as the surname", () => {
    const r = readHandNotes(["Ebû Abdillâh Muhammed b. Yezîd İbn Mâce, es-Sünen (Kahire: y.y., ts.), “Mukaddime”, 5.", "İbn Mâce, “Mukaddime”, 7.", "Ahmed b. Hanbel, el-Müsned (Beyrut: Müessesetü’r-Risâle, 2001), 2/45.", "Ahmed b. Hanbel, el-Müsned, 3/12."], []);
    expect(r[0]!.refs![0]!.item.creators[0]).toMatchObject({ lastName: "İbn Mâce", firstName: "Ebû Abdillâh Muhammed b. Yezîd" });
    expect(r[1]!.refs![0]!.item).toBe(r[0]!.refs![0]!.item);
    expect(r[2]!.refs![0]!.item.creators[0]).toMatchObject({ name: "Ahmed b. Hanbel" });
    expect(r[3]!.refs![0]!.item).toBe(r[2]!.refs![0]!.item);
  });
});

describe("a.g.e. within one note, and its place", () => {
  it("points to the work just before in the same note; keeps a kitâb after it", () => {
    const r = readHandNotes(
      [
        "Ebû Abdillâh Muhammed b. İsmâîl el-Buhârî, el-Câmiʿu’ṣ-ṣaḥîḥ (İstanbul: Çağrı Yayınları, 1992), “Îmân”, 2.",
        "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 12; a.g.e., 13.",
        "Buhârî, “Îmân”, 3; a.g.e., “Menâḳıb”, 24.",
      ],
      [],
    );
    expect(r[1]!.refs!.map((x) => [x.item.fields.title, x.locator])).toEqual([["Tasavvuf ve Tarikatlar Tarihi", "12"], ["Tasavvuf ve Tarikatlar Tarihi", "13"]]);
    expect(r[2]!.refs!.map((x) => [x.item.fields.title, x.kitab, x.bab])).toEqual([["el-Câmiʿu’ṣ-ṣaḥîḥ", "Îmân", "3"], ["el-Câmiʿu’ṣ-ṣaḥîḥ", "Menâḳıb", "24"]]);
  });
});

import { bibliographyLines, sectionHeadings } from "../src/core/handnotes.js";

describe("a typed bibliography: lines and section headings", () => {
  const text = ["KAYNAKÇA", "A. Kitaplar", "Kara, Mustafa. Tasavvuf ve Tarikatlar Tarihi. İstanbul: Dergâh Yayınları,", "2005.", "———. Bursa’da Tarikatlar ve Tekkeler. Bursa: Uludağ Yayınları, 1990.", "B. Makaleler", "Kutlu, Sönmez. “İlk Mürciî Metinler”. Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 317-331."].join("\n");
  it("headings out, broken lines joined, ——— given its author", () => {
    expect(sectionHeadings(text)).toEqual(["A. Kitaplar", "B. Makaleler"]);
    expect(bibliographyLines(text)).toEqual([
      "Kara, Mustafa. Tasavvuf ve Tarikatlar Tarihi. İstanbul: Dergâh Yayınları, 2005.",
      "Kara, Mustafa. Bursa’da Tarikatlar ve Tekkeler. Bursa: Uludağ Yayınları, 1990.",
      "Kutlu, Sönmez. “İlk Mürciî Metinler”. Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 317-331.",
    ]);
    expect(sectionHeadings("KAYNAKÇA\nKara, Mustafa. Tasavvuf. İstanbul: Dergâh, 2005.")).toEqual([]);
  });
});

describe("imprints with gaps", () => {
  it("(2001), (İstanbul: 2001), (İstanbul, 2001), and the bibliography's “İstanbul, 2001.”", () => {
    const f = (s: string) => parseReference(s)?.item.fields;
    expect(f("Kerim Akçay, Eksik Künyeli Bir Kitap (2001), 12.")).toMatchObject({ title: "Eksik Künyeli Bir Kitap", date: "2001" });
    expect(f("Kerim Akçay, Eksik Künyeli Bir Kitap (İstanbul: 2001), 12.")).toMatchObject({ place: "İstanbul", date: "2001" });
    expect(f("Kerim Akçay, Eksik Künyeli Bir Kitap (İstanbul, 2001), 12.")).toMatchObject({ place: "İstanbul", date: "2001" });
    expect(f("Kerim Akçay, Eksik Künyeli Bir Kitap (İstanbul, 2001), 12.")?.publisher).toBeUndefined();
    expect(f("Akçay, Kerim. Eksik Künyeli Bir Kitap. İstanbul, 2001.")).toMatchObject({ place: "İstanbul", date: "2001" });
    expect(f("Kerim Akçay, Eksik Künyeli Bir Kitap (Dergâh Yayınları, 2001), 12.")).toMatchObject({ publisher: "Dergâh Yayınları", date: "2001" });
    expect(f("Sönmez Kutlu, “İlk Mürciî Metinler”, Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 320.")).toMatchObject({ publicationTitle: "Ankara Üniversitesi İlahiyat Fakültesi Dergisi", volume: "37" });
  });
});

describe("works that name their kind", () => {
  const p = (s: string) => parseReference(s)?.item;
  it("software, patents, art works, documents, films, messages and interviews, note and bibliography form", () => {
    expect(p("Microsoft Word 16.29 (Yazılım, ABD: Microsoft Corporation, 2019).")).toMatchObject({ itemType: "computerProgram", fields: { title: "Microsoft Word", versionNumber: "16.29", place: "ABD", company: "Microsoft Corporation", date: "2019" } });
    expect(p("Microsoft Word (Yazılım, ABD: Microsoft Corporation, 16.29, 2019).")?.fields.versionNumber).toBe("16.29");
    expect(p("EndNote X9. Yazılım. ABD: Clarivate Analytics, 2019. https://endnote.com")).toMatchObject({ itemType: "computerProgram", fields: { title: "EndNote", versionNumber: "X9", url: "https://endnote.com" } });
    const pat = p("Adem Kaya, Eğitim Dokümanları İçin İçerik Sınıflandırma Sistemi ve Yöntemi (Patent, Türk Patent ve Marka Kurumu, No. 2019/07502, Tarih 17 Mayıs 2019).");
    expect(pat).toMatchObject({ itemType: "patent", fields: { issuingAuthority: "Türk Patent ve Marka Kurumu", patentNumber: "2019/07502", issueDate: "17 Mayıs 2019" } });
    expect(pat?.creators[0]).toMatchObject({ creatorType: "inventor", lastName: "Kaya" });
    expect(p("Fişek, Mehmet. Chair for Performing Prayers. Patent. World Intellectual Property Organization, No. WO2014/011125, Tarih 16 Ocak 2014.")).toMatchObject({ itemType: "patent", fields: { patentNumber: "WO2014/011125" } });
    expect(p("Şefik Direnoğlu, Alparslan Portresi (Yağlı Boya, 2003, Ankara: Milli Kütüphane), No. 000511.")).toMatchObject({ itemType: "artwork", fields: { title: "Alparslan Portresi", artworkMedium: "Yağlı Boya", date: "2003", archiveLocation: "Ankara", archive: "Milli Kütüphane", callNumber: "No. 000511" } });
    expect(p("Halı Seccade. Halı, 17-18. yüzyıl. İstanbul: Türk ve İslâm Eserleri Müzesi, Halı Koleksiyonu, No. 420.")).toMatchObject({ itemType: "artwork", creators: [], fields: { title: "Halı Seccade", date: "17-18. yüzyıl", libraryCatalog: "Halı Koleksiyonu" } });
    expect(p("Hayali Küçük Ali. Abdal. Tasvir, 1957. Ankara: Milli Kütüphane, No. 000116.")?.creators[0]).toEqual({ creatorType: "artist", name: "Hayali Küçük Ali" });
    const exam = p("Öğrenci 1, İç Tasarıma Giriş Dersi Vize Sınavı (Sınav Kâğıdı, 20 Mart 2019), Sivas Cumhuriyet Üniversitesi, Mimarlık Fakültesi, Öğretici 1.");
    expect(exam).toMatchObject({ itemType: "document", creators: [{ name: "Öğrenci 1" }], fields: { archive: "Sivas Cumhuriyet Üniversitesi, Mimarlık Fakültesi", libraryCatalog: "Öğretici 1" } });
    expect(p("Sezgin Pancar, Mersin’deki Kazı Çalışmaları Sürüyor (Fotoğraf, 2019), Anadolu Ajansı.")).toMatchObject({ itemType: "document", fields: { publisher: "Anadolu Ajansı", extra: "genre: Fotoğraf" } });
    expect(p("Frank Darabont, The Shawshank Redemption [Esaretin Bedeli] (Film, 1995).")).toMatchObject({ itemType: "film", fields: { shortTitle: "The Shawshank Redemption" }, creators: [{ creatorType: "director" }] });
    const sms = p("Yusuf Doğan, İlahiyat Atıf Dizini hk. (Kısa Mesaj 2 Eylül 2019, Alıcı Sami Şahin).");
    expect(sms).toMatchObject({ itemType: "instantMessage", fields: { title: "İlahiyat Atıf Dizini hk.", date: "2 Eylül 2019" } });
    expect(sms?.creators.map((c) => c.creatorType)).toEqual(["author", "recipient"]);
    expect(p("Abdullah Demir, Taslak hk. (E-Posta 2 Eylül 2019, Alıcı: Emrah Kaya).")?.itemType).toBe("email");
    const iv = p("Halil İnalcık, “Fatih Sultan Mehmed” (Görüşmeci: İlber Ortaylı, Video Kaydı, Görüşme 3 Mart 1985).");
    expect(iv).toMatchObject({ itemType: "interview", fields: { interviewMedium: "Video Kaydı", date: "1985-03-03" } });
  });
  it("videos, broadcasts, recordings and symposium papers", () => {
    expect(p("Muhammet Tarakçı, “İSNAD-Kitap Bölümüne Atıf”, YouTube (31 Mart 2018).")).toMatchObject({ itemType: "videoRecording", fields: { place: "YouTube", date: "2018-03-31" }, creators: [{ creatorType: "director" }] });
    expect(p("Üçer, Cenksu. “Mizan”. Diyanet TV. Yayın Tarihi 6 Temmuz 2019. https://www.diyanet.tv/mizan")).toMatchObject({ itemType: "tvBroadcast", fields: { network: "Diyanet TV", date: "2019-07-06", url: "https://www.diyanet.tv/mizan" } });
    expect(p("Michael Jackson, “Break of Dawn”, Invincible (2001).")).toMatchObject({ itemType: "audioRecording", fields: { seriesTitle: "Invincible", date: "2001" } });
    expect(p("Koca, Fatih. “Hak Bir Gönül Verdi Bana”. Lâ Mekân, 2016.")).toMatchObject({ itemType: "audioRecording", fields: { seriesTitle: "Lâ Mekân" } });
    expect(p("Mehmet Kalaycı - Muhammet Emin Eren, “Reflection of Tension”, Ilahiyat Studies 9/2 (2018), 249.")?.itemType).toBe("journalArticle");
    expect(p("Ahmet Turan, “Mürted Hükümleri”, Bilig (2001), 12.")?.itemType).not.toBe("audioRecording");
    expect(p("Abdullah Demir, “Farklı Ebû Hanîfe Tasavvurları”, IV. Uluslararası Şeyh Şa’ban-ı Velî Sempozyumu, ed. Cengiz Çuhadar (Kastamonu: Kastamonu Üniversitesi Yayınları, 2017), 643-658.")).toMatchObject({ itemType: "conferencePaper", fields: { proceedingsTitle: "IV. Uluslararası Şeyh Şa’ban-ı Velî Sempozyumu" } });
    expect(p("Demir, Abdullah. “Farklı Ebû Hanîfe Tasavvurları”. IV. Uluslararası Şeyh Şa’ban-ı Velî Sempozyumu. ed. Cengiz Çuhadar. 643-658. Kastamonu: Kastamonu Üniversitesi Yayınları, 2017.")?.fields.proceedingsTitle).toBe("IV. Uluslararası Şeyh Şa’ban-ı Velî Sempozyumu");
  });
  it("bodies with an abbreviation, posts, bare www addresses", () => {
    const hmb = p("HMB, Hazine ve Maliye Bakanlığı. Aylık Bütçe Bülteni (Haziran 2019). https://ms.hmb.gov.tr/b.pdf");
    expect(hmb).toMatchObject({ itemType: "report", fields: { title: "Aylık Bütçe Bülteni", date: "2019-06" } });
    expect(hmb?.creators).toEqual([{ creatorType: "author", lastName: "HMB", firstName: "Hazine ve Maliye Bakanlığı" }]);
    expect(hmb?.fields.extra).toBe("authority: HMB");
    expect(p("Yale University (YU), “About Yale: Yale Facts” (Erişim 13 Mayıs 2017).")).toMatchObject({ itemType: "webpage", fields: { title: "About Yale: Yale Facts", extra: "authority: YU" } });
    expect(p("TYEKB, Türkiye Yazma Eserler Kurumu Başkanlığı. Yazma Eserler Portalı. Erişim 12 Eylül 2019. http://yazmalar.gov.tr")?.itemType).toBe("book");
    expect(p("DAVET, Dini Araştırmalar Veri Tabanı İlahiyat Atıf Dizini. “Aranan: Oruç İbadeti”. Erişim 12 Eylül 2019. www.davet.org.tr")?.fields).toMatchObject({ url: "www.davet.org.tr", title: "Aranan: Oruç İbadeti" });
    // A person whose surname is written in capitals is not a body.
    const kara = p("KARA, Mustafa Ahmet. Tasavvuf Tarihi. İstanbul: Dergâh Yayınları, 2005.");
    expect(kara?.fields.extra).toBeUndefined();
    expect(kara?.itemType).toBe("book");
    expect(p("Abdullah Demir, “İSNAD yaygınlaşıyor”, Facebook (12 Mart 2019, 20:30).")).toMatchObject({ itemType: "webpage", fields: { websiteTitle: "Facebook", date: "12 Mart 2019, 20:30" } });
    expect(p("Demir, Abdullah. “İSNAD yaygınlaşıyor”. Facebook. 12 Mart 2019, 20:30. Erişim 12 Temmuz 2019. https://www.facebook.com/x")).toMatchObject({ itemType: "webpage", fields: { accessDate: "2019-07-12" } });
  });
  it("archive documents and manuscripts without an imprint parenthesis", () => {
    const boa = p("Osmanlı Arşivi (BOA), Mühimme-i Asâkir Defterleri [A.DVNS.ASK.MHM.d], No. 989, Gömlek No. 7.");
    expect(boa).toMatchObject({ itemType: "manuscript", fields: { title: "Mühimme-i Asâkir Defterleri [A.DVNS.ASK.MHM.d]", shortTitle: "A.DVNS.ASK.MHM.d", callNumber: "No. 989, Gömlek No. 7", extra: "authority: BOA" } });
    expect(boa?.creators).toEqual([{ creatorType: "author", lastName: "BOA", firstName: "Osmanlı Arşivi" }]);
    expect(p("BOA, Osmanlı Arşivi. Düvel-i Ecnebiye Belgeleri [A.DVN.DVE]. No. 976. https://katalog.devletarsivleri.gov.tr")).toMatchObject({ itemType: "manuscript", fields: { shortTitle: "A.DVN.DVE", callNumber: "No. 976" } });
    expect(p("Kayseri Sancağı Şer’îye Sicil Defteri (1334-1336), Milli Kütüphane, No. 06 Mil Yz C 39/3.")).toMatchObject({ itemType: "manuscript", fields: { shortTitle: "Kayseri Sancağı Şer’îye Sicil Defteri", date: "1334-1336", archive: "Milli Kütüphane", callNumber: "No. 06 Mil Yz C 39/3" } });
    const sig = p("Siğnâkī, Hüsâmeddin Hüseyin b. Ali. et-Tesdîd fî şerḥi’t-Temhîd. İstanbul: Süleymaniye Kütüphanesi, Esad Efendi, 3893, 1a-215a.");
    expect(sig).toMatchObject({ itemType: "manuscript", fields: { title: "et-Tesdîd fî şerḥi’t-Temhîd", place: "İstanbul", archive: "Süleymaniye Kütüphanesi", archiveLocation: "Esad Efendi", callNumber: "3893", numPages: "1a-215a" } });
    expect(sig?.creators[0]).toMatchObject({ lastName: "Siğnâkī", firstName: "Hüsâmeddin Hüseyin b. Ali" });
    expect(p("Birgiwī, Meḥmed. Kitāb al-Ṭarīgah. Copenhagen: The Royal Library, Danish Collection, Cod. Arab. A.C. 5, 1a-227b.")?.fields).toMatchObject({ archiveLocation: "Danish Collection", callNumber: "Cod. Arab. A.C. 5" });
    // A book printed by a library's press is still a book.
    expect(p("Kara, Mustafa. Tasavvuf. İstanbul: Dergâh Yayınları, 2005.")?.itemType).toBe("book");
    expect(p("Kut, Günay. Yazma Eserler Kataloğu. Ankara: Milli Kütüphane, 1990.")).toMatchObject({ itemType: "book", fields: { publisher: "Milli Kütüphane", date: "1990" } });
  });
  it("EU legislation and text editions in articles", () => {
    expect(p("Commission Decision (EU) 2017/1002 of 7 June 2017 on the proposed initiative (Stop extremism), Official Journal of the European Union L 152/1 (15 June 2017), 2.")).toMatchObject({ itemType: "statute", fields: { shortTitle: "Stop extremism", code: "Official Journal of the European Union", codeNumber: "L 152/1", date: "15 June 2017" } });
    const ed = p("İbrahim el-Halebî, Risâle fi hakkı ebeveyi’r-Resûl, “Ebeveyn-i Resûl Meselesine Özgün Yaklaşımlar”, nşr. Kadir Gömbeyaz, Bilimname 38 (2019), 76.");
    expect(ed).toMatchObject({ itemType: "journalArticle", fields: { seriesText: "Risâle fi hakkı ebeveyi’r-Resûl", title: "Ebeveyn-i Resûl Meselesine Özgün Yaklaşımlar", publicationTitle: "Bilimname" } });
    expect(ed?.creators.map((c) => c.creatorType)).toEqual(["author", "nasir"]);
    const r = readHandNotes(["İbrahim el-Halebî, Risâle fi hakkı ebeveyi’r-Resûl, “Ebeveyn-i Resûl Meselesine Özgün Yaklaşımlar”, nşr. Kadir Gömbeyaz, Bilimname 38 (2019), 76.", "Halebî, Risâle fi hakkı ebeveyi’r-Resûl, 77."], []);
    expect(r[1]!.refs?.[0]?.item).toBe(r[0]!.refs?.[0]?.item);
    expect(p("Bedreddin eş- Şuhâvî, et-Tırâzu’l-müzheb, “Bir Tahkik”, thk. Osman Bayder, Tahkik Dergisi 2/1 (Haziran 2019), 229.")?.creators[0]).toMatchObject({ lastName: "Şuhâvî", firstName: "Bedreddin eş-" });
  });
  it("newspapers, magazines and maps in the bibliography", () => {
    expect(p("Hanioğlu, M. Şükrü. “15 Temmuz’u Farklı Kılan Nedir?”. Sabah (15 Temmuz 2018), 8. https://www.sabah.com.tr/x")).toMatchObject({ itemType: "newspaperArticle", fields: { publicationTitle: "Sabah", date: "2018-07-15", pages: "8" }, creators: [{ lastName: "Hanioğlu", firstName: "M. Şükrü" }] });
    expect(p("Milliyet. “Yetki Kanunları” (17 Eylül 1971), 1. http://www.milliyet.com.tr")).toMatchObject({ itemType: "newspaperArticle", fields: { publicationTitle: "Milliyet", title: "Yetki Kanunları", url: "http://www.milliyet.com.tr" } });
    expect(p("Arslan, Mustafa. “Sanal Dünya”. Diyanet Aylık Dergi 315 (Mart 2017), 12-30.")?.fields.date).toBe("2017-03");
    const pr = p("Pîrî Reis, Muhyiddin b. Hacı Mehmed. Piri Reis Haritası. İstanbul: Deniz Kuvvetleri Komutanlığı Hidrografi Neşriyatı, 1966. İstanbul Büyükşehir Belediyesi Atatürk Kitaplığı, No. Bel_Osm_B.00038.");
    expect(pr).toMatchObject({ itemType: "map", fields: { title: "Piri Reis Haritası", archive: "İstanbul Büyükşehir Belediyesi Atatürk Kitaplığı", callNumber: "No. Bel_Osm_B.00038", date: "1966" } });
    expect(pr?.creators[0]).toMatchObject({ creatorType: "cartographer", lastName: "Pîrî Reis" });
    expect(p("Google. Google Maps. Erişim 12 Ocak 2019. https://www.google.com/maps")).toMatchObject({ itemType: "map", creators: [{ name: "Google" }] });
    expect(p("Dahiliye Nezâreti (DN), Vilayet Yolları Haritasıdır (İstanbul: Dahiliye Nezâreti Müdüriyeti, 1329/1913).")).toMatchObject({ itemType: "map", fields: { publisher: "Dahiliye Nezâreti Müdüriyeti" } });
    // A title in quotes is not a book's.
    expect(p("Kara, Mustafa. “Bir Makale”. Dergâh Dergisi 3 (2001), 5-9.")?.itemType).toBe("journalArticle");
  });
  it("bibliography details: single names, numerals in titles, roles in one sentence, ts., broken addresses", () => {
    expect(p("Aristoteles. Metafizik. çev. Ahmet Arslan. İstanbul: Sosyal Yayınlar, 1996.")).toMatchObject({ fields: { title: "Metafizik" }, creators: [{ creatorType: "author", name: "Aristoteles" }, { creatorType: "translator" }] });
    expect(p("Osmanlı Tarihi. Kuruluş Dönemi. İstanbul: Ötüken, 2001.")?.creators).toEqual([]);
    expect(p("Dvornik, Francis. Konsiller Tarihi İznik’ten II. Vatikan’a. çev. Mehmet Aydın. Ankara: Türk Tarih Kurumu Yayınları, 1990.")?.fields.title).toBe("Konsiller Tarihi İznik’ten II. Vatikan’a");
    expect(p("Kara, Ahmet. Selim III. İstanbul: Ötüken, 2001.")?.fields).toMatchObject({ title: "Selim III", place: "İstanbul" });
    const esed = p("Kur’an Mesajı: Meal-Tefsir. çev. Muhammed Esed, Türkçeye çev. Cahit Koytak - Ahmet Ertürk. Ankara: İşaret Yayınları, 2002.");
    expect(esed?.creators.map((c) => `${c.creatorType}:${c.lastName}`)).toEqual(["translator:Esed", "turkceye:Koytak", "turkceye:Ertürk"]);
    expect(p("İbn Manzûr, Muhammed b. Mükerrem. Lisânü’l-ʿArab. nşr. Abdullah Ali el-Kebîr. 6 Cilt. Kahire: Dârü’l-Maârif, ts.")).toMatchObject({ fields: { title: "Lisânü’l-ʿArab", place: "Kahire", publisher: "Dârü’l-Maârif", numberOfVolumes: "6" } });
    expect(p("Furat, Ahmet Hamdi vd. (ed.). Osmanlı’da İlim ve Fikir Dünyası-XVIII. Yüzyıl. 2 Cilt. İstanbul: Zeytinburnu Belediyesi Kültür Yayınları, 2018.")?.fields.title).toBe("Osmanlı’da İlim ve Fikir Dünyası-XVIII. Yüzyıl");
    expect(p("Şahin, Derya. Amisos Mozaiği. PDF: Kültür ve Turizm Bakanlığı Yayınları, 2004. http://www.kulturvarliklari.gov.tr/Eklenti/38967,amis os-mozaigi.pdf")?.fields.url).toBe("http://www.kulturvarliklari.gov.tr/Eklenti/38967,amisos-mozaigi.pdf");
    expect(p("Kara, Mustafa. Tasavvuf. İstanbul: Dergâh, 2005. http://www.dergah.com Erişim 3 Mart 2020.")?.fields.url).toBe("http://www.dergah.com");
    expect(p("Yargıtay, Yargıtay 11. Hukuk Dairesi. K. 2019/1204 (22 Ağustos 2019).")).toMatchObject({ itemType: "case", fields: { court: "Yargıtay", docketNumber: "2019/1204", dateDecided: "2019-08-22" } });
    expect(p("FSEK, Fikir ve Sanat Eserleri Kanunu (Kanun No. 5846). Resmî Gazete 7981 (13 Aralık 1951).")).toMatchObject({ itemType: "statute", fields: { shortTitle: "FSEK", title: "Fikir ve Sanat Eserleri Kanunu", publicLawNumber: "5846", codeNumber: "7981" } });
  });
  it("interviews printed in journals and books; full names followed by the known name", () => {
    const iv = p("İsmail Kara, “İmkânsıza Yönelmedikçe Mümkün Olan Ele Geçmez” (Görüşmeci: Fatma Barbarosoğlu, Görüşme Transkripsiyonu), Nihayet Dergisi 5 (Temmuz 2015), 34-38.");
    expect(iv).toMatchObject({ itemType: "journalArticle", fields: { title: "İmkânsıza Yönelmedikçe Mümkün Olan Ele Geçmez", publicationTitle: "Nihayet Dergisi", extra: "interviewer: Barbarosoğlu || Fatma\nmedium: Görüşme Transkripsiyonu" } });
    expect(p("Sinanoğlu, Oktay. “Yabancı Dille Eğitime Neden Bu Kadar Karşısınız?” (Görüşmeci: Sinan Hıncal). Bir Nev-York Rüyası Bye Bye Türkçe. İstanbul: Bilim - Gönül Yayınları, 2011.")).toMatchObject({ itemType: "bookSection", fields: { bookTitle: "Bir Nev-York Rüyası Bye Bye Türkçe", extra: "interviewer: Hıncal || Sinan" } });
    const a = (s: string) => p(s)?.creators[0];
    expect(a("Ebû Abdillâh Ahmed b. Muhammed b. Hanbel eş-Şeybânî Ahmed b. Hanbel, el-Müsned (Beyrut: y.y., 1985).")).toMatchObject({ lastName: "Ahmed b. Hanbel", firstName: "Ebû Abdillâh Ahmed b. Muhammed b. Hanbel eş-Şeybânî" });
    expect(a("Ebû Abdillâh Mâlik b. Enes el-Asbahî İmam Mâlik, el-Muvaṭṭaʾ (Kahire: y.y., 1962).")).toMatchObject({ lastName: "İmam Mâlik" });
    expect(a("Abdülmecid b. Aziz Şeyh Zindânî, “Mülakat”, e-makalat 6/2 (Güz 2013), 135.")).toMatchObject({ lastName: "Şeyh Zindânî" });
    // A chain of fathers' names is not a repetition.
    expect(a("Ebû Bekr Ahmed b. Ali b. Ahmed, Kitâb (Beyrut: y.y., 1990).")).toMatchObject({ lastName: "Ahmed" });
    expect(a("Ebû Hâmid Muhammed b. Muhammed el-Gazzâlî, el-Mustasfâ (Beyrut: y.y., 1993).")).toMatchObject({ lastName: "Gazzâlî" });
  });
  it("old-style footnotes and bibliographies", () => {
    expect(p("Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi, Dergâh Yayınları, İstanbul 2005, s. 45.")).toMatchObject({ itemType: "book", fields: { title: "Tasavvuf ve Tarikatlar Tarihi", place: "İstanbul", publisher: "Dergâh Yayınları", date: "2005" } });
    expect(p("KARA, Mustafa: Tasavvuf ve Tarikatlar Tarihi, İstanbul: Dergâh Yay., 2005.")).toMatchObject({ fields: { title: "Tasavvuf ve Tarikatlar Tarihi", place: "İstanbul", publisher: "Dergâh Yayınları" }, creators: [{ lastName: "Kara", firstName: "Mustafa" }] });
    expect(p("Halil İnalcık, Osmanlı İmparatorluğu Klasik Çağ (1300-1600), çev. Ruşen Sezer, YKY, İstanbul 2003, s. 12-15.")).toMatchObject({ fields: { title: "Osmanlı İmparatorluğu Klasik Çağ (1300-1600)", date: "2003", publisher: "YKY" } });
    expect(p("Gazzâlî, İhyâu Ulûmi'd-Dîn, Beyrut ts., III, 12.")).toMatchObject({ fields: { title: "İhyâu Ulûmi'd-Dîn", place: "Beyrut" } });
    expect(p("Gazzâlî, İhyâu Ulûmi'd-Dîn, Beyrut ts., III, 12.")?.fields.date).toBeUndefined();
    expect(p("Mustafa Kara, Tekke ve Zâviyeler, İstanbul: Dergâh, 2005, s. 20.")?.fields).toMatchObject({ date: "2005", place: "İstanbul", publisher: "Dergâh" });
    expect(p("Kara, Mustafa (2005), Tasavvuf ve Tarikatlar Tarihi, İstanbul: Dergâh Yayınları.")).toMatchObject({ fields: { date: "2005", title: "Tasavvuf ve Tarikatlar Tarihi", place: "İstanbul", publisher: "Dergâh Yayınları" } });
    expect(p("Kara, M. (2005). Tasavvuf ve tarikatlar tarihi. İstanbul: Dergâh Yayınları.")?.fields).toMatchObject({ place: "İstanbul", publisher: "Dergâh Yayınları" });
    expect(p("Ali Yıldırım, Hadis Usulü, (Yayımlanmamış Doktora Tezi), Marmara Üniversitesi Sosyal Bilimler Enstitüsü, İstanbul 2010.")).toMatchObject({ itemType: "thesis", fields: { thesisType: "Doktora Tezi", university: "Marmara Üniversitesi Sosyal Bilimler Enstitüsü" } });
    const r = readHandNotes(["İbn Haldun, Mukaddime, çev. Süleyman Uludağ, Dergâh Yay., İstanbul 1982, I, 245.", "Gazzâlî, İhyâu Ulûmi'd-Dîn, Beyrut ts., III, 12."], []);
    expect(r.map((n) => (n.refs ? `${n.refs[0]!.volume}/${n.refs[0]!.locator}` : n.reason))).toEqual(["I/245", "III/12"]);
  });
  it("a.g.m. after a book is the article cited last; p./pp./ss. pages", () => {
    const r = readHandNotes(["Sönmez Kutlu, “İlk Mürciî Metinler”, Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 320.", "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45.", "agm, s. 323.", "a.g.e., 46.", "Ibid., p. 49.", "Kara, a.g.e., ss. 50-52."], []);
    expect(r.map((n) => `${n.refs?.[0]?.item.fields.title?.slice(0, 8)} ${n.refs?.[0]?.locator}`)).toEqual(["İlk Mürc 320", "Tasavvuf 45", "İlk Mürc 323", "İlk Mürc 46", "İlk Mürc 49", "Tasavvuf 50-52"]);
  });
  it("the writer's words around a reference are kept", () => {
    const full = "Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45.";
    const r = readHandNotes([full, "Kara bu görüşü eleştirir; bk. Kara, Tasavvuf ve Tarikatlar Tarihi, 53.", "Nakleden: Kara, Tasavvuf ve Tarikatlar Tarihi, 54.", "Kara, Tasavvuf ve Tarikatlar Tarihi, 57, 59.", "Bk. Kara, Tasavvuf ve Tarikatlar Tarihi, 60."], []);
    expect(r.slice(1).map((n) => `${n.refs?.[0]?.prefix ?? ""}|${n.refs?.[0]?.locator}`)).toEqual(["Kara bu görüşü eleştirir; bk.|53", "nakleden:|54", "|57, 59", "bk.|60"]);
    // A short form whose "author" holds the writer's words is not read as that author's.
    const odd = readHandNotes([full, "Kara’ya göre: Kara, Tasavvuf ve Tarikatlar Tarihi, 61."], [])[1]!;
    expect(!odd.refs || /göre/.test(odd.refs[0]!.prefix ?? "")).toBe(true);
  });
  it("a note is converted only when its citation keeps every word typed", () => {
    // Time stamps of a film or a recording are the cited place.
    const film = readHandNotes(["Frank Darabont, The Shawshank Redemption [Esaretin Bedeli] (Film, 1995), 01:11:10-01:15:15."], [])[0]!;
    expect(film.refs?.[0]?.locator).toBe("01:11:10-01:15:15");
    // What no field would hold leaves the note as it is.
    const tse = readHandNotes(["Türk Standardları Enstitüsü (TSE), Helal Belgelendirmesi Yapan Kuruluşlar İçin Kılavuz (Türkiye: Türk Standardları Enstitüsü, Kabul 05 Haziran 2012, TS OIC/SMIIC 2/T1)."], [])[0]!;
    expect(tse.refs).toBeNull();
    expect(tse.reason).toMatch(/atıfta kalmayacak kelimeler var \(.*kabul/);
    // Künye's own ways of writing are not losses: a.g.e., "s.", "Yay.", "DİA", months, a sûre's name, a short title.
    const r = readHandNotes(["Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi, Dergâh Yay., İstanbul 2005, s. 45.", "a.g.e., s. 46.", "Kara, Tasavvuf, 47.", "Ahmet Yaşar Ocak, “Kalenderîler”, DİA, XXIV, 251-253."], []);
    expect(r.map((n) => n.reason ?? "ok")).toEqual(["ok", "ok", "ok", "ok"]);
    const meal = readHandNotes(["Kur’ân-ı Kerîm Meâli, çev. Halil Altuntaş - Muzaffer Şahin (Ankara: Diyanet İşleri Başkanlığı Yayınları, 2009), el-Enfâl 8/2."], [])[0]!;
    expect(meal.refs && unkeptWords(meal.text, meal.refs)).toEqual([]);
  });
  it("the same check for a bibliography line", () => {
    const lost = (l: string) => unkeptWords(l, [{ item: parseReference(l)!.item, isNew: true, form: "full" }]);
    expect(lost("Şahin, Derya. Amisos Mozaiği. PDF: Kültür ve Turizm Bakanlığı Yayınları, 2004. http://www.kulturvarliklari.gov.tr/Eklenti/38967,amis os-mozaigi.pdf")).toEqual([]);
    expect(lost("Çiftci, Adem. “Suça Teşebbüsten Vazgeçme”. Cumhuriyet İlahiyat Dergisi 19/1 (Haziran 2015), 9-35. https://doi.org/10.18505/cuid.21359")).toEqual([]);
    expect(lost("Üçer, Cenksu. “Mizan”. Diyanet TV. Yayın Tarihi 6 Temmuz 2019. https://www.diyanet.tv/mizan")).toEqual([]);
    // A date with no field to hold it.
    expect(lost("David Rumsey Map Collection. Istanbul Vilayeti. 19 Eylül 2019. https://www.davidrumsey.com")).toContain("2019");
  });
  it("leaves books alone", () => {
    expect(p("Kerim Akçay, Bir Kitap (İstanbul, 2001), 12.")?.itemType).toBe("book");
    expect(p("Kelly, John D. “Seeing Red”. Anthropology and Global Counterinsurgency. ed. John D. Kelly vd. 67-83. Chicago: University of Chicago Press, 2010.")?.fields.place).toBe("Chicago");
  });
  it("later notes find them by their short form", () => {
    const r = readHandNotes(["Halı Seccade (Halı, 17-18. yüzyıl, İstanbul: Türk ve İslâm Eserleri Müzesi, Halı Koleksiyonu), No. 420.", "Halı Seccade, No. 420.", "EndNote X9 (Yazılım, ABD: Clarivate Analytics, 2019).", "EndNote X9.", "Adem Kaya, Bir Sistem ve Yöntemi (Patent, Türk Patent ve Marka Kurumu, No. 2019/07502, Tarih 17 Mayıs 2019).", "Kaya, Bir Sistem ve Yöntemi."], []);
    expect(r.map((n) => n.refs?.[0]?.item.fields.title ?? n.reason)).toEqual(["Halı Seccade", "Halı Seccade", "EndNote", "EndNote", "Bir Sistem ve Yöntemi", "Bir Sistem ve Yöntemi"]);
    expect(r[1]!.refs![0]!.item).toBe(r[0]!.refs![0]!.item);
  });
});

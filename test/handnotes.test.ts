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

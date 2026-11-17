/**
 * Derkenar against the İSNAD 2 guide (v1.6, dipnotlu): the guide's own example
 * works (the İSNAD team's Zotero library, test/fixtures/isnad) must come out
 * exactly as the guide prints them — first note, later note, bibliography.
 * Page numbers refer to the guide.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { citeMode } from "../src/core/isnadmodes.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
import type { CiteRef } from "../src/core/types.js";
import type { Item } from "../src/core/zotero.js";

const styles = new URL("../data/styles/", import.meta.url);
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, styles), "utf8");
  } catch {
    return undefined;
  }
};
const { items } = parseZoteroRdf(readFileSync(new URL("fixtures/isnad/isnad2-eserler.rdf", import.meta.url), "utf8"), "file:isnad");
function work(title: string, author?: string): Item {
  const found = items.filter((i) => [i.fields.title, i.fields.dictionaryTitle, i.fields.nameOfAct].some((t) => t?.includes(title)) && (!author || i.creators.some((c) => c.lastName === author)));
  if (found.length !== 1) throw new Error(`${title}: ${found.length} eser`);
  return found[0]!;
}

/** Renders the work twice (first and later note) and its bibliography entry. */
function render(item: Item, first: Omit<CiteRef, "id">, later: Omit<CiteRef, "id">) {
  const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
  const st = emptyState();
  putCitation(st, "a", [{ id: item.key, ...first }], { [item.key]: item });
  putCitation(st, "b", [{ id: item.key, ...later }], {});
  const plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
  return { first: htmlToText(plan.updates.get("a")!), later: htmlToText(plan.updates.get("b")!), bib: htmlToText(plan.bibliography!.entries[0]!.html) };
}

describe("İSNAD 2 kılavuzu: genel ilkeler (s. 65-67)", () => {
  it("tahkik, cilt/sayfa, hicrî/milâdî, kısa başlık (s. 66)", () => {
    const r = render(work("Telḫîṣü’l-edille"), { locator: "143" }, { locator: "143" });
    expect(r.first).toBe("Ebû İshâk İbrâhim ez-Zâhid es-Saffâr, Telḫîṣü’l-edille li-ḳavâʿidi’t-tevḥîd, thk. Angelika Brodersen (Beyrut: el-Ma‘hedü’l-Almânî li’l-Ebhâsi’l-Şarkiyye, 1432/2011), 2/143.");
    expect(r.later).toBe("Saffâr, Telḫîṣü’l-edille, 2/143.");
  });
  it("iki yazar arasında tire (s. 65)", () => {
    const r = render(work("Düşünceleriyle Atatürk"), { locator: "12" }, { locator: "13" });
    expect(r.first).toBe("Arı İnan - İsmet Parmaksızoğlu, Düşünceleriyle Atatürk (Ankara: Türk Tarih Kurumu Yayınları, 2018), 12.");
    expect(r.later).toBe("İnan - Parmaksızoğlu, Düşünceleriyle Atatürk, 13.");
    expect(r.bib).toBe("İnan, Arı - Parmaksızoğlu, İsmet. Düşünceleriyle Atatürk. Ankara: Türk Tarih Kurumu Yayınları, 2018.");
  });
  it("üç ve daha fazla yazarda vd. (s. 65)", () => {
    const r = render(work("İslam’da İnanç Esasları"), { locator: "12" }, { locator: "13" });
    expect(r.first).toBe("Bekir Topaloğlu vd., İslam’da İnanç Esasları (İstanbul: MÜ İlâhiyat Fakültesi Vakfı Yayınları, 1998), 12.");
    expect(r.bib).toBe("Topaloğlu, Bekir vd. İslam’da İnanç Esasları. İstanbul: MÜ İlâhiyat Fakültesi Vakfı Yayınları, 1998.");
  });
  it("aynı dipnotta aynı müellifin ikinci eseri: a.mlf. (s. 65)", () => {
    const kutlu = (title: string, type: string, fields: Record<string, string>): Item => ({ ...items[0]!, key: title.slice(0, 6), itemType: type, fields: { title, ...fields }, creators: [{ creatorType: "author", lastName: "Kutlu", firstName: "Sönmez" }], notes: [], tags: [], collections: [], relations: [] });
    const a = kutlu("Türklerin İslâmlaşma Sürecinde Mürcie ve Tesirleri", "book", { place: "Ankara", publisher: "TDV Yay.", date: "2010" });
    const b = kutlu("İlk Mürciî Metinler ve Kitâbü’l-İrcâ", "journalArticle", { publicationTitle: "Ankara Üniversitesi İlahiyat Fakültesi Dergisi", volume: "37", date: "1997", pages: "317-331" });
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
    const st = emptyState();
    putCitation(st, "x", [{ id: a.key, locator: "56" }, { id: b.key, locator: "317-331" }], { [a.key]: a, [b.key]: b });
    const plan = planRefresh(st, [{ id: "x", noteIndex: 1, text: "" }], r);
    expect(htmlToText(plan.updates.get("x")!)).toBe("Sönmez Kutlu, Türklerin İslâmlaşma Sürecinde Mürcie ve Tesirleri (Ankara: TDV Yay., 2010), 56; a.mlf., “İlk Mürciî Metinler ve Kitâbü’l-İrcâ”, Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 317-331.");
  });
});

describe("a.mlf.: müellif adı farklı yazılmış olsa da", () => {
  const mk = (key: string, title: string, last: string, first: string): Item => ({ ...items[0]!, key, itemType: "book", fields: { title, place: "Beyrut", publisher: "Dâru’l-Kütübi’l-İlmiyye", date: "2000" }, creators: [{ creatorType: "author", lastName: last, firstName: first }], notes: [], tags: [], collections: [], relations: [] });
  const cases: [string, string, string, string, boolean][] = [
    ["Gazzâlî", "Ebû Hâmid Muhammed el-", "Gazzali", "Ebu Hamid", true],
    ["el-Gazzâlî", "Ebû Hâmid", "Gazzâlî", "Ebû Hâmid Muhammed b. Muhammed", true],
    ["İbn Teymiyye", "Takıyyüddîn Ahmed", "İbn Teymiyye", "", true],
    ["Yılmaz", "A.", "Yilmaz", "Ahmet", true],
    ["Yılmaz", "Ahmet", "Yılmaz", "Mehmet", false],
    ["Gazzâlî", "Ebû Hâmid", "Râzî", "Fahreddîn", false],
    ["Gazzâlî", "Ebû Hâmid Muhammed b. Muhammed el-", "Gazzâlî", "Huccetuʾl-İslâm Ebû Ḥâmid Muḥammed b. Muḥammed el-", true],
    ["Gazâlî", "Ebû Hâmid", "el-Ġazzâlî", "Ebû Ḥâmid Muḥammed", true],
    ["Yılmaz", "Ahmet", "Yılmaz", "Mehmet Ali", false],
  ];
  for (const [l1, f1, l2, f2, same] of cases) {
    it(`${l1}, ${f1} / ${l2}, ${f2} → ${same ? "a.mlf." : "ayrı müellif"}`, () => {
      const a = mk("AAAA2345", "el-Mustasfâ", l1, f1);
      const b = mk("BBBB2345", "İhyâü ulûmi’d-dîn", l2, f2);
      const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
      const st = emptyState();
      putCitation(st, "x", [{ id: a.key, locator: "1" }, { id: b.key, locator: "2" }], { [a.key]: a, [b.key]: b });
      const text = htmlToText(planRefresh(st, [{ id: "x", noteIndex: 1, text: "" }], r).updates.get("x")!);
      expect(text.includes("; a.mlf., ")).toBe(same);
    });
  }
  it("denetim farklı yazımları bulur ve birleştirir", async () => {
    const { nameVariants, unifyName } = await import("../src/core/names.js");
    const a = mk("AAAA2345", "A", "Gazzâlî", "Ebû Hâmid Muhammed el-");
    const b = mk("BBBB2345", "B", "Gazzali", "Ebu Hamid");
    const c = mk("CCCC2345", "C", "Gazzâlî", "Ebû Hâmid Muhammed el-");
    const v = nameVariants([a, b, c]);
    expect(v).toHaveLength(1);
    expect(v[0]!.spellings[0]!.label).toBe("Gazzâlî, Ebû Hâmid Muhammed el-");
    const changed = unifyName([a, b, c], v[0]!.spellings[0]!.creator, v[0]!.spellings.map((x) => x.creator));
    expect(changed.map((x) => x.key)).toEqual(["BBBB2345"]);
    expect(changed[0]!.creators[0]).toEqual({ creatorType: "author", lastName: "Gazzâlî", firstName: "Ebû Hâmid Muhammed el-" });
  });
});

describe("a.mlf. yalnız farklı eserlerde", () => {
  it("aynı eserden iki yer: a.mlf. değil, kısa atıf", () => {
    const item = work("el-Câmiʿu’ṣ-ṣaḥîḥ", "Buhârî");
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
    const st = emptyState();
    putCitation(st, "a", [{ id: item.key, kitab: "Menâḳıb", bab: "24" }], { [item.key]: item });
    putCitation(st, "b", [{ id: item.key, kitab: "Zekât", bab: "2", hadisNo: "36" }, { id: item.key, kitab: "Savm", bab: "34" }], {});
    const plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
    const text = htmlToText(plan.updates.get("b")!);
    expect(text).not.toContain("a.mlf.");
    expect(text).toBe("Buhârî, “Zekât”, 2 (No. 36); Buhârî, “Savm”, 34.");
  });
  it("aynı eserin iki ayrı kaydı da aynı eser sayılır", () => {
    const item = work("el-Câmiʿu’ṣ-ṣaḥîḥ", "Buhârî");
    const copy = { ...item, key: "COPY2345" };
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
    const st = emptyState();
    putCitation(st, "a", [{ id: item.key, kitab: "Zekât", bab: "2" }, { id: copy.key, kitab: "Savm", bab: "34" }], { [item.key]: item, [copy.key]: copy });
    const plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], r);
    expect(htmlToText(plan.updates.get("a")!)).not.toContain("a.mlf.");
  });
});

describe("İSNAD 2 kılavuzu: Kur’ân ve Kitâb-ı Mukaddes (s. 79-86)", () => {
  it("meâl-basılı: sonraki atıfta yalnız sûre ve âyet (s. 79)", () => {
    const item = work("Kur’ân-ı Kerîm Meâli");
    expect(citeMode(item)).toBe("kuran");
    const r = render(item, { sure: "8", ayet: "2" }, { sure: "8", ayet: "6" });
    expect(r.first).toBe("Kur’ân-ı Kerîm Meâli, çev. Halil Altuntaş - Muzaffer Şahin (Ankara: Diyanet İşleri Başkanlığı Yayınları, 2009), el-Enfâl 8/2.");
    expect(r.later).toBe("el-Enfâl 8/6.");
    expect(r.bib).toBe("Kur’ân-ı Kerîm Meâli. çev. Halil Altuntaş - Muzaffer Şahin. Ankara: Diyanet İşleri Başkanlığı Yayınları, 3. Basım, 2009.");
  });
  it("çeviriden çeviri: Türkçeye çev. (s. 79)", () => {
    const item = work("Kur’an Mesajı");
    const fixed = { ...item, creators: item.creators.map((c, i) => (i === 0 ? c : { ...c, creatorType: "turkceye" })) };
    const r = render(fixed, { sure: "2", ayet: "4" }, { sure: "2", ayet: "14" });
    expect(r.first).toBe("Kur’an Mesajı: Meal-Tefsir, çev. Muhammed Esed, Türkçeye çev. Cahit Koytak - Ahmet Ertürk (Ankara: İşaret Yayınları, 2002), el-Bakara 2/4.");
    expect(r.later).toBe("el-Bakara 2/14.");
    expect(r.bib).toBe("Kur’an Mesajı: Meal-Tefsir. çev. Muhammed Esed, Türkçeye çev. Cahit Koytak - Ahmet Ertürk. Ankara: İşaret Yayınları, 2002.");
  });
  it("meâl-web (s. 83)", () => {
    const r = render(work("Kur’ân Yolu"), { sure: "2", ayet: "12" }, { sure: "2", ayet: "12" });
    expect(r.first).toBe("Kur’ân Yolu (Erişim 16 Nisan 2018), el-Bakara 2/12.");
    expect(r.later).toBe("el-Bakara 2/12.");
    expect(r.bib).toBe("Kur’ân Yolu. Erişim 16 Nisan 2018. https://kuran.diyanet.gov.tr");
  });
  it("Kitâb-ı Mukaddes-basılı (s. 84)", () => {
    const item = work("Kitabı Mukaddes");
    expect(citeMode(item)).toBe("incil");
    const r = render(item, { kitap: "Yar.", bab: "1", cumle: "12" }, { kitap: "Yar.", bab: "1", cumle: "12" });
    expect(r.first).toBe("Kitabı Mukaddes (İstanbul: Kitabı Mukaddes Şirketi, 2003), Yar.1:12.");
    expect(r.later).toBe("Yar.1:12.");
    expect(r.bib).toBe("Kitabı Mukaddes. İstanbul: Kitabı Mukaddes Şirketi, 2. Basım, 2003.");
  });
  it("Kitâb-ı Mukaddes-web (s. 86)", () => {
    const r = render(work("Kitab-ı Mukaddes"), { kitap: "Yar.", bab: "1", cumle: "12" }, { kitap: "Yar.", bab: "1", cumle: "12" });
    expect(r.first).toBe("Kitab-ı Mukaddes (Erişim 12 Temmuz 2019), Yar.1:12.");
    expect(r.later).toBe("Yar.1:12.");
  });
});

describe("İSNAD 2 kılavuzu: virgül, makalede neşir", () => {
  it("kadı sicili-arşivde: kısa başlıkta yıl (s. 94)", () => {
    const item = work("Kayseri Sancağı");
    const withYear = { ...item, fields: { ...item.fields, shortTitle: "Kayseri Sancağı Şer'îye Sicil Defteri (1334-1336)" } };
    const r = render(withYear, { locator: "68-90" }, { locator: "61a-61b" });
    expect(r.later).toBe("Kayseri Sancağı Şer’îye Sicil Defteri (1334-1336), 61a-61b.");
  });
  it("parantezden önce virgül kullanılmaz (s. 67)", async () => {
    const { isnadTidy } = await import("../src/core/engine.js");
    expect(isnadTidy("Defteri, (1334-1336), 61a.")).toBe("Defteri (1334-1336), 61a.");
  });
  it("makale-tahkik/neşir: neşredilen eserin adı (s. 109)", () => {
    const r = render(work("Tırâzu’l-müzheb Adlı"), { locator: "229" }, { locator: "230" });
    expect(r.first).toContain("et-Tırâzu’l-müzheb, “Bedreddin eş-Şuhâvî’nin et-Tırâzu’l-müzheb Adlı Eserinin Tahkik ve Tercümesi”, thk. Osman Bayder, Tahkik İslami İlimler Araştırma ve Neşir Dergisi 2/1 (Haziran 2019), 229.");
    expect(r.bib).toContain("Şuhâvî, Bedreddin. et-Tırâzu’l-müzheb. “Bedreddin eş-Şuhâvî’nin et-Tırâzu’l-müzheb Adlı Eserinin Tahkik ve Tercümesi”. thk. Osman Bayder. Tahkik İslami İlimler Araştırma ve Neşir Dergisi 2/1 (Haziran 2019), 211-257.");
  });
});

describe("İSNAD 2 kılavuzu: kurum kısaltması, soru işareti", () => {
  it("standard: kurum kısaltması parantezde (s. 123)", () => {
    const r = render(work("Helal Belgelendirmesi"), {}, {});
    expect(r.first.startsWith("Türk Standardları Enstitüsü (TSE), Helal Belgelendirmesi Yapan Kuruluşlar İçin Kılavuz")).toBe(true);
    expect(r.bib.startsWith("TSE, Türk Standardları Enstitüsü. Helal Belgelendirmesi")).toBe(true);
  });
  it("kısaltma tanıma", async () => {
    const { isAcronymOf } = await import("../src/core/zotero.js");
    expect(isAcronymOf("TSE", "Türk Standardları Enstitüsü")).toBe(true);
    expect(isAcronymOf("WoS", "Web of Science")).toBe(true);
    expect(isAcronymOf("TÜİK", "Türkiye İstatistik Kurumu")).toBe(true);
    expect(isAcronymOf("YILMAZ", "Ahmet")).toBe(false);
    expect(isAcronymOf("Kaya", "Adem")).toBe(false);
  });
  it("patent: buluş sahibi ve veren kurum (s. 127)", () => {
    const r = render(work("Eğitim Dokümanları"), {}, {});
    expect(r.first).toBe("Adem Kaya, Eğitim Dokümanları İçin İçerik Sınıflandırma Sistemi ve Yöntemi (Patent, Türk Patent ve Marka Kurumu, No. 2019/07502, Tarih 17 Mayıs 2019).");
    expect(r.bib).toBe("Kaya, Adem. Eğitim Dokümanları İçin İçerik Sınıflandırma Sistemi ve Yöntemi. Patent. Türk Patent ve Marka Kurumu, No. 2019/07502, Tarih 17 Mayıs 2019. https://www.turkpatent.gov.tr/TURKPATENT");
  });
  it("İngilizce kaynağın yayın tarihi İngilizce, erişim tarihi Türkçe (s. 121)", () => {
    const item = work("Commission Decision (EU)");
    const r = render({ ...item, fields: { ...item.fields, nameOfAct: item.fields.nameOfAct!.replace(/\.$/, "") } }, { locator: "2" }, { locator: "2" });
    expect(r.first).toBe("Commission Decision (EU) 2017/1002 of 7 June 2017 on the proposed citizens’ initiative entitled Stop extremism (Stop extremism), Official Journal of the European Union L 152/1 (15 June 2017), 2.");
    expect(r.bib).toContain("(15 June 2017). Erişim 3 Eylül 2019.");
  });
  it("e-posta: kaynakçada parantez yok (s. 136)", () => {
    const r = render(work("İlahiyat Atıf Dizini hk"), {}, {});
    expect(r.bib).toBe("Doğan, Yusuf. İlahiyat Atıf Dizini hk. Kısa Mesaj 2 Eylül 2019, Alıcı Sami Şahin.");
  });
  it("nota kâğıdı / sınav kâğıdı / ambalaj: Başlık (Tür, Tarih) (s. 131-137)", () => {
    expect(render(work("İç Tasarıma Giriş"), {}, {}).first).toBe("Öğrenci 1, İç Tasarıma Giriş Dersi Vize Sınavı (Sınav Kağıdı, 20 Mart 2019), Sivas Cumhuriyet Üniversitesi, Mimarlık Fakültesi, Öğretici 1.");
    expect(render(work("Kırınkıl"), {}, {}).bib).toBe("Kırınkıl Çubuk Kraker 150 gr (Plastik Ambalaj, Ağustos 2019). İstanbul: BİM, Seri No. 291, Barkod No. 8695077001153.");
  });
  it("video kaydında platform (s. 129)", () => {
    expect(render(work("İSNAD-Kitap Bölümüne"), { locator: "00:01:10-00:01:55" }, {}).first).toBe("Muhammet Tarakçı, “İSNAD-Kitap Bölümüne Atıf”, YouTube (31 Mart 2018), 00:01:10-00:01:55.");
  });
  it("gazete: soru işaretli başlıktan sonra nokta (s. 112)", () => {
    const r = render(work("15 Temmuz’u Farklı Kılan Nedir"), { locator: "8" }, { locator: "8" });
    expect(r.bib.startsWith("Hanioğlu, M. Şükrü. “15 Temmuz’u Farklı Kılan Nedir?”. Sabah (15 Temmuz 2018), 8.")).toBe(true);
  });
});

describe("İSNAD 2 kılavuzu: türler", () => {
  it("kitap-elektronik: yayın formatı, b.y. eklenmez (s. 72)", () => {
    const r = render(work("Amisos Mozaiği"), { locator: "44" }, { locator: "98" });
    expect(r.first).toBe("Derya Şahin, Amisos Mozaiği (PDF: Kültür ve Turizm Bakanlığı Yayınları, 2004), 44.");
    expect(r.later).toBe("Şahin, Amisos Mozaiği, 98.");
  });
  it("kitap bölümü-editörlü eserde (s. 77)", () => {
    const r = render(work("Mâtürîdîliğin Ortaya Çıkışı"), { locator: "297" }, { locator: "298-299" });
    expect(r.first).toBe("Ulrich Rudolph, “Mâtürîdîliğin Ortaya Çıkışı”, çev. Ali Dere, İmam Mâturîdî ve Mâturidilik, haz. Sönmez Kutlu (Ankara: Kitâbiyât Yayınları, 2003), 297.");
    expect(r.later).toBe("Rudolph, “Mâtürîdîliğin Ortaya Çıkışı”, 298-299.");
    expect(r.bib).toBe("Rudolph, Ulrich. “Mâtürîdîliğin Ortaya Çıkışı”. çev. Ali Dere. İmam Mâturîdî ve Mâturidilik. haz. Sönmez Kutlu. 295-304. Ankara: Kitâbiyât Yayınları, 2003.");
  });
  it("kitap bölümü-neşredilen eserde, mukaddime ve mlf. (s. 78)", () => {
    const item = work("Mukaddime");
    const noVol = { ...item, fields: { ...item.fields, volume: "" } };
    const r = render(noVol, { locator: "14" }, { locator: "34" });
    expect(r.first).toBe("Hişam İbrahim Mahmud, “Mukaddime”, Telḫîṣü’l-edille li-ḳavâʿidi’t-tevḥîd, mlf. Ebû İshâk İbrâhim ez-Zâhid es-Saffâr (Kahire: Dâru’s-Selâm, 1431/2010), 14.");
    expect(r.later).toBe("Mahmud, “Mukaddime”, 34.");
    expect(r.bib).toBe("Mahmud, Hişam İbrahim. “Mukaddime”. Telḫîṣü’l-edille li-ḳavâʿidi’t-tevḥîd. mlf. Ebû İshâk İbrâhim ez-Zâhid es-Saffâr. 5-44. Kahire: Dâru’s-Selâm, 1431/2010.");
  });
  it("hadis: “Kitâb”, Bâb (No.) sistemi (s. 87)", () => {
    const item = work("el-Câmiʿu’ṣ-ṣaḥîḥ", "Buhârî");
    expect(citeMode(item)).toBe("hadis-bab");
    const r = render(item, { kitab: "Menâḳıb", bab: "24", hadisNo: "3437" }, { kitab: "Menâḳıb", bab: "24", hadisNo: "3437" });
    expect(r.first).toBe("Ebû Abdillâh Muhammed b. İsmail el-Buhârî, el-Câmiʿu’ṣ-ṣaḥîḥ, nşr. Muhammed Züheyr b. Nasr (b.y.: Dâru Tavki’n-Necât, 1422/2001), “Menâḳıb”, 24 (No. 3437).");
    expect(r.later).toBe("Buhârî, “Menâḳıb”, 24 (No. 3437).");
    expect(r.bib).toBe("Buhârî, Ebû Abdillâh Muhammed b. İsmail. el-Câmiʿu’ṣ-ṣaḥîḥ. nşr. Muhammed Züheyr b. Nasr. 8 Cilt. b.y.: Dâru Tavki’n-Necât, 2. Basım, 1422/2001.");
  });
  it("hadis: “Kitâb”, Hadis no sistemi (s. 88)", () => {
    const item = work("el-Muvaṭṭaʾ");
    expect(citeMode(item)).toBe("hadis-no");
    const r = render(item, { kitab: "Sadaka", bab: "12" }, { kitab: "Sadaka", bab: "12" });
    expect(r.first).toBe("Ebû Abdillâh Mâlik b. Enes el-Asbahî İmam Mâlik, el-Muvaṭṭaʾ, nşr. Abdüvehhâb Abdüllatîf (Kahire: y.y., 1382/1962), “Sadaka”, 12.");
    expect(r.later).toBe("İmam Mâlik, “Sadaka”, 12.");
    expect(r.bib).toBe("İmam Mâlik, Ebû Abdillâh Mâlik b. Enes el-Asbahî. el-Muvaṭṭaʾ. nşr. Abdüvehhâb Abdüllatîf. Kahire: y.y., 1382/1962.");
  });
  it("hadis: Cilt/Sayfa sistemi (s. 89)", () => {
    const item = work("el-Müsned");
    expect(citeMode(item)).toBe("hadis-cilt");
    const r = render(item, { volume: "4", locator: "289", hadisNo: "8716" }, { volume: "4", locator: "289", hadisNo: "8716" });
    expect(r.first).toBe("Ebû Abdillâh Ahmed b. Muhammed b. Hanbel eş-Şeybânî Ahmed b. Hanbel, el-Müsned, nşr. Ebû Hâcir Muhammed Saîd Besyûnî (Beyrut: y.y., 1405/1985), 4/289 (No. 8716).");
    expect(r.later).toBe("Ahmed b. Hanbel, el-Müsned, 4/289 (No. 8716).");
  });
  it("yazma eser: varakta vr. yok; sonraki atıfta koleksiyon ve numara (s. 91)", () => {
    const r = render(work("et-Temhîd fî beyâni"), { locator: "77b" }, { locator: "77b" });
    expect(r.first).toBe("Ebû Şekûr Muhammed b. Abdüsseyyid es-Sâlimî Keşşî, et-Temhîd fî beyâni’t-tevḥîd (İstanbul: Süleymaniye Kütüphanesi, Şehit Ali Paşa, 1153), 77b.");
    expect(r.later).toBe("Keşşî, et-Temhîd (Şehit Ali Paşa, 1153), 77b.");
    expect(r.bib).toBe("Keşşî, Ebû Şekûr Muhammed b. Abdüsseyyid es-Sâlimî. et-Temhîd fî beyâni’t-tevḥîd. İstanbul: Süleymaniye Kütüphanesi, Şehit Ali Paşa, 1153, 1a-217b.");
  });
  it("kadı sicili-matbu: iki hazırlayan arasında tire (s. 94)", () => {
    const r = render(work("Galata Mahkemesi"), { locator: "51" }, { locator: "51" });
    expect(r.first).toBe("Galata Mahkemesi 90 Numaralı Sicil (1073-1074/1663), haz. Fuat Recep - Salih Kahriman (İstanbul: İSAM Yayınları, 2012), 51.");
    expect(r.later).toBe("Galata Mahkemesi 90 Numaralı Sicil, 51.");
    expect(r.bib).toBe("Galata Mahkemesi 90 Numaralı Sicil (1073-1074/1663). haz. Fuat Recep - Salih Kahriman. İstanbul: İSAM Yayınları, 2012. http://www.kadisicilleri.org/index.php");
  });
  it("ansiklopedi-matbu (s. 95)", () => {
    const r = render(work("Âlî Mustafa Efendi"), { locator: "416" }, { locator: "416" });
    expect(r.first).toBe("Ömer Faruk Akün, “Âlî Mustafa Efendi”, Türkiye Diyanet Vakfı İslâm Ansiklopedisi (Ankara: TDV Yayınları, 1989), 2/416.");
    expect(r.later).toBe("Akün, “Âlî Mustafa Efendi”, 2/416.");
    expect(r.bib).toBe("Akün, Ömer Faruk. “Âlî Mustafa Efendi”. Türkiye Diyanet Vakfı İslâm Ansiklopedisi. 2/416-417. Ankara: TDV Yayınları, 1989.");
  });
  it("sözlük-Arap harfli: madde atıfta, kaynakçada yok (s. 98)", () => {
    const item = work("Keşşâfü ıṣṭılâḥâti");
    expect(citeMode(item)).toBe("sozluk");
    const noVol = { ...item, fields: { ...item.fields, volume: "" } };
    const r = render(noVol, { madde: "delîl", volume: "1", locator: "793-799" }, { madde: "delîl", volume: "1", locator: "797" });
    expect(r.first).toBe("Muhammed Ali b. Ali Tehânevî, Keşşâfü ıṣṭılâḥâti’l-fünûn ve’l-‘ulûm, nşr. Ali Dahrûc - Abdullah Hâlidî (Beyrut: Mektebetü Lübnan, 1996), “delîl”, 1/793-799.");
    expect(r.later).toBe("Tehânevî, “delîl”, 1/797.");
    expect(r.bib).toBe("Tehânevî, Muhammed Ali b. Ali. Keşşâfü ıṣṭılâḥâti’l-fünûn ve’l-‘ulûm. nşr. Ali Dahrûc - Abdullah Hâlidî. 2 Cilt. Beyrut: Mektebetü Lübnan, 1996.");
  });
  it("sözlük-Latin harfli, madde kayıtta (s. 99)", () => {
    const r = render(work("Kelâm Terimleri Sözlüğü"), { locator: "174-175" }, { locator: "174-175" });
    expect(r.first).toBe("Bekir Topaloğlu - İlyas Çelebi, Kelâm Terimleri Sözlüğü (İstanbul: İSAM Yayınları, 2015), “Kader”, 174-175.");
    expect(r.later).toBe("Topaloğlu - Çelebi, “Kader”, 174-175.");
    expect(r.bib).toBe("Topaloğlu, Bekir - Çelebi, İlyas. Kelâm Terimleri Sözlüğü. İstanbul: İSAM Yayınları, 4. Basım, 2015.");
  });
  it("sözlük-web: b.y./y.y. eklenmez (s. 100)", () => {
    const r = render(work("Kubbealtı Lugati"), {}, {});
    expect(r.first).toBe("Kubbealtı Lugati, “İsnat-İsnad” (Erişim 11 Temmuz 2019).");
    expect(r.later).toBe("Kubbealtı Lugati, “İsnat-İsnad”.");
    expect(r.bib).toBe("Kubbealtı Lugati. Erişim 11 Temmuz 2019. http://lugatim.com");
  });
  it("aynı sözlüğün iki maddesi kaynakçada bir kez yer alır (s. 98)", () => {
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
    const kader = work("Kelâm Terimleri Sözlüğü");
    const kesb = { ...kader, key: "KESB0002", fields: { ...kader.fields, title: "Kesb" } };
    const st = emptyState();
    putCitation(st, "a", [{ id: kader.key, locator: "174" }], { [kader.key]: kader });
    putCitation(st, "b", [{ id: kesb.key, locator: "180" }], { [kesb.key]: kesb });
    const plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
    expect(plan.bibliography!.entries).toHaveLength(1);
  });
});

describe("İSNAD 2 kılavuzu: metin içi (s. 139-)", () => {
  const mi = (item: Item, locator?: string) => {
    const r = new Renderer(readFileSync(new URL("isnad-metinici.csl", styles), "utf8"), locales);
    const st = emptyState("isnad-metinici");
    putCitation(st, "a", [{ id: item.key, ...(locator ? { locator } : {}) }], { [item.key]: item });
    const p = planRefresh(st, [{ id: "a", noteIndex: 0, text: "" }], r);
    return { cite: htmlToText(p.updates.get("a")!), bib: htmlToText(p.bibliography!.entries[0]!.html) };
  };
  it("kitap-tek yazarlı (s. 141)", () => {
    const item = { ...work("Geschichte des arabischen"), fields: { ...work("Geschichte des arabischen").fields, volume: "" } };
    expect(mi(item).cite).toBe("(Sezgin, 1967-2015)");
    expect(mi(item, "17/19-23").cite).toBe("(Sezgin, 1967-2015, 17/19-23)");
  });
  it("kitap bölümü: hazırlayan bir kez (s. 150)", () => {
    const r = mi(work("Mâtürîdîliğin Ortaya Çıkışı"));
    expect(r.bib).toBe("Rudolph, Ulrich. “Mâtürîdîliğin Ortaya Çıkışı”. çev. Ali Dere. İmam Mâturîdî ve Mâturidilik. haz. Sönmez Kutlu. 295-304. Ankara: Kitâbiyât Yayınları, 2003.");
  });
  it("a.mlf. metin içinde de (s. 139)", () => {
    const mk = (key: string, title: string, date: string): Item => ({ ...items[0]!, key, itemType: "book", fields: { title, place: "Ankara", publisher: "TDV", date }, creators: [{ creatorType: "author", lastName: "Kutlu", firstName: "Sönmez" }], notes: [], tags: [], collections: [], relations: [] });
    const a = mk("AAAA2345", "Türklerin İslâmlaşma Sürecinde Mürcie", "2010");
    const b = mk("BBBB2345", "İlk Mürciî Metinler", "1997");
    const r = new Renderer(readFileSync(new URL("isnad-metinici.csl", styles), "utf8"), locales);
    const st = emptyState("isnad-metinici");
    putCitation(st, "x", [{ id: a.key, locator: "56" }, { id: b.key, locator: "317-331" }], { [a.key]: a, [b.key]: b });
    expect(htmlToText(planRefresh(st, [{ id: "x", noteIndex: 0, text: "" }], r).updates.get("x")!)).toBe("(Kutlu, 2010, 56; a.mlf., 1997, 317-331)");
  });
});

describe("nisbede harf-i tarif (s. 91)", () => {
  it("eksikse denetim önerir; eklenince ilk atıfta el-Keşşî, kısa atıfta Keşşî", async () => {
    const { checkItem, applyFix } = await import("../src/core/isnad.js");
    const base: Item = { ...items[0]!, key: "KESSI234", itemType: "manuscript", fields: { title: "et-Temhîd fî beyâni’t-tevḥîd", archive: "Süleymaniye Kütüphanesi", archiveLocation: "Şehit Ali Paşa, 1153", place: "İstanbul" }, creators: [{ creatorType: "author", lastName: "Keşşî", firstName: "Ebû Şekûr Muhammed b. Abdüsseyyid es-Sâlimî" }], notes: [], tags: [], collections: [], relations: [] };
    const issue = checkItem(base).find((i) => i.code === "nisba-article")!;
    expect(issue.fixLabel).toBe('"el-" ekle');
    const fixed = applyFix(base, issue.fix!);
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
    const st = emptyState();
    putCitation(st, "a", [{ id: fixed.key, locator: "77b" }], { [fixed.key]: fixed });
    putCitation(st, "b", [{ id: fixed.key, locator: "78a" }], { [fixed.key]: fixed });
    const plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
    expect(htmlToText(plan.updates.get("a")!)).toMatch(/^Ebû Şekûr Muhammed b\. Abdüsseyyid es-Sâlimî el-Keşşî, et-Temhîd/);
    expect(htmlToText(plan.updates.get("b")!)).toMatch(/^Keşşî, et-Temhîd/);
  });
});

describe("Mevzuat-Diğer (s. 122)", () => {
  it("dipnotta Kurum (yıl), md.; kaynakçada Türkiye: Kurum, yıl", () => {
    const it2: Item = { ...items[0]!, key: "YKBAYEY1", itemType: "statute", fields: { title: "Yükseköğretim Kurulu Bilimsel Araştırma ve Yayın Etiği Yönergesi", shortTitle: "YKBAYEY", date: "2016", extra: "publisher-place: Türkiye\nauthority: Yükseköğretim Kurulu" }, creators: [], notes: [], tags: [], collections: [], relations: [] };
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
    const st = emptyState();
    putCitation(st, "a", [{ id: it2.key, locator: "4", label: "sub verbo" }], { [it2.key]: it2 });
    putCitation(st, "b", [{ id: it2.key, locator: "3", label: "sub verbo" }], { [it2.key]: it2 });
    const plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
    expect(htmlToText(plan.updates.get("a")!)).toBe("Yükseköğretim Kurulu Bilimsel Araştırma ve Yayın Etiği Yönergesi (YKBAYEY), Yükseköğretim Kurulu (2016), md. 4.");
    expect(htmlToText(plan.updates.get("b")!)).toBe("YKBAYEY, md. 3.");
    expect(htmlToText(plan.bibliography!.entries[0]!.html)).toBe("YKBAYEY, Yükseköğretim Kurulu Bilimsel Araştırma ve Yayın Etiği Yönergesi. Türkiye: Yükseköğretim Kurulu, 2016.");
  });
});

describe("APA ve Chicago: İSNAD kuralları karışmaz", () => {
  const razi: Item = { ...items[0]!, key: "RAZI0001", itemType: "book", fields: { title: "el-Maḥsûl fî ʿilmi uṣûli’l-fıḳh", place: "Beyrut", publisher: "Müessesetü’r-Risâle", date: "1418/1997" }, creators: [{ creatorType: "author", lastName: "Râzî", firstName: "Fahreddin Muhammed b. Ömer er-" }, { creatorType: "muhakkik", lastName: "Alvânî", firstName: "Tâhâ Câbir" }], notes: [], tags: [], collections: [], relations: [] };
  const anon: Item = { ...razi, key: "NOPLACE1", fields: { title: "Kelam ve Akaid Risaleleri", date: "2016" }, creators: [{ creatorType: "author", lastName: "Râzî", firstName: "Fahreddin Muhammed b. Ömer er-" }] };
  const run = (style: string) => {
    const r = new Renderer(readFileSync(new URL(`${style}.csl`, styles), "utf8"), locales);
    const st = emptyState();
    const W = { [razi.key]: razi, [anon.key]: anon };
    putCitation(st, "x", [{ id: razi.key, volume: "1", locator: "45" }, { id: anon.key, locator: "12" }], W);
    const plan = planRefresh(st, [{ id: "x", noteIndex: 1, text: "" }], r);
    return { note: htmlToText(plan.updates.get("x")!), bib: plan.bibliography!.entries.map((e) => htmlToText(e.html)).join(" | ") };
  };
  it("APA: Cilt 1, s. 45; muhakkik editör; b.y./y.y. ve a.mlf. yok", () => {
    const o = run("apa");
    expect(o.note).toContain("Cilt 1, s. 45");
    expect(o.note).not.toMatch(/a\.mlf\.|b\.y\.|y\.y\./);
    expect(o.bib).toContain("(T. C. Alvânî, Ed.)");
    expect(o.bib).toContain("er-Râzî, F. M. b. Ö.");
  });
  it("Chicago: 1:45, ed.; İSNAD kısaltmaları yok", () => {
    const o = run("chicago-notes-bibliography");
    expect(o.note).toContain("ed. Tâhâ Câbir Alvânî");
    expect(o.note).toContain("1:45");
    expect(o.note + o.bib).not.toMatch(/a\.mlf\.|b\.y\.|y\.y\.|thk\./);
  });
});

describe("ön ek: bk., krş.", () => {
  it("dipnot başında büyük harfle (Bk.), sonraki eserde küçük (krş.)", () => {
    const a: Item = { ...items[0]!, key: "PREF0001", itemType: "book", fields: { title: "el-Mustasfâ", place: "Beyrut", publisher: "Dâru’l-Kütübi’l-İlmiyye", date: "1993" }, creators: [{ creatorType: "author", lastName: "Gazzâlî", firstName: "Ebû Hâmid" }], notes: [], tags: [], collections: [], relations: [] };
    const b: Item = { ...a, key: "PREF0002", fields: { ...a.fields, title: "el-Mahsûl" }, creators: [{ creatorType: "author", lastName: "Râzî", firstName: "Fahreddin" }] };
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
    const st = emptyState();
    putCitation(st, "x", [{ id: a.key, locator: "4", prefix: "bk." }, { id: b.key, locator: "9", prefix: "krş." }], { [a.key]: a, [b.key]: b });
    const out = htmlToText(planRefresh(st, [{ id: "x", noteIndex: 1, text: "" }], r).updates.get("x")!);
    expect(out).toMatch(/^Bk\. Ebû Hâmid Gazzâlî, el-Mustasfâ .*; krş\. Fahreddin Râzî, el-Mahsûl/);
  });
});

describe("soyadına yazılmış harf-i tarif (Zotero alışkanlığı)", () => {
  it("“el-Gazzâlî” soyadı: ilk atıfta el-Gazzâlî, kısa atıfta ve metin içinde Gazzâlî, kaynakçada G harfinde", () => {
    const g: Item = { ...items[0]!, key: "GAZEL001", itemType: "book", fields: { title: "İhyâü ulûmi’d-dîn", place: "Beyrut", publisher: "Dâru’l-Maʿrife", date: "1982" }, creators: [{ creatorType: "author", lastName: "el-Gazzâlî", firstName: "Ebû Hâmid Muhammed b. Muhammed" }], notes: [], tags: [], collections: [], relations: [] };
    const run = (style: string) => {
      const r = new Renderer(readFileSync(new URL(`${style}.csl`, styles), "utf8"), locales);
      const st = emptyState();
      putCitation(st, "a", [{ id: g.key, locator: "4" }], { [g.key]: g });
      putCitation(st, "b", [{ id: g.key, locator: "5" }], { [g.key]: g });
      const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
      return [htmlToText(p.updates.get("a")!), htmlToText(p.updates.get("b")!), htmlToText(p.bibliography!.entries[0]!.html)];
    };
    const [first, short, bib] = run("isnad-dipnotlu");
    expect(first).toMatch(/^Ebû Hâmid Muhammed b\. Muhammed el-Gazzâlî, /);
    expect(short).toBe("Gazzâlî, İhyâü ulûmi’d-dîn, 5.");
    expect(bib).toMatch(/^Gazzâlî, Ebû Hâmid Muhammed b\. Muhammed\. /);
    expect(run("isnad-metinici")[1]).toBe("(Gazzâlî, 1982, 5)");
  });
});

describe("Kur’ân atfı İngilizce çalışmada (s. 80-82)", () => {
  it("dil İngilizce: al-Baqara 2/4; Türkçe: el-Bakara 2/4", () => {
    const q: Item = { ...items[0]!, key: "KURAN001", itemType: "book", fields: { title: "Kur’ân-ı Kerîm Meâli", place: "Ankara", publisher: "Diyanet İşleri Başkanlığı Yayınları", date: "2009" }, creators: [{ creatorType: "translator", lastName: "Altuntaş", firstName: "Halil" }], notes: [], tags: [], collections: [], relations: [] };
    const out = (lang: string) => {
      const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales, lang);
      const st = emptyState();
      putCitation(st, "x", [{ id: q.key, sure: "2", ayet: "4" }], { [q.key]: q });
      return htmlToText(planRefresh(st, [{ id: "x", noteIndex: 1, text: "" }], r).updates.get("x")!);
    };
    expect(out("tr-TR")).toMatch(/, el-Bakara 2\/4\.$/);
    expect(out("en-US")).toMatch(/, al-Baqara 2\/4\.$/);
  });
  it("Kitâb-ı Mukaddes: Yar.1:12 / Gen.1:12", async () => {
    const { composeLocator } = await import("../src/core/isnadmodes.js");
    expect(composeLocator({ id: "x", kitap: "Yar.", bab: "1", cumle: "12" }, "tr-TR")?.locator).toBe("Yar.1:12");
    expect(composeLocator({ id: "x", kitap: "Yar.", bab: "1", cumle: "12" }, "en-US")?.locator).toBe("Gen.1:12");
  });
});

describe("İSNAD İngilizce: n.p., no date (resmî stil), idem", () => {
  it("eksik künye ve aynı müellif İngilizce kısaltmalarla", () => {
    const a: Item = { ...items[0]!, key: "ENGL0001", itemType: "book", fields: { title: "Kitāb al-Tawḥīd" }, creators: [{ creatorType: "author", lastName: "Māturīdī", firstName: "Abū Manṣūr al-" }], notes: [], tags: [], collections: [], relations: [] };
    const b: Item = { ...a, key: "ENGL0002", fields: { title: "Taʾwīlāt al-Qurʾān", place: "Istanbul", publisher: "Mizan", date: "2005" } };
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales, "en-US");
    const st = emptyState();
    putCitation(st, "x", [{ id: a.key, locator: "4" }, { id: b.key, locator: "9" }], { [a.key]: a, [b.key]: b });
    const out = htmlToText(planRefresh(st, [{ id: "x", noteIndex: 1, text: "" }], r).updates.get("x")!);
    expect(out).toContain("Kitāb al-Tawḥīd (n.p.: n.p., no date), 4");
    expect(out).toContain("; idem, ");
    expect(out).not.toMatch(/b\.y\.|y\.y\.|a\.mlf\./);
  });
});

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
  const found = items.filter((i) => [i.fields.title, i.fields.dictionaryTitle].some((t) => t?.includes(title)) && (!author || i.creators.some((c) => c.lastName === author)));
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
    expect(r.bib).toBe("Buhârî, Ebû Abdillâh Muhammed b. İsmail el-. el-Câmiʿu’ṣ-ṣaḥîḥ. nşr. Muhammed Züheyr b. Nasr. 8 Cilt. b.y.: Dâru Tavki’n-Necât, 2. Basım, 1422/2001.");
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

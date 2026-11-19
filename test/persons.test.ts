import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyState, planRefresh, putCitation, setEnglishNames } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { buildDict, diaSuggestion, onlyMarks, englishCreator, findPerson, indexPersons, personsFromRows, readCsv, searchPersons, transliterate, type PersonTable } from "../src/core/persons.js";
import { emptyItem } from "../src/core/zotero.js";

const styles = new URL("../data/styles/", import.meta.url);
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, styles), "utf8");
  } catch {
    return undefined;
  }
};

// A few rows in the layout of the user's table (headings as in it).
const CSV = `Sıra;Kısa Ad (DİA);Tam Ad (DİA);Orijinal Ad;Vefat Tarihi;EI3 Transliterasyonu (Kısa Ad);EI3 Transliterasyonu (Tam Ad);Osmanlıca Transliterasyon (EI3 parantez biçimi);Grup;Uygulanan EI3 kuralı;Yöntem;Kontrol notu
1;Buhârî, Muhammed b. İsmâil;Ebû Abdullah Muhammed b. İsmâîl b. İbrâhîm el-Buhârî;;(ö. 256/870);al-Bukhārī, Muḥammad b. Ismāʿīl;Abū ʿAbdallāh Muḥammad b. Ismāʿīl b. Ibrāhīm al-Bukhārī;;Arap;;;
2;Gazzâlî;Ebû Hâmid Muhammed b. Muhammed b. Ahmed el-Gazzâlî;;(ö. 505/1111);al-Ghazālī;Abū Ḥāmid Muḥammad b. Muḥammad b. Aḥmad al-Ghazālī;;Arap;;;
3;Ahmed el-Gazzâlî;Ebü’l-Fütûh Ahmed b. Muhammed el-Gazzâlî;;(ö. 520/1126);Aḥmad al-Ghazālī;Abū l-Futūḥ Aḥmad b. Muḥammad al-Ghazālī;;Arap;;;
4;Fahreddin er-Râzî;Ebû Abdillâh Fahrüddîn Muhammed b. Ömer er-Râzî;;(ö. 606/1210);Fakhr al-Dīn al-Rāzī;Abū ʿAbdallāh Fakhr al-Dīn Muḥammad b. ʿUmar al-Rāzī;;Arap;;;
5;Kâtib Çelebi;---;---;(ö. 1067/1657);Katib Çelebi;;Kātib Çelebi;Osmanlı / Türk;;;
6;Kara, Mustafa;---;---;(ö. 1950);Kara, Mustafa;;;Osmanlı / Türk;;;`;

const table = (): PersonTable => {
  const persons = personsFromRows(readCsv(CSV));
  return { persons, dict: buildDict(persons), source: "test" };
};

describe("Şahıslar (DİA–EI3)", () => {
  const t = table();
  const ix = indexPersons(t);
  it("reads the table and learns the words", () => {
    expect(t.persons.length).toBe(6);
    expect(t.persons[0]).toMatchObject({ dia: "Buhârî, Muhammed b. İsmâil", death: "256/870", group: "Arap" });
    expect(t.persons[4]!.diaFull).toBeUndefined();
    expect(transliterate("Ebû Abdullah Muhammed", t.dict)).toBe("Abū ʿAbdallāh Muḥammad");
    expect(transliterate("Fahrüddîn Muhammed", t.dict)).toBe("Fakhr al-Dīn Muḥammad");
  });
  it("finds the person of a record's creator, and only then", () => {
    const find = (lastName: string, firstName = "") => findPerson({ creatorType: "author", lastName, firstName }, ix)?.dia ?? null;
    expect(find("Gazzâlî", "Ebû Hâmid Muhammed el-")).toBe("Gazzâlî");
    expect(find("Gazzâlî", "Ahmed")).toBe("Ahmed el-Gazzâlî");
    expect(find("Gazzâlî")).toBe("Gazzâlî");
    expect(find("Buhârî", "Ebû Abdullah Muhammed b. İsmâîl el-")).toBe("Buhârî, Muhammed b. İsmâil");
    expect(find("Kara", "Mustafa")).toBe("Kara, Mustafa");
    expect(find("Kara", "Ahmet")).toBeNull();
    expect(find("Yılmaz", "Hüseyin")).toBeNull();
  });
  it("writes the EI3 form", () => {
    const p = findPerson({ creatorType: "author", lastName: "Râzî", firstName: "Fahreddin er-" }, ix)!;
    expect(englishCreator({ creatorType: "author", lastName: "Râzî", firstName: "Fahrüddîn er-" }, p, t.dict).creator).toEqual({ creatorType: "author", lastName: "al-Rāzī", firstName: "Fakhr al-Dīn" });
    expect(searchPersons("gazz", ix).map((x) => x.dia)).toEqual(["Gazzâlî", "Ahmed el-Gazzâlî"]);
  });
  it("English İSNAD: names the EI3 way, al- with the surname", () => {
    const book = emptyItem("book");
    book.key = "BUHARI01";
    book.creators = [{ creatorType: "author", lastName: "Buhârî", firstName: "Ebû Abdullah Muhammed b. İsmâîl el-" }];
    book.fields = { title: "al-Jāmiʿ al-ṣaḥīḥ", place: "Beirut", publisher: "Dār Ṭawq al-Najāt", date: "1422/2001" };
    setEnglishNames((c) => {
      const p = findPerson(c, ix);
      return p ? englishCreator(c, p, t.dict).creator : c;
    });
    try {
      const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales, "en-US");
      const st = emptyState();
      putCitation(st, "a", [{ id: book.key, locator: "12" }], { [book.key]: book });
      putCitation(st, "b", [{ id: book.key, locator: "13" }], { [book.key]: book });
      const plan = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
      expect(htmlToText(plan.updates.get("a")!)).toMatch(/^Abū ʿAbdallāh Muḥammad b\. Ismāʿīl al-Bukhārī, al-Jāmiʿ al-ṣaḥīḥ/);
      expect(htmlToText(plan.updates.get("b")!)).toMatch(/^al-Bukhārī, al-Jāmiʿ/);
      expect(plan.bibliography!.entries.map((e) => htmlToText(e.html)).join("\n")).toMatch(/al-Bukhārī, Abū ʿAbdallāh Muḥammad b\. Ismāʿīl\./);
      // Turkish: the record as it is.
      const tr = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
      const st2 = emptyState();
      putCitation(st2, "a", [{ id: book.key, locator: "12" }], { [book.key]: book });
      expect(htmlToText(planRefresh(st2, [{ id: "a", noteIndex: 1, text: "" }], tr).updates.get("a")!)).toMatch(/^Ebû Abdullah Muhammed b\. İsmâîl el-Buhârî/);
    } finally {
      setEnglishNames(null);
    }
  });
});

describe("DİA yazımı (Türkçe)", () => {
  const t = table();
  const ix = indexPersons(t);
  const sug = (lastName: string, firstName = "") => {
    const c = { creatorType: "author", lastName, firstName };
    const s = diaSuggestion(c, ix);
    return s ? `${s.creator.firstName ?? ""}|${s.creator.lastName}${s.loose ? " ~" : ""}${onlyMarks(c, s.creator) ? " =" : ""}` : null;
  };
  it("respells, adds the article, fills kunya and ism", () => {
    expect(sug("Gazzali", "Ebu Hamid Muhammed")).toBe("Ebû Hâmid Muhammed el-|Gazzâlî =");
    expect(sug("Gazali")).toBe("Ebû Hâmid Muhammed el-|Gazzâlî ~");
    expect(sug("Gazzâlî", "Ebû Hâmid Muhammed el-")).toBeNull();
    expect(sug("Buhari", "Muhammed b. Ismail")).toBe("Muhammed b. İsmâil el-|Buhârî =");
    expect(sug("Razi", "Fahreddin")).toBe("Fahreddin er-|Râzî =");
    expect(sug("Kara", "Mustafa")).toBeNull();
    expect(sug("Yılmaz", "Hüseyin")).toBeNull();
  });
});

import { ei3Replacements } from "../src/core/persons.js";

describe("Metindeki adlar DİA → EI3", () => {
  it("replaces the longest form, drops Turkish suffixes", () => {
    const ix = indexPersons(table());
    expect(ei3Replacements("Fahreddin er-Râzî and Gazzâlî’nin views; Râzî again. Kâtib Çelebi’s work. Mustafa Kara.", ix)).toEqual([
      { from: "Fahreddin er-Râzî", to: "Fakhr al-Dīn al-Rāzī" },
      { from: "Kâtib Çelebi’s", to: "Katib Çelebi’s" },
      { from: "Gazzâlî’nin", to: "al-Ghazālī" },
    ]);
  });
});

describe("DİA yazımı doğru kaydı bozmaz", () => {
  const rows = `Sıra;Kısa Ad (DİA);Tam Ad (DİA);Orijinal Ad;Vefat Tarihi;EI3 Transliterasyonu (Kısa Ad);EI3 Transliterasyonu (Tam Ad);Osmanlıca;Grup;Kural;Yöntem;Kontrol notu
1;Dîb, Abdülazîm Mahmûd;---;;(ö. 2010);al-Dīb, ʿAbd al-ʿAẓīm;;;Arap;;;
2;Barkan, Ömer Lutfi;---;;(ö. 1979);Barkan, Ömer Lutfi;;;Osmanlı / Türk;;;
3;Sekkā, Mustafa Muhammed;---;;(ö. 1969);al-Saqqā, Muṣṭafā;;;Arap;;;
4;Muhammed Fuâd Abdülbâkī;---;;(ö. 1968);Muḥammad Fuʾād ʿAbd al-Bāqī;;;Arap;;;
5;Keccî;Ebû Müslim İbrâhim b. Abdullah el-Keccî;;(ö. 292/905);al-Kajjī;;;Arap;;;
6;Saffâr, Ebû İshak;Ebû İshak İbrâhim b. İsmâil ez-Zâhid es-Saffâr;;(ö. 534/1139);al-Ṣaffār, Abū Isḥāq;;;Arap;;;
7;Bustânî, Butrus b. Bûlus;---;;(ö. 1883);al-Bustānī, Buṭrus;;;Arap;;;`;
  const persons = personsFromRows(readCsv(rows));
  const ix = indexPersons({ persons, dict: buildDict(persons), source: "t" });
  const auto = (lastName: string, firstName: string) => {
    const c = { creatorType: "author", lastName, firstName };
    const s = diaSuggestion(c, ix);
    return s && !s.loose && onlyMarks(c, s.creator) ? `${s.creator.lastName ?? s.creator.name}|${s.creator.firstName ?? ""}` : null;
  };
  it("kurum, Türkçe harf, başka kişi, iki alanlı ad, harf-i tarif, düz yazım", () => {
    expect(diaSuggestion({ creatorType: "author", lastName: "DİB", firstName: "Diyanet İşleri Başkanlığı" }, ix)).toBeNull();
    expect(auto("Barkan", "Ömer Lütfi")).toBeNull();
    expect(diaSuggestion({ creatorType: "author", lastName: "es-Sekkā", firstName: "Ahmed Hicâzî" }, ix)).toBeNull();
    expect(auto("Abdulbaki", "Muhammed Fuad")).toBe("Abdülbâkī|Muhammed Fuâd");
    expect(diaSuggestion({ creatorType: "author", lastName: "Koca", firstName: "Fatih" }, ix)).toBeNull();
    expect(auto("Saffâr", "Ebû İshâk İbrâhim ez-Zâhid es-")).toBeNull();
    expect(auto("Saffar", "Ebu Ishak Ibrahim ez-Zahid es-")).toBe("Saffâr|Ebû İshak İbrâhim ez-Zâhid es-");
    expect(auto("Bustani", "Butrus el-")).toBe("Bustânî|Butrus el-");
  });
});

describe("İngilizce EI3: çağdaş Türk adları çevrilmez, bileşik soyad", () => {
  const rows = `Sıra;Kısa Ad (DİA);Tam Ad (DİA);Orijinal Ad;Vefat Tarihi;EI3 Transliterasyonu (Kısa Ad);EI3 Transliterasyonu (Tam Ad);Osmanlıca;Grup;Kural;Yöntem;Kontrol notu
1;Topaloğlu, Bekir;---;---;(ö. 2016);Topaloğlu, Bekir;;;Osmanlı / Türk;;;
2;Muhammed Fuâd Abdülbâkī;---;;(ö. 1968);Muḥammad Fuʾād ʿAbd al-Bāqī;;;Arap;;;
3;Ebû Bekir;Ebû Bekir Abdullah b. Ebû Kuhâfe;;(ö. 13/634);Abū Bakr;Abū Bakr ʿAbdallāh b. Abī Quḥāfa;;Arap;;;
4;Abdülhalîm Mahmûd;---;;(ö. 1978);ʿAbd al-Ḥalīm Maḥmūd;;;Arap;;;`;
  const persons = personsFromRows(readCsv(rows));
  const t = { persons, dict: buildDict(persons), source: "t" };
  const ix = indexPersons(t);
  const en = (lastName: string, firstName: string) => {
    const c = { creatorType: "author", lastName, firstName };
    const p = findPerson(c, ix);
    return p ? englishCreator(c, p, t.dict).creator : null;
  };
  it("Bekir stays Bekir; Abdülbâkī is ʿAbd al-Bāqī; Abdülhalim finds Abdülhalîm", () => {
    expect(en("Topaloğlu", "Bekir")).toEqual({ creatorType: "author", lastName: "Topaloğlu", firstName: "Bekir" });
    expect(en("Abdülbâkī", "Muhammed Fuâd")).toEqual({ creatorType: "author", lastName: "ʿAbd al-Bāqī", firstName: "Muḥammad Fuʾād" });
    expect(en("Mahmud", "Abdülhalim")).toEqual({ creatorType: "author", lastName: "Maḥmūd", firstName: "ʿAbd al-Ḥalīm" });
  });
});

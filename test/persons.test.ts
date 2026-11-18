import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyState, planRefresh, putCitation, setEnglishNames } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { buildDict, diaSuggestion, onlyMarks, englishCreator, findPerson, indexPersons, personInText, personsFromRows, readCsv, searchPersons, transliterate, type PersonTable } from "../src/core/persons.js";
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
  it("writes the EI3 form and the death date", () => {
    const p = findPerson({ creatorType: "author", lastName: "Râzî", firstName: "Fahreddin er-" }, ix)!;
    expect(englishCreator({ creatorType: "author", lastName: "Râzî", firstName: "Fahrüddîn er-" }, p, t.dict).creator).toEqual({ creatorType: "author", lastName: "al-Rāzī", firstName: "Fakhr al-Dīn" });
    expect(personInText(p, false)).toBe("Fahreddin er-Râzî (ö. 606/1210)");
    expect(personInText(p, true)).toBe("Fakhr al-Dīn al-Rāzī (d. 606/1210)");
    expect(personInText(t.persons[5]!, false)).toBe("Mustafa Kara");
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

import { missingDeathDates } from "../src/core/persons.js";

describe("Vefat tarihi: metinde ilk geçiş", () => {
  const ix = indexPersons(table());
  it("finds the first mention without a date; parentheses and dated mentions do not count", () => {
    const text = "Bu görüş (Gazzâlî, el-Mustasfâ, 1/45) ile başlar. Fahreddin er-Râzî de buna katılır. Gazzâlî ise farklı düşünür; Gazzâlî'nin eseri. Buhârî (ö. 256/870) burada yok. Kâtib Çelebi (v. 1067/1657) de. Mustafa Kara bir çağdaştır.";
    expect(missingDeathDates(text, ix).map((d) => `${d.text} ${d.note}`)).toEqual(["Fahreddin er-Râzî (ö. 606/1210)", "Gazzâlî (ö. 505/1111)"]);
    expect(missingDeathDates("Gazzali bunu söyler.", ix, true).map((d) => `${d.text} ${d.note}`)).toEqual(["Gazzali (d. 505/1111)"]);
  });
});

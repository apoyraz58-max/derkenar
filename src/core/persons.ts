/**
 * Şahıslar: a table of persons with their DİA name, death date and EI3
 * transliteration (the user's own table, imported once as .xlsx / .csv).
 *
 * İSNAD asks for both (İngilizce kılavuz s. 23-24):
 *   - names in Turkish as the TDV İslâm Ansiklopedisi writes them, in English
 *     as the Encyclopaedia of Islam THREE transliterates them;
 *   - the death date of a person who died before the 20th century where the
 *     name first appears: "(ö. 505/1111)", "(d. 505/1111)".
 *
 * A record keeps its Turkish (DİA) names; when the document is written in
 * English the names of the persons in the table are written the EI3 way.
 * Given names are transliterated word by word with a dictionary learnt from
 * the table itself (DİA full name ↔ EI3 full name).
 */
import { unzipSync } from "fflate";
import type { Creator } from "./zotero.js";

export interface Person {
  /** DİA short name: "Gazzâlî", "Abbâdî, Ebû Âsım", "Abaza Mehmed Paşa". */
  dia: string;
  diaFull?: string;
  /** "505/1111" */
  death?: string;
  ei3: string;
  ei3Full?: string;
  /** Ottoman transliteration (EI3 bracket form) of Ottoman persons. */
  otto?: string;
  /** "Arap", "Fars / Hint alt kıtası", "Osmanlı / Türk", "Batılı" … */
  group: string;
  /** The table marks the EI3 form as partly guessed. */
  unsure?: boolean;
  link?: string;
}

export interface PersonTable {
  persons: Person[];
  /** DİA word → EI3 word, learnt from the table. */
  dict: Record<string, string>;
  /** When and from which file the table was imported. */
  source: string;
}

// ---------------------------------------------------------------- reading the file

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)));
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1]!)).join("");

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "A") n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** The first sheet of an .xlsx file as rows of text. */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, { filter: (f) => /^xl\/(sharedStrings\.xml|worksheets\/sheet1\.xml|workbook\.xml)$/.test(f.name) });
  const dec = new TextDecoder();
  const shared = files["xl/sharedStrings.xml"] ? [...dec.decode(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!)) : [];
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet) throw new Error("Excel dosyasında sayfa bulunamadı.");
  const rows: string[][] = [];
  for (const r of dec.decode(sheet).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1]!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "";
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? texts(body) : unxml(v ?? "");
      row[ref ? colIndex(ref) : row.length] = value;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}

/** CSV or tab-separated text as rows (quotes respected). */
export function readCsv(text: string): string[][] {
  const sep = (text.split("\n")[0] ?? "").includes("\t") ? "\t" : (text.split("\n")[0] ?? "").split(";").length > (text.split("\n")[0] ?? "").split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur || row.length) rows.push([...row, cur]);
  return rows;
}

const empty = (s: string | undefined) => !s || /^-+$/.test(s.trim());

/** Rows (header first) → persons; the columns are found by their headings. */
export function personsFromRows(rows: string[][]): Person[] {
  // "EI3" lower-cased the Turkish way is "eı3": headings are folded to plain letters.
  const head = (rows[0] ?? []).map((h) => h.replace(/[İI]/g, "i").replace(/ı/g, "i").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const col = (...want: RegExp[]) => head.findIndex((h) => want.every((w) => w.test(h)));
  const c = {
    dia: col(/kisa ad/, /dia/),
    diaFull: col(/tam ad/, /dia/),
    death: col(/vefat/),
    ei3: col(/ei3/, /kisa/),
    ei3Full: col(/ei3/, /tam/),
    otto: col(/osmanlica/),
    group: col(/^grup/),
    method: col(/yontem/),
    note: col(/kontrol/),
    link: col(/link|baglanti/),
  };
  if (c.dia < 0 || c.ei3 < 0) throw new Error('Tabloda "Kısa Ad (DİA)" ve "EI3 Transliterasyonu (Kısa Ad)" sütunları bulunamadı.');
  const out: Person[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const dia = get(c.dia);
    const ei3 = get(c.ei3);
    if (empty(dia) || empty(ei3)) continue;
    const p: Person = { dia, ei3, group: get(c.group) };
    if (!empty(get(c.diaFull))) p.diaFull = get(c.diaFull);
    if (!empty(get(c.ei3Full))) p.ei3Full = get(c.ei3Full);
    if (!empty(get(c.otto))) p.otto = get(c.otto);
    // "(ö. 505/1111)", "(ö. 42/662-63)", "(ö. 549/1154 [?])", "(ö. 690/1291’den sonra)": kept as the table writes it.
    const death = get(c.death).replace(/^\(\s*/, "").replace(/\s*\)$/, "").replace(/^(ö|v|d)\.\s*/i, "").trim();
    if (/\d/.test(death)) p.death = death.replace(/\s*\/\s*/g, "/");
    if (get(c.note) || /tahmin/i.test(get(c.method))) p.unsure = true;
    if (get(c.link)) p.link = get(c.link);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- the word dictionary

const AP = "[’'‘`ʼ]";
/** "Ebü’l-Hasan" → "Ebü", "l-Hasan" (as EI3 writes "Abū l-Ḥasan"). */
export function trWords(s: string): string[] {
  return s
    .replace(new RegExp(`(\\S+?)${AP}(l|[dtsşrznṭḍṣẓ])-`, "gu"), "$1 $2-")
    .replace(/,/g, " ,")
    .split(/\s+/)
    .filter(Boolean);
}
export const enWords = (s: string) => s.replace(/,/g, " ,").split(/\s+/).filter(Boolean);
/** DİA writes some names as one word that EI3 writes as two: "Şemsüddîn" ↔ "Shams al-Dīn", "Abdurrahmân" ↔ "ʿAbd al-Raḥmān". */
const COMPOUND = /^(abd[\p{L}‘’ʿ']+|[\p{L}‘’ʿ']+(?:[üueiı]d+(?:[îi]n|evle)|eddin|üddin)|[\p{L}‘’ʿ']+-billâh)$/iu;
/** The EI3 pair a compound became: "Shams al-Dīn", "ʿAbd al-Raḥmān", "ʿAbd ʿAwf", "al-Wāsiḳ Ballāh". */
function twoWords(t: string, a: string, b: string): boolean {
  if (/d+(?:[îi]n)$/i.test(t)) return /^(al|l)-D[īi]n$/.test(b);
  if (/devle$/i.test(t)) return /^(al|l)-Dawla$/.test(b);
  if (/billâh$/i.test(t)) return /^(Ballāh|bi-llāh)$/.test(b);
  if (/^abd/i.test(t)) return /^ʿAbdi?$/.test(a);
  return false;
}

export function align(tr: string[], en: string[]): [string, string][] | null {
  if (tr.length === en.length) return tr.map((t, i) => [t, en[i]!]);
  if (en.length <= tr.length) return null;
  const out: [string, string][] = [];
  let j = 0;
  for (const t of tr) {
    if (j >= en.length) return null;
    const extra = en.length - j - (tr.length - out.length);
    // A compound takes two words only when the second is the "al-…" half ("Shams al-Dīn", "ʿAbd al-Raḥmān").
    if (extra > 0 && COMPOUND.test(t) && twoWords(t, en[j]!, en[j + 1] ?? "")) {
      out.push([t, `${en[j]} ${en[j + 1]}`]);
      j += 2;
    } else out.push([t, en[j++]!]);
  }
  return j === en.length ? out : null;
}

/** Word pairs learnt from the Arabic and Persian names of the table (the most frequent EI3 form of each DİA word). */
export function buildDict(persons: readonly Person[]): Record<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const p of persons) {
    if (!/arap|fars/i.test(p.group)) continue;
    for (const [a, b] of [[p.dia, p.ei3], [p.diaFull, p.ei3Full]] as const) {
      if (!a || !b) continue;
      const pairs = align(trWords(a), enWords(b));
      if (!pairs) continue;
      for (const [x, y] of pairs) {
        const m = counts.get(x) ?? new Map<string, number>();
        m.set(y, (m.get(y) ?? 0) + 1);
        counts.set(x, m);
      }
    }
  }
  const dict: Record<string, string> = {};
  for (const [k, m] of counts) dict[k] = [...m].sort((a, b) => b[1] - a[1])[0]![0];
  return dict;
}

export async function tableFrom(file: { name: string; bytes: Uint8Array }): Promise<PersonTable> {
  const rows = /\.xlsx$/i.test(file.name) ? readXlsx(file.bytes) : readCsv(new TextDecoder().decode(file.bytes));
  const persons = personsFromRows(rows);
  if (!persons.length) throw new Error("Tabloda kişi bulunamadı.");
  return { persons, dict: buildDict(persons), source: `${file.name} · ${new Date().toISOString().slice(0, 10)}` };
}

// ---------------------------------------------------------------- finding a person

/** Letters only, no marks, no article: "el-Gazzâlî" → "gazzali", "İbn Teymiyye" → "ibn teymiyye". */
export function nameKey(s: string): string {
  return s
    .replace(/[ıİI]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ʿʾ’'‘`ʼ.]/g, "")
    .replace(/\b(el|er|ez|es|eş|es|en|et|ed|al|ad|an|ar|as|at|az)-/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface PersonIndex {
  table: PersonTable;
  /** nameKey of a DİA short name (and of its surname part) → persons. */
  byKey: Map<string, Person[]>;
}

export function indexPersons(table: PersonTable): PersonIndex {
  const byKey = new Map<string, Person[]>();
  const add = (k: string, p: Person) => {
    if (!k) return;
    const l = byKey.get(k) ?? [];
    if (!l.includes(p)) l.push(p);
    byKey.set(k, l);
  };
  for (const p of table.persons) {
    const [surname, given] = p.dia.split(/,\s*/);
    add(nameKey(p.dia.replace(/,/g, " ")), p);
    add(nameKey(surname!), p);
    if (given) add(nameKey(`${given} ${surname}`), p);
  }
  return { table, byKey };
}

const overlap = (a: string, b: string) => {
  const bw = new Set(nameKey(b).split(" "));
  return nameKey(a)
    .split(" ")
    .filter((w) => w.length > 1 && bw.has(w)).length;
};

/** The person of the table a record's creator is ("Gazzâlî" + "Ebû Hâmid Muhammed el-"); null when none or not sure which. */
export function findPerson(c: Creator, index: PersonIndex): Person | null {
  const last = c.lastName ?? c.name ?? "";
  const first = c.firstName ?? "";
  if (!last) return null;
  const whole = nameKey(`${first} ${last}`);
  const cands = new Set<Person>([...(index.byKey.get(nameKey(last)) ?? []), ...(first ? (index.byKey.get(whole) ?? []) : [])]);
  let list = [...cands];
  // A modern Turkish or Western name ("Mustafa Kara") is that person only if the given name agrees too.
  list = list.filter((p) => /arap|fars/i.test(p.group) || nameKey(p.dia.replace(/,/g, " ")) === whole || (first && overlap(first, `${p.dia} ${p.diaFull ?? ""}`) > 0 && nameKey(p.dia.split(",")[0]!) === nameKey(last)));
  if (list.length <= 1) return list[0] ?? null;
  // "Ahmed" + "Gazzâlî" is "Ahmed el-Gazzâlî", not Ebû Hâmid.
  const exact = list.filter((p) => nameKey(p.dia.split(/,\s*/).reverse().join(" ")) === whole);
  if (exact.length === 1) return exact[0]!;
  // Several (Gazzâlî and Ahmed Gazzâlî): the given name decides, then the plain short name ("Gazzâlî" rather than "Gazzâlî, Ahmed").
  if (first) {
    const scored = list.map((p) => ({ p, s: overlap(first, `${p.dia} ${p.diaFull ?? ""}`) })).sort((a, b) => b.s - a.s);
    if (scored[0]!.s > 0 && scored[0]!.s > scored[1]!.s) return scored[0]!.p;
  }
  const plain = list.filter((p) => nameKey(p.dia) === nameKey(last));
  return plain.length === 1 ? plain[0]! : null;
}

// ---------------------------------------------------------------- writing the EI3 form

/** Vowels blurred: "Sa‘deddin" and "Sa‘düddîn" are one word written two ways. */
const skeleton = (w: string) => nameKey(w).replace(/\s/g, "").replace(/[aeiıouü]+/g, "*");

/**
 * DİA given names → EI3, word by word. A word the dictionary lacks is looked
 * for in the person's own full name (spelt a little differently: "Sa‘deddin"
 * for "Sa‘düddîn") and then marked `guessed`; null when a word stays unknown.
 */
export function transliterateWords(given: string, dict: Record<string, string>, person?: Person): { text: string; guessed: boolean } | null {
  const own = person?.diaFull && person.ei3Full ? (align(trWords(person.diaFull), enWords(person.ei3Full)) ?? []) : [];
  const out: string[] = [];
  let guessed = false;
  for (const w of trWords(given)) {
    const hit = dict[w] ?? dict[w.charAt(0).toLocaleUpperCase("tr") + w.slice(1)];
    if (hit) out.push(hit);
    else if (/^(b\.|bt\.|,)$/.test(w)) out.push(w);
    else {
      const near = own.find(([t]) => skeleton(t) === skeleton(w));
      if (!near) return null;
      out.push(near[1]);
      guessed = true;
    }
  }
  return { text: out.join(" ").replace(/\s+,/g, ","), guessed };
}

export function transliterate(given: string, dict: Record<string, string>): string | null {
  const r = transliterateWords(given, dict);
  return r && !r.guessed ? r.text : null;
}

/**
 * The creator as EI3 writes the person: surname from the EI3 short name
 * ("al-Ghazālī"), given name transliterated (the Turkish article at its end
 * dropped, as English İSNAD keeps "al-" with the surname). `exact` is false
 * when part of it could not be transliterated (kept as written).
 */
export function englishCreator(c: Creator, p: Person, dict: Record<string, string>): { creator: Creator; exact: boolean } {
  let [ei3Last, ei3Given] = p.ei3.split(/,\s*/);
  // "Fakhr al-Dīn al-Rāzī" for a record "Râzî, Fahreddin er-": the surname is as many last words as the record's.
  if (!ei3Given && c.firstName && c.lastName) {
    const words = ei3Last!.split(" ");
    const k = Math.min(c.lastName.trim().split(/\s+/).length, words.length);
    ei3Last = words.slice(-k).join(" ");
  }
  if (c.name !== undefined || !c.firstName) {
    const name = ei3Given ? `${ei3Given} ${ei3Last}` : p.ei3;
    return { creator: c.name !== undefined ? { creatorType: c.creatorType, name } : { creatorType: c.creatorType, lastName: ei3Last!, ...(ei3Given ? { firstName: ei3Given } : {}) }, exact: !p.unsure };
  }
  const given = c.firstName.replace(/\s+(el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|al)-$/i, "").trim();
  const en = transliterateWords(given, dict, p);
  return { creator: { creatorType: c.creatorType, lastName: ei3Last!, firstName: en?.text ?? ei3Given ?? given }, exact: Boolean(en && !en.guessed) && !p.unsure };
}

/** "(ö. 505/1111)" in Turkish, "(d. 505/1111)" in English. */
export function deathNote(p: Person, english: boolean): string {
  return p.death ? `(${english ? "d." : "ö."} ${p.death})` : "";
}

/** The person as a writer names them in the text, with the death date. */
export function personInText(p: Person, english: boolean): string {
  // The name the encyclopedia files the person under ("Buhârî", "Fahreddin er-Râzî"); "Abbâdî, Ebû Âsım" read in order.
  const own = english ? p.ei3 : p.dia;
  const [last, given] = own.split(/,\s*/);
  const name = given && !/\bb\.\s/.test(given) ? `${given} ${last}` : last!;
  // İSNAD: the death date of those who died before the 20th century.
  return diedBefore1900(p) ? `${name} ${deathNote(p, english)}`.trim() : name;
}

/** Persons whose names begin with the words typed ("gazz", "ibn tey"). */
export function searchPersons(q: string, index: PersonIndex, limit = 12): Person[] {
  const words = nameKey(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  const hits: { p: Person; s: number }[] = [];
  for (const p of index.table.persons) {
    const hay = nameKey(`${p.dia} ${p.diaFull ?? ""} ${p.ei3}`).split(" ");
    if (!words.every((w) => hay.some((h) => h.startsWith(w)))) continue;
    const short = nameKey(p.dia);
    hits.push({ p, s: (short.startsWith(words.join(" ")) ? 0 : 1) + short.length / 100 });
  }
  return hits.sort((a, b) => a.s - b.s).slice(0, limit).map((x) => x.p);
}

// ---------------------------------------------------------------- the DİA form in Turkish

/** "gazali" and "gazzâlî": doubled letters and vowels blurred, for names written loosely. */
export function looseKey(s: string): string {
  return nameKey(s)
    .split(" ")
    .map((w) => w.replace(/(.)\1+/g, "$1").replace(/[aeiıouü]+/g, "*"))
    .join(" ");
}

const ARTICLE_TR = /^(el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|eż)-/i;

/** "Buhârî, Muhammed b. İsmâil" → surname "Buhârî", given "Muhammed b. İsmâil"; "Fahreddin er-Râzî" → "Râzî", "Fahreddin", article "er-". */
export function diaParts(p: Person): { surname: string; given: string; article: string } {
  const [a, b] = p.dia.split(/,\s*/);
  const article = (s: string) => new RegExp(`(?:^|\\s)${ARTICLE_TR.source.slice(1, -1)}-${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "iu").exec(p.diaFull ?? "")?.[1];
  if (b !== undefined) {
    const art = /arap|fars/i.test(p.group) ? article(a!) : undefined;
    return { surname: a!, given: b, article: art ? `${art.toLocaleLowerCase("tr")}-` : "" };
  }
  const words = a!.split(" ");
  const lastWord = words[words.length - 1]!;
  const m = ARTICLE_TR.exec(lastWord);
  if (m && words.length > 1) return { surname: lastWord.slice(m[0].length), given: words.slice(0, -1).join(" "), article: m[0].toLocaleLowerCase("tr") };
  // A single word ("Gazzâlî", "Mâtürîdî"): the article from the full name, the kunya and ism before the nasab.
  if (words.length === 1 && /arap|fars/i.test(p.group)) {
    const art = article(a!);
    const full = (p.diaFull ?? "").split(" ");
    const kunya = full.findIndex((w) => /^Eb[ûüu]/i.test(w));
    const until = full.findIndex((w, i) => i > Math.max(kunya, 0) && (w === "b." || ARTICLE_TR.test(w)));
    const given = full.slice(Math.max(kunya, 0), until > 0 ? until : 0).join(" ");
    return { surname: a!, given, article: art ? `${art.toLocaleLowerCase("tr")}-` : "" };
  }
  return { surname: a!, given: "", article: "" };
}

/** The person of a creator, also when the name is written loosely ("Gazali"); `loose` tells which. */
export function findPersonLoose(c: Creator, index: PersonIndex): { person: Person; loose: boolean } | null {
  const exact = findPerson(c, index);
  if (exact) return { person: exact, loose: false };
  const last = c.lastName ?? c.name ?? "";
  if (nameKey(last).length < 4) return null;
  const key = looseKey(last);
  const cands = index.table.persons.filter((p) => /arap|fars/i.test(p.group) && looseKey(diaParts(p).surname) === key);
  if (cands.length === 1) return { person: cands[0]!, loose: true };
  const first = c.firstName ?? "";
  if (!first) {
    const plain = cands.filter((p) => !p.dia.includes(",") && !p.dia.includes(" "));
    return plain.length === 1 ? { person: plain[0]!, loose: true } : null;
  }
  const scored = cands.map((p) => ({ p, s: overlap(first, `${p.dia} ${p.diaFull ?? ""}`) })).sort((a, b) => b.s - a.s);
  return scored[0] && scored[0].s > 0 && (scored.length === 1 || scored[0].s > scored[1]!.s) ? { person: scored[0].p, loose: true } : null;
}

/**
 * The creator written as DİA writes the person, İSNAD's way for Turkish
 * (article at the end of the given name: "Gazzâlî" + "Ebû Hâmid Muhammed el-").
 * Words of the given name are respelt from the DİA full name; words not in
 * it stay as written. An empty given name gets DİA's (kunya and ism).
 */
export function diaCreator(c: Creator, p: Person): Creator {
  const { surname, given, article } = diaParts(p);
  if (c.name !== undefined) return { creatorType: c.creatorType, name: c.name.trim().split(/\s+/).length > 1 && given ? `${given} ${article}${surname}`.replace(/- /, "-") : surname };
  const source = `${p.diaFull ?? ""} ${given}`.split(/\s+/).filter(Boolean);
  const byKey = new Map(source.map((w) => [looseKey(w.replace(ARTICLE_TR, "")), w.replace(ARTICLE_TR, "")]));
  const typed = (c.firstName ?? "").trim().replace(/\s+(el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|eż|al)-$/i, "");
  // "İbn" + "Haldun" becomes "İbn Haldûn" as surname: its words leave the given name.
  const inSurname = new Set(surname.split(/\s+/).map(looseKey));
  const words = typed ? typed.split(/\s+/).filter((w) => !inSurname.has(looseKey(w))).map((w) => (w === "b." ? w : (byKey.get(looseKey(w)) ?? w))) : given ? [given] : [];
  const firstName = `${words.join(" ")}${article ? ` ${article}` : ""}`.trim();
  return { creatorType: c.creatorType, lastName: surname, ...(firstName ? { firstName } : {}) };
}

const sameCreator = (a: Creator, b: Creator) => (a.name ?? "") === (b.name ?? "") && (a.lastName ?? "") === (b.lastName ?? "") && (a.firstName ?? "") === (b.firstName ?? "");

/** Only marks and case differ ("Gazzali" → "Gazzâlî"): safe to apply without asking. */
export function onlyMarks(a: Creator, b: Creator): boolean {
  const k = (c: Creator) => nameKey(`${c.firstName ?? ""} ${c.lastName ?? c.name ?? ""}`.replace(/\s+(el|er|ez|es|eş|en|et|ed|al)-$/i, ""));
  return !sameCreator(a, b) && k(a) === k(b);
}

export function diaSuggestion(c: Creator, index: PersonIndex): { person: Person; creator: Creator; loose: boolean } | null {
  const f = findPersonLoose(c, index);
  if (!f) return null;
  const creator = diaCreator(c, f.person);
  return sameCreator(c, creator) ? null : { person: f.person, creator, loose: f.loose };
}

// ---------------------------------------------------------------- death dates in the text

/** Letter by letter to plain lower case, same length (so a match points back into the text). */
function foldSame(s: string): string {
  let out = "";
  for (const c of s) {
    const b = c === "İ" || c === "ı" || c === "I" ? "i" : c.normalize("NFD")[0]!.toLowerCase();
    out += b.length === c.length ? b : c;
  }
  return out;
}

/** The Gregorian year of death: the number after "/" ("505/1111"), or the only one ("1930"). */
export function deathYear(p: Person): number | null {
  const m = /\/(\d{1,4})/.exec(p.death ?? "") ?? /^(\d{1,4})\b/.exec(p.death ?? "");
  return m ? Number(m[1]) : null;
}

function diedBefore1900(p: Person): boolean {
  const y = deathYear(p);
  return y !== null && y < 1900;
}

export interface DeathMention {
  person: Person;
  /** The name as it stands in the text at its first mention. */
  text: string;
  /** Index of the first mention in the text. */
  at: number;
  /** The whole word there, with a suffix ("Gazzâlî’nin"): the date goes after it. */
  word: string;
  /** "(ö. 505/1111)" or "(d. 505/1111)" */
  note: string;
}

/** The forms a person is mentioned by in running text: "Fahreddin er-Râzî", "Râzî"; "Gazzâlî"; "Kâtib Çelebi". */
function mentionForms(p: Person): string[] {
  const { surname, given, article } = diaParts(p);
  const forms = new Set<string>();
  if (!p.dia.includes(",")) forms.add(p.dia);
  if (given && article) forms.add(`${given} ${article}${surname}`);
  // A single nisba ("Gazzâlî", "Mâtürîdî") is distinctive enough alone; a bare "Ali" or "Hasan" is not.
  // Only for the person filed under it ("Gazzâlî", "Buhârî, Muhammed b. İsmâil"), not "Ahmed el-Gazzâlî".
  const filedUnder = !p.dia.split(",")[0]!.trim().includes(" ");
  if (filedUnder && /arap|fars/i.test(p.group) && !surname.includes(" ") && /[îi]$/.test(surname) && nameKey(surname).length >= 5) forms.add(surname);
  return [...forms].filter((f) => nameKey(f).length >= 5 && (f.includes(" ") || /[îi]$/.test(f)));
}

/**
 * Persons of the table mentioned in the text without their death date at the
 * first mention (İSNAD: those who died before the 20th century). A mention
 * inside parentheses (an in-text citation) does not count as the first.
 */
export function missingDeathDates(text: string, index: PersonIndex, english = false): DeathMention[] {
  const folded = foldSame(text);
  // Forms shared by several persons (two "Râzî"s) are left out: which one is meant cannot be told.
  const owners = new Map<string, Person[]>();
  for (const p of index.table.persons) {
    if (!diedBefore1900(p)) continue;
    for (const f of mentionForms(p)) {
      const k = foldSame(f);
      owners.set(k, [...(owners.get(k) ?? []), p]);
    }
  }
  const found = new Map<Person, DeathMention>();
  for (const [form, ps] of owners) {
    if (ps.length !== 1) continue;
    const p = ps[0]!;
    const re = new RegExp(`(?<![\\p{L}’'-])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu");
    for (const m of folded.matchAll(re)) {
      const before = folded.slice(Math.max(0, m.index - 200), m.index);
      if ((before.match(/\(/g) ?? []).length > (before.match(/\)/g) ?? []).length) continue;
      const prev = found.get(p);
      const suffix = /^[’'][\p{L}]+/u.exec(text.slice(m.index + m[0].length))?.[0] ?? "";
      if (!prev || m.index < prev.at) found.set(p, { person: p, text: text.slice(m.index, m.index + m[0].length), word: text.slice(m.index, m.index + m[0].length) + suffix, at: m.index, note: deathNote(p, english) });
      break;
    }
  }
  // Already dated at the first mention: "(ö. 505/1111)", "(v. 505)", "(d. 1111)" right after the name.
  return [...found.values()]
    .filter((d) => !/^[’'\p{L}]*\s*\((?:ö|v|d|öl|vf|ölm|died)\.?\s*[\d?]/iu.test(text.slice(d.at + d.text.length, d.at + d.text.length + 30)))
    .sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- names in a text, DİA → EI3

/** The person's name in running English text: "al-Ghazālī", "Fakhr al-Dīn al-Rāzī", "Abū ʿĀṣim al-ʿAbbādī". */
export function ei3Name(p: Person): string {
  const [last, given] = p.ei3.split(/,\s*/);
  return given && !/\bb\.\s/.test(given) ? `${given} ${last}` : last!;
}

/**
 * The names of the table's persons in a text written the DİA way, with their
 * EI3 form ("Gazzâlî’nin" → "al-Ghazālī"): for an English abstract or article.
 * Longest forms first, so "Fahreddin er-Râzî" is not read as "Râzî" alone.
 */
export function ei3Replacements(text: string, index: PersonIndex): { from: string; to: string }[] {
  const folded = foldSame(text);
  const owners = new Map<string, { form: string; p: Person }[]>();
  for (const p of index.table.persons) {
    if (/batılı/i.test(p.group) || p.ei3 === p.dia) continue;
    for (const f of mentionForms(p)) {
      const k = foldSame(f);
      owners.set(k, [...(owners.get(k) ?? []), { form: f, p }]);
    }
  }
  const out: { from: string; to: string }[] = [];
  const taken: [number, number][] = [];
  for (const [k, list] of [...owners].sort((a, b) => b[0].length - a[0].length)) {
    if (list.length !== 1) continue;
    const re = new RegExp(`(?<![\\p{L}’'-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[’'][\\p{L}]+)?(?![\\p{L}])`, "gu");
    for (const m of folded.matchAll(re)) {
      const end = m.index + m[0].length;
      if (taken.some(([a, b]) => m.index < b && end > a)) continue;
      taken.push([m.index, end]);
      const from = text.slice(m.index, end);
      // A Turkish suffix goes ("Gazzâlî’nin"); the English possessive stays ("Çelebi’s").
      const possessive = /[’'][sS]$/.exec(from)?.[0] ?? "";
      if (!out.some((o) => o.from === from)) out.push({ from, to: ei3Name(list[0]!.p) + possessive });
    }
  }
  return out;
}

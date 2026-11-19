/**
 * Şahıslar: a table of persons with their DİA name, death date and EI3
 * transliteration (the user's own table, imported once as .xlsx / .csv).
 *
 * İSNAD asks for names in Turkish as the TDV İslâm Ansiklopedisi writes
 * them, in English as the Encyclopaedia of Islam THREE transliterates them
 * (İngilizce kılavuz s. 23-24). Death dates are Vefeyât's work (a separate
 * add-in); here the date only helps tell namesakes apart.
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
    // "Muhammed Fuâd Abdülbâkī" is also found as "Abdülbâkī, Muhammed Fuâd".
    if (!given && surname!.includes(" ")) add(nameKey(diaParts(p).surname), p);
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
  // "DİB" + "Diyanet İşleri Başkanlığı", "TDV": a body, not a person of the table.
  if (/^\p{Lu}{2,}$/u.test(last.replace(/[.\s]/g, "")) || /\b(Başkanlığı|Bakanlığı|Kurumu|Vakfı|Üniversitesi|Enstitüsü|Derneği|Merkezi|Müdürlüğü|Komisyonu|Mahkemesi)\b/.test(`${first} ${last}`)) return null;
  const whole = nameKey(`${first} ${last}`);
  const cands = new Set<Person>([...(index.byKey.get(nameKey(last)) ?? []), ...(first ? (index.byKey.get(whole) ?? []) : [])]);
  let list = [...cands];
  // A modern Turkish or Western name ("Mustafa Kara") is that person only if the given name agrees too.
  list = list.filter((p) => /arap|fars/i.test(p.group) || nameKey(p.dia.replace(/,/g, " ")) === whole || (first && overlap(first, `${p.dia} ${p.diaFull ?? ""}`) > 0 && nameKey(p.dia.split(",")[0]!) === nameKey(last)));
  // A given name that shares no word with the person's ("Ahmed Hicâzî" es-Sekkā is not Mustafa Muhammed es-Sekkā).
  if (first.trim()) list = list.filter((p) => !(p.diaFull || p.dia.includes(",") || p.dia.includes(" ")) || overlap(first, `${p.dia} ${p.diaFull ?? ""}`) > 0);
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

/** The dictionary by letters alone ("Abdülhalim" finds "Abdülhalîm"), where that leads to one EI3 word only. */
const lettersMaps = new WeakMap<Record<string, string>, Map<string, string>>();
function byLetters(dict: Record<string, string>): Map<string, string> {
  let m = lettersMaps.get(dict);
  if (!m) {
    const all = new Map<string, Set<string>>();
    for (const [k, v] of Object.entries(dict)) {
      const key = nameKey(k);
      if (key.includes(" ")) continue;
      all.set(key, (all.get(key) ?? new Set()).add(v));
    }
    m = new Map([...all].filter(([, v]) => v.size === 1).map(([k, v]) => [k, [...v][0]!]));
    lettersMaps.set(dict, m);
  }
  return m;
}

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
    const hit = dict[w] ?? dict[w.charAt(0).toLocaleUpperCase("tr") + w.slice(1)] ?? byLetters(dict).get(nameKey(w));
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
  // EI3 writes Turks, Westerners and other modern persons in their own spelling ("Topaloğlu, Bekir", not "Bakr"):
  // only the table's own form is taken (it drops the Ottoman circumflex: "Taşköprizade"), nothing is transliterated.
  if (!/arap|fars/i.test(p.group)) {
    const sameGiven = !c.firstName || !ei3Given || nameKey(c.firstName) === nameKey(diaParts(p).given || ei3Given);
    const creator: Creator =
      c.name !== undefined
        ? { creatorType: c.creatorType, name: ei3Given ? `${ei3Given} ${ei3Last}` : p.ei3 }
        : { creatorType: c.creatorType, lastName: ei3Last!, ...(c.firstName ? { firstName: sameGiven && ei3Given ? ei3Given : c.firstName } : ei3Given ? { firstName: ei3Given } : {}) };
    return { creator, exact: !p.unsure };
  }
  // "Fakhr al-Dīn al-Rāzī" for a record "Râzî, Fahreddin er-": the surname is as many last words as the record's —
  // a compound counting twice ("Abdülbâkī" is "ʿAbd al-Bāqī").
  if (!ei3Given && c.firstName && c.lastName) {
    const words = ei3Last!.split(" ");
    const typed = c.lastName.trim().split(/\s+/);
    const n = typed.length + typed.filter((w) => COMPOUND.test(w)).length;
    const k = Math.min(n, words.length);
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
  // "Muhammed Fuâd Abdülbâkī", "Abdülhalîm Mahmûd": a modern Arabic name, surname the last word (as İSNAD writes "Abdülbâkī, “ecl”").
  if (words.length > 1 && /arap|fars/i.test(p.group) && !/^(İbn|Ibn|Ebû|Ebü|Ümmü)/.test(words[words.length - 2]!) && !/(^|\s)(b\.|bin|bt\.)(\s|$)/.test(a!)) return { surname: lastWord, given: words.slice(0, -1).join(" "), article: "" };
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

/** Arabic and Persian persons by the loose key of their DİA surname, built once per table. */
const looseIndexes = new WeakMap<PersonIndex, Map<string, Person[]>>();
function looseIndex(index: PersonIndex): Map<string, Person[]> {
  let m = looseIndexes.get(index);
  if (!m) {
    m = new Map();
    for (const p of index.table.persons) {
      if (!/arap|fars/i.test(p.group)) continue;
      const k = looseKey(diaParts(p).surname);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    looseIndexes.set(index, m);
  }
  return m;
}

/** The person of a creator, also when the name is written loosely ("Gazali"); `loose` tells which. */
export function findPersonLoose(c: Creator, index: PersonIndex): { person: Person; loose: boolean } | null {
  const exact = findPerson(c, index);
  if (exact) return { person: exact, loose: false };
  const last = c.lastName ?? c.name ?? "";
  if (nameKey(last).length < 4) return null;
  const first = c.firstName ?? "";
  // A loosely written surname ("Gazali") with a given name must share a word of it ("Koca, Fatih" is not Keccî).
  const cands = (looseIndex(index).get(looseKey(last)) ?? []).filter((p) => !first.trim() || overlap(first, `${p.dia} ${p.diaFull ?? ""}`) > 0);
  if (cands.length === 1) return { person: cands[0]!, loose: true };
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
  const typedArticle = /\s*((?:el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|eż|al)-)$/i.exec((c.firstName ?? "").trim())?.[1] ?? "";
  const typed = (c.firstName ?? "").trim().replace(/\s*(el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|eż|al)-$/i, "");
  // "İbn" + "Haldun" becomes "İbn Haldûn" as surname: its words leave the given name.
  const inSurname = new Set(surname.split(/\s+/).map(looseKey));
  const typedWords = typed ? typed.split(/\s+/) : [];
  // (Only a given name that is nothing but a piece of the surname — "İbn" for "İbn Haldûn" — is dropped.)
  const onlySurname = typedWords.length > 0 && typedWords.every((w) => inSurname.has(looseKey(w)));
  // A word keeps the article it was typed with ("ez-Zâhid"); only its spelling follows DİA.
  const respell = (w: string) => {
    if (w === "b.") return w;
    const art = ARTICLE_TR.exec(w)?.[0] ?? "";
    const dia = byKey.get(looseKey(w.slice(art.length)));
    // Never towards a plainer spelling ("İshâk" stays though DİA's short name writes "İshak").
    const marks = (x: string) => (x.normalize("NFD").match(/[\u0300-\u036f]|[ʿʾ‘’]/g) ?? []).length;
    return dia && marks(dia) >= marks(w.slice(art.length)) ? `${art}${dia}` : w;
  };
  const words = typedWords.length ? (onlySurname ? [] : typedWords.map(respell)) : given ? [given] : [];
  const art = article || typedArticle;
  const firstName = `${words.join(" ")}${art ? ` ${art}` : ""}`.trim();
  return { creatorType: c.creatorType, lastName: surname, ...(firstName ? { firstName } : {}) };
}

const sameCreator = (a: Creator, b: Creator) => (a.name ?? "") === (b.name ?? "") && (a.lastName ?? "") === (b.lastName ?? "") && (a.firstName ?? "") === (b.firstName ?? "");

/** Only marks and case differ ("Gazzali" → "Gazzâlî"): safe to apply without asking. */
export function onlyMarks(a: Creator, b: Creator): boolean {
  const text = (c: Creator) => `${c.firstName ?? ""} ${c.lastName ?? c.name ?? ""}`.replace(/\s+(el|er|ez|es|eş|en|et|ed|al)-$/i, "").trim();
  if (sameCreator(a, b) || nameKey(text(a)) !== nameKey(text(b))) return false;
  // Only ever richer: "Abdulbaki" → "Abdülbâkī", "Gazzali" → "Gazzâlî"; never a Turkish letter or a mark taken away ("Lütfi" → "Lutfi", "İshâk" → "İshak").
  const wa = text(a).split(/\s+/);
  const wb = text(b).split(/\s+/).filter((w) => !/^(el|er|ez|es|eş|en|et|ed|al)-$/i.test(w));
  const special = (w: string) => (w.normalize("NFC").match(/[üÜöÖçÇşŞğĞıİâÂîÎûÛāĀīĪūŪḥḤṣṢṭṬẓẒḳḲḫġżḍʿʾ]/g) ?? []).sort().join("");
  const sub = (x: string, y: string) => {
    const pool = [...y];
    return [...x].every((ch) => {
      const i = pool.indexOf(ch);
      if (i < 0) return false;
      pool.splice(i, 1);
      return true;
    });
  };
  return wa.every((w) => {
    const twin = wb.find((v) => nameKey(v) === nameKey(w));
    return !twin || sub(special(w), special(twin));
  });
}

export function diaSuggestion(c: Creator, index: PersonIndex): { person: Person; creator: Creator; loose: boolean } | null {
  const f = findPersonLoose(c, index);
  if (!f) return null;
  const creator = diaCreator(c, f.person);
  return sameCreator(c, creator) ? null : { person: f.person, creator, loose: f.loose };
}

// ---------------------------------------------------------------- names in running text

/** Letter by letter to plain lower case, same length (so a match points back into the text). */
function foldSame(s: string): string {
  let out = "";
  for (const c of s) {
    const b = c === "İ" || c === "ı" || c === "I" ? "i" : c.normalize("NFD")[0]!.toLowerCase();
    out += b.length === c.length ? b : c;
  }
  return out;
}

/** The words of a folded text (also without a suffix: "gazzali’nin" → "gazzali"), to skip names that cannot be in it. */
function wordsOf(folded: string): Set<string> {
  const set = new Set<string>();
  for (const w of folded.split(/[\s,.;:()[\]"“”!?«»…/]+/)) {
    if (!w) continue;
    set.add(w);
    const bare = w.split(/[’']/)[0]!;
    if (bare) set.add(bare);
  }
  return set;
}

const mayBeIn = (form: string, words: Set<string>) => form.split(" ").every((w) => words.has(w));

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
  const words = wordsOf(folded);
  for (const [k, list] of [...owners].sort((a, b) => b[0].length - a[0].length)) {
    if (list.length !== 1 || !mayBeIn(k, words)) continue;
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

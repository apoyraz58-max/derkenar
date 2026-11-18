/**
 * Elle yazılmış dipnotlar → atıf: a thesis written without a citation
 * program has its references typed into the footnotes. Each footnote is read:
 *
 *   Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi (İstanbul: Dergâh Yayınları, 2005), 45.   full reference
 *   Kara, Tasavvuf ve Tarikatlar, 47.                                                       short form
 *   a.g.e., 48.  /  a.e.  /  Ibid., 12.                                                       the previous work
 *   Bk. Kara, Tasavvuf, 50; Kutlu, “İlk Mürciî Metinler”, 320.                                several, with a prefix
 *
 * A footnote whose every part is a reference becomes a citation; one with
 * the author's own words stays as it is. Works already in the library are
 * used, the others are added.
 */
import { parseReference } from "./freetext.js";
import { foldText } from "./isnadstyle.js";
import { existingCopy } from "./library.js";
import { type Item, titleOf } from "./zotero.js";

export interface HandRef {
  readonly item: Item;
  /** Not in the library before: to be added. */
  readonly isNew: boolean;
  readonly volume?: string;
  readonly locator?: string;
  readonly prefix?: string;
  /** Kur’ân: sûre number and âyet ("el-Bakara 2/14"). */
  readonly sure?: string;
  readonly ayet?: string;
  /** Dictionary: madde ("“delîl”"). */
  readonly madde?: string;
  /** CSL locator label: "sub verbo" for a law's madde (md. 35/4). */
  readonly label?: string;
  /** What the reading could not tell ("diğer yazarlar (vd.)"), for a new record. */
  readonly unsure?: string[];
  /** Kitâb-ı Mukaddes: book abbreviation, bab and cümle ("Yar.1:12"). */
  readonly kitap?: string;
  readonly bab?: string;
  readonly cumle?: string;
}

/** Where in the work: what `cut` reads at the end of a reference. */
interface Place {
  label?: string;
  kitap?: string;
  bab?: string;
  cumle?: string;
  volume?: string;
  locator?: string;
  sure?: string;
  ayet?: string;
  madde?: string;
}

export interface HandNote {
  readonly index: number;
  readonly text: string;
  /** The citation the note becomes; null: kept as it is (`reason` says why). */
  readonly refs: HandRef[] | null;
  readonly reason?: string;
}

const PREFIX = /^((?:[\p{L}\s,]{0,60}?\s)?(?:bk\.|bkz\.|bakınız|krş\.|karş\.)|ayrıca\s+bk\.|ayrıca\s+bkz\.|ayrıca\s+bakınız|bk\.|bkz\.|bakınız|krş\.|karş\.|karşılaştırınız|mesela|örnek\s+olarak|see\s+also|see|cf\.|vgl\.)\s*/iu;
const SAME = /^(op\.?\s*cit\.?|a\.?\s?g\.?\s?e\.?|a\.?\s?g\.?\s?m\.?|a\.?\s?e\.?|age\.?|agm\.?|aynı\s+eser|aynı\s+yer|a\.?\s?y\.?|ibid\.?|ibidem|ay\.?\s?e\.?|aynı\s+makale)(?=[\s,.]|$)\s*,?\s*/i;
/** The cited place at the end: "45", "1/45", "45-47", "45 vd.", "vr. 12b", "II/45". */
const LOCATOR = /,\s*((?:[IVXLC]+|\d+)\s*\/\s*)?((?:\d+[ab]?(?:\s*[-–]\s*\d+[ab]?)?(?:\s*vd\.)?|vr\.\s*\d+[ab]?(?:\s*[-–]\s*\d+[ab]?)?|s\.\s*\d+(?:\s*[-–]\s*\d+)?)(?:\s*\([^()]{1,40}\))?)\.?\s*$/i;
/** "…, el-Bakara 2/14." (a Kur’ân meâli or tefsir). */
const SURE = /(?:^|,\s*)((?:[a-zâîû]{1,3}-)?\p{Lu}[\p{L}’'ʿ-]*(?:\s\p{L}[\p{L}’'ʿ-]*)?)\s+(\d{1,3})\s*\/\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)\.?\s*$/u;
/** "…, “delîl”" (a dictionary's madde, before the place). */
const MADDE = /,\s*[“"]([^”"]{1,60})[”"]\s*$/;

/** Splits a note into its references ("…; …"), not inside quotes or parentheses. */
export function splitNote(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth) depth--;
    else if (ch === "“") quote = true;
    else if (ch === "”") quote = false;
    if (ch === ";" && !depth && !quote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** "…, c. I, s. 245" · "…, C. 2, s. 45" · "…, I, 245" (eski usul cilt ve sayfa). */
const VOL_PAGE = /,\s*(?:c\.|cilt)?\s*([IVXLC]+|(?<=(?:c\.|cilt)\s*)\d+)\s*,\s*(?:s\.|ss\.)?\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*vd\.)?)\.?\s*$/i;

/** The cited place at the end of a footnote reference ("…, 45." · "…, 1/45." · "…, c. II, s. 12."), and the rest. */
export function cut(s0: string): { body: string } & Place {
  const r = cutPlace(s0);
  // A dictionary's madde before the page: "(… 1996), “delîl”, 1/793".
  const md = /\)\s*,\s*[“"][^“”"]*[”"]\s*$/.test(r.body) ? MADDE.exec(r.body) : null;
  return md ? { ...r, body: r.body.slice(0, md.index).trim(), madde: md[1]! } : r;
}

function cutPlace(s: string): { body: string } & Place {
  // Kitâb-ı Mukaddes: "…, Yar.1:12.", "…, Elç.12:10-12."
  const bible = /(?:^|,\s*)((?:[1-3]\s?)?\p{Lu}\p{Ll}{1,4}\.)\s*(\d{1,3}):(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)\.?\s*$/u.exec(s);
  if (bible) return { body: s.slice(0, bible.index).trim(), kitap: bible[1]!.replace(/\s/g, ""), bab: bible[2]!, cumle: bible[3]!.replace(/\s*[-–]\s*/g, "-") };
  // A law's article: "…, md. 35/4.", "…, md. 53/2-b."
  const md = /,\s*(?:md|madde|art)\.\s*([\d][\w/-]*)\.?\s*$/i.exec(s);
  if (md) return { body: s.slice(0, md.index).trim(), locator: md[1]!, label: "sub verbo" };
  const sm = SURE.exec(s);
  if (sm && (sm.index > 0 || /^(?:[a-zâîû]{1,3}-)/.test(sm[1]!))) return { body: s.slice(0, sm.index).trim(), sure: sm[2]!, ayet: sm[3]!.replace(/\s*[-–]\s*/g, "-") };
  const vp = VOL_PAGE.exec(s);
  if (vp) return { body: s.slice(0, vp.index).trim(), volume: vp[1]!, locator: vp[2]!.replace(/\s*[-–]\s*/g, "-") };
  const m = LOCATOR.exec(s);
  // "…, İstanbul, 2005." ends with the year, not a page.
  // (Only a year of print, 1500-2099, after something that is not a quoted title: "“isnat”, 1029" is a page.)
  if (!m || (!m[1] && /^(1[5-9]|20)\d{2}$/.test(m[2]!) && !/[”"]\s*$/.test(s.slice(0, m.index)) && !/\b(1[0-9]|20)\d{2}\b/.test(s.slice(0, m.index)))) return { body: s.replace(/\.\s*$/, "") };
  const volume = m[1]?.replace(/\s*\/\s*$/, "").trim();
  const locator = m[2]!.replace(/^s\.\s*/i, "").replace(/(\d[ab]?)\s*[-–]\s*(?=\d)/g, "$1-").trim();
  return { body: s.slice(0, m.index).trim(), ...(volume ? { volume } : {}), locator };
}

const fold = (s: string) => foldText(s).replace(/^(el|al|er|es|en|et|ed|ez|eş|es)\s/, "");

function surnames(item: Item): string[] {
  return item.creators.filter((c) => c.creatorType === "author" || c.creatorType === "editor").map((c) => fold(c.lastName ?? c.name ?? "")).filter(Boolean);
}

/** "Kara, Tasavvuf ve Tarikatlar" → the work among `pool` by that author whose title (or short title) begins so. */
/** "Topaloğlu vd.", "Topaloğlu - Çelebi", "Roper (ed.)" → the first author's surname. */
const authorKey = (s: string) => fold(s.replace(/\s*\((?:ed|eds|haz|ç(?:ev)?)\.?\)\s*$/i, "").replace(/\s+(?:vd\.?|et al\.?)$/i, "").split(/\s+[-–]\s+|\s+ve\s+|\s*&\s*/)[0]!);
/** By that author — or, for an unsigned newspaper piece, in that paper ("Milliyet, “Yetki Kanunları”"). */
const byAuthor = (it: Item, author: string) =>
  !author || surnames(it).some((s) => s === author || s.endsWith(` ${author}`) || author.endsWith(` ${s}`)) || (!it.creators.length && fold(it.fields.publicationTitle ?? "") === author);

/** The initials of a title's words ("Geschichte des arabischen Schrifttums" → "gas"), for "Sezgin, GAS". */
const initials = (t: string) => fold(t).split(" ").filter((w) => w.length > 3).map((w) => w[0]).join("");

/** "Kara, Tasavvuf ve Tarikatlar" → the work among `pool` by that author whose title (or short title) begins so. */
/** The first comma outside quotes and parentheses (the one after the author). */
function firstComma(s: string): number {
  let depth = 0;
  let quote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(") depth++;
    else if (ch === ")" && depth) depth--;
    else if (ch === "“") quote = true;
    else if (ch === "”") quote = false;
    else if (ch === "," && !depth && !quote) return i;
  }
  return -1;
}

function findShort(body: string, pool: readonly Item[]): Item | null {
  const comma = firstComma(body);
  const author = comma > 0 ? authorKey(body.slice(0, comma)) : "";
  // A manuscript's short form keeps its shelf mark: "Keşşî, et-Temhîd (Şehit Ali Paşa, 1153)".
  const raw = (comma > 0 ? body.slice(comma + 1) : body).replace(/\s*\([^()]*\)\s*$/, "").trim();
  const title = fold(raw.replace(/[“”"«»]/g, ""));
  if (!title) return null;
  const mine = [...new Set(pool)].filter((it) => byAuthor(it, author));
  const pick = (hits: Item[]) => (hits.length === 1 ? hits[0]! : (hits.find((h) => fold(h.fields.shortTitle ?? "") === title) ?? null));
  const starts = mine.filter((it) => {
    // A court decision is named by its number: "Yargıtay, K. 2019/1204".
    if (it.fields.docketNumber && title === fold(`K. ${it.fields.docketNumber}`)) return true;
    const t = fold(titleOf(it));
    const st = fold(it.fields.shortTitle ?? "");
    return t.startsWith(title) || (st && (st === title || title.startsWith(st)));
  });
  if (starts.length) return pick(starts);
  if (!author) return null;
  // A short title taken from inside the title ("Suça Teşebbüsten Vazgeçme"), or its initials ("GAS").
  const inside = mine.filter((it) => fold(titleOf(it)).includes(title) || (/^[\p{Lu}]{2,6}$/u.test(raw) && initials(titleOf(it)) === raw.toLowerCase()));
  if (inside.length === 1) return inside[0]!;
  // A short title of the author's own making ("MAK, Cinsel İstismar Olaylarının Önlenmesi … Raporu"): the author's only work, if most of its words are in the title.
  if (mine.length === 1) {
    const words = title.split(" ").filter((w) => w.length > 3);
    const full = new Set(fold(titleOf(mine[0]!)).split(" "));
    if (words.length >= 2 && words.filter((w) => full.has(w)).length / words.length >= 0.6) return mine[0]!;
  }
  return null;
}

/** "Tehânevî, “delîl”, 1/797": a madde of the dictionary by that author met before. */
function findDictionary(body: string, pool: readonly Item[]): { item: Item; madde: string } | null {
  const m = /^([^,“"]{2,60}),\s*[“"]([^”"]{1,60})[”"]$/.exec(body.trim());
  if (!m) return null;
  const author = authorKey(m[1]!);
  const works = [...new Set(pool)].filter((it) => byAuthor(it, author) && !/Article|journal|magazine|newspaper/i.test(it.itemType));
  return works.length === 1 ? { item: works[0]!, madde: m[2]! } : null;
}

const place = (p: Place): Place => ({ ...(p.kitap ? { kitap: p.kitap, bab: p.bab, cumle: p.cumle } : {}), ...(p.label ? { label: p.label } : {}), ...(p.volume ? { volume: p.volume } : {}), ...(p.locator ? { locator: p.locator } : {}), ...(p.sure ? { sure: p.sure, ayet: p.ayet } : {}), ...(p.madde ? { madde: p.madde } : {}) });

/** A Kur’ân meâl or tefsir: "el-Bakara 2/14" alone in a later note points to it. */
const isQuran = (it: Item) => /kur[’'ʾ]?[aâ]n|meal|meâl|tefsir/i.test(titleOf(it));

/** Reads the notes in order; `library` is searched for each work before a new record is made. */
export function readHandNotes(notes: readonly string[], library: readonly Item[]): HandNote[] {
  const created: Item[] = [];
  const unsureOf = new Map<Item, string[]>();
  const seen: Item[] = [];
  let previous: HandRef | null = null;
  const out: HandNote[] = [];
  for (const [index, raw] of notes.entries()) {
    const text = raw.replace(/[\u0002​]/g, "").replace(/\s+/g, " ").trim();
    if (!text) {
      out.push({ index, text, refs: null, reason: "boş" });
      continue;
    }
    const refs: HandRef[] = [];
    let reason = "";
    for (const part of splitNote(text)) {
      const pm = PREFIX.exec(part);
      const prefix = pm ? pm[1]!.replace(/^\p{Lu}/u, (c) => c.toLocaleLowerCase("tr")).replace(/\s+/g, " ") : undefined;
      const rest = pm ? part.slice(pm[0].length) : part;
      // "Kara, a.g.e., s. 47": the work of that author cited last.
      const named = /^((?:İbn\s|el-|eş-|er-)?\p{Lu}[\p{L}'’-]*(?:\s\p{Lu}[\p{L}'’-]*){0,2}),\s*(?=a\.?\s?g\.?\s?[em]\.?|age\.?|agm\.?|aynı\s+eser|op\.?\s*cit\.?)/iu.exec(rest);
      if (named) {
        const who = fold(named[1]!);
        const work = [...seen].reverse().find((it) => surnames(it).some((sn) => sn === who || sn.endsWith(` ${who}`) || who.endsWith(` ${sn}`)));
        if (!work) {
          reason = `${named[1]} için daha önce anılmış bir eser yok`;
          break;
        }
        const tail = rest.slice(named[0].length).replace(/^(a\.?\s?g\.?\s?[em]\.?|age\.?|agm\.?|aynı\s+eser|op\.?\s*cit\.?)\s*,?\s*/i, "");
        const c: Place = tail ? cut(`, ${tail}`) : {};
        const ref: HandRef = { item: work, isNew: created.includes(work), ...place(c), ...(prefix ? { prefix } : {}) };
        refs.push(ref);
        seen.splice(seen.indexOf(work), 1);
        seen.push(work);
        continue;
      }
      const sm = SAME.exec(rest);
      if (sm) {
        if (!previous) {
          reason = "a.g.e. önceki bir eseri göstermiyor";
          break;
        }
        const tail = rest.slice(sm[0].length).trim();
        const c: Place = tail ? cut(`, ${tail.replace(/^,\s*/, "")}`) : {};
        const sameLoc = /^a\.?\s?y\.?|aynı\s+yer/i.test(sm[1]!);
        const ref: HandRef = { item: previous.item, isNew: previous.isNew, ...(c.volume ? { volume: c.volume } : previous.volume && !c.locator ? { volume: previous.volume } : {}), ...(c.locator ? { locator: c.locator } : sameLoc && previous.locator ? { locator: previous.locator } : {}), ...(prefix ? { prefix } : {}) };
        refs.push(ref);
        continue;
      }
      // "a.mlf., Başka Eser, 12." / "Id., …": another work of the author cited just before.
      const am = /^(?:a\.\s?mlf\.|aynı\s+müellif|id\.|idem)\s*,?\s*/i.exec(rest);
      const prevAuthor = refs[refs.length - 1]?.item.creators[0] ?? previous?.item.creators[0];
      const restOwn = am && prevAuthor ? `${[prevAuthor.firstName, prevAuthor.lastName ?? prevAuthor.name].filter(Boolean).join(" ").replace(/- /, "-")}, ${rest.slice(am[0].length)}` : rest;
      const c = cut(restOwn);
      const { body } = c;
      let where = place(c);
      // "Yar.1:12." alone: the Bible cited before.
      if (!body && c.kitap) {
        const k = [...seen].reverse().find((it) => /mukaddes|kutsal kitap|bible|incil|tevrat/i.test(titleOf(it)));
        if (!k) {
          reason = "Kitâb-ı Mukaddes atfı önceki bir esere bağlanamadı";
          break;
        }
        refs.push({ item: k, isNew: created.includes(k), ...where, ...(prefix ? { prefix } : {}) });
        continue;
      }
      // "el-Bakara 2/14." alone: the Kur’ân meâl cited before.
      if (!body && c.sure) {
        const q = [...seen].reverse().find(isQuran);
        if (!q) {
          reason = "âyet atfı önceki bir meâli göstermiyor";
          break;
        }
        refs.push({ item: q, isNew: created.includes(q), ...where, ...(prefix ? { prefix } : {}) });
        continue;
      }
      // A short form of a work already met (in these notes, then in the library).
      const shortable = body.length < 160 && !/\(.*:\s*.*\d{3,4}.*\)/.test(body);
      let item: Item | null = shortable ? (findShort(body, seen) ?? findShort(body, library)) : null;
      if (!item && shortable) {
        const d = findDictionary(body, seen) ?? findDictionary(body, library);
        if (d) {
          item = d.item;
          where = { ...where, madde: d.madde };
        }
      }
      let isNew = false;
      if (!item) {
        const r = parseReference(`${body}.`);
        const f = r?.item.fields;
        // A full reference has an author or an imprint; a sentence of the author's own has neither.
        const looksFull = r && (f?.title || f?.docketNumber) && (r.item.creators.length > 0 || f.date || f.archive || f.accessDate) && (f.date || f.dateDecided || f.publisher || f.publicationTitle || f.encyclopediaTitle || f.dictionaryTitle || f.university || f.place || f.archive || f.accessDate || f.url);
        if (!r || !looksFull) {
          reason = "künye olarak okunamadı";
          break;
        }
        const old = existingCopy(r.item, [...library, ...created]);
        if (old) item = old;
        else {
          item = { ...r.item, source: "dipnot" };
          created.push(item);
          isNew = true;
          if (r.unsure.length) unsureOf.set(item, r.unsure);
        }
      }
      // Kept in the order last cited ("Kara, a.g.e." is Kara's work cited last).
      if (seen.includes(item)) seen.splice(seen.indexOf(item), 1);
      seen.push(item);
      const ref: HandRef = { item, isNew: isNew || created.includes(item), ...where, ...(prefix ? { prefix } : {}), ...(isNew && unsureOf.get(item)?.includes("diğer yazarlar (vd.)") ? { unsure: ["diğer yazarlar (vd.)"] } : {}) };
      refs.push(ref);
    }
    if (reason || !refs.length) {
      out.push({ index, text, refs: null, reason: reason || "künye yok" });
      continue;
    }
    previous = refs[refs.length - 1]!;
    out.push({ index, text, refs });
  }
  return out;
}

// ---------------------------------------------------------------- in-text citations typed by hand

export interface HandInText {
  /** The text as it stands in the document, parentheses included: "(Kara, 2005: 45; Uludağ 1995, s. 12)". */
  readonly match: string;
  readonly refs: HandRef[];
}

const YEAR = /\b((?:1[5-9]|20)\d{2})([a-z])?\b/;

function yearsOfItem(it: Item): string[] {
  return (it.fields.date ?? "").match(/\b\d{4}\b/g) ?? [];
}

/**
 * "(Kara, 2005: 45)", "(Kara 2005, s. 45-47)", "(Kara ve Uludağ, 2010)", "(Kara vd., 2012; Ocak, 1996)":
 * each is matched to a work of the library by its first author's surname and the year
 * (2005a, 2005b: in the library's order). A parenthesis with any part that is not such a reference is left.
 */
export function readInText(text: string, library: readonly Item[]): HandInText[] {
  const out: HandInText[] = [];
  const done = new Set<string>();
  for (const m of text.matchAll(/\(([^()]{4,240})\)/g)) {
    const inner = m[1]!;
    if (!YEAR.test(inner) || done.has(m[0])) continue;
    const refs: HandRef[] = [];
    let ok = true;
    for (const part of splitNote(inner)) {
      const pm = /^(?:bk\.|bkz\.|krş\.|ayrıca\s+bk\.|see|cf\.)\s*/i.exec(part);
      const prefix = pm ? pm[0].trim().toLocaleLowerCase("tr") : undefined;
      const p = pm ? part.slice(pm[0].length) : part;
      const r = /^(.+?)[,\s]+(?:\d{3,4}\s*\/\s*)?((?:1[5-9]|20)\d{2})([a-z])?(?:\s*,\s*(?:cilt|c\.|vol\.)\s*(\d+|[IVXLC]+))?(?:\s*[,:]\s*(?:s\.|ss\.|p\.|pp\.)?\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*vd\.)?))?\s*$/iu.exec(p.trim());
      if (!r) {
        ok = false;
        break;
      }
      const who = fold(r[1]!.replace(/\s+(vd\.|et al\.?|ve\s+.+|and\s+.+|&\s*.+)$/i, "").trim());
      if (!who || who.split(" ").length > 3) {
        ok = false;
        break;
      }
      const year = r[2]!;
      const hits = library.filter((it) => !it.deleted && yearsOfItem(it).includes(year) && surnames(it)[0] !== undefined && (surnames(it)[0] === who || surnames(it)[0]!.endsWith(` ${who}`)));
      const pick = r[3] ? hits[r[3].toLowerCase().charCodeAt(0) - 97] : hits.length === 1 ? hits[0] : undefined;
      if (!pick) {
        ok = false;
        break;
      }
      refs.push({ item: pick, isNew: false, ...(r[4] ? { volume: r[4] } : {}), ...(r[5] ? { locator: r[5].replace(/\s*[-–]\s*/g, "-") } : {}), ...(prefix ? { prefix } : {}) });
    }
    if (ok && refs.length) {
      out.push({ match: m[0], refs });
      done.add(m[0]);
    }
  }
  return out;
}

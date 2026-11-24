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
import { expandSameAuthor, parseReference, splitReferences } from "./freetext.js";
import { citeMode } from "./isnadmodes.js";
import { foldText } from "./isnadstyle.js";
import { copyFinder, existingCopy } from "./library.js";
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
  /** How the note wrote it: a full reference, a short one, or a.g.e. / Ibid. (İSNAD: full first, short after, never a.g.e.). */
  readonly form?: "full" | "short" | "age";
  /** A short reference as typed ("Kara, Tasavvuf"), to see whether a work is shortened one way throughout. */
  readonly written?: string;
  /** What the reading could not tell ("diğer yazarlar (vd.)"), for a new record. */
  readonly unsure?: string[];
  /** Hadith: kitâb ("Îmân"), bâb or hadith number in `bab`, hadith no in parentheses ("Müslim, “Îmân”, 12 (no. 34)"). */
  readonly kitab?: string;
  readonly hadisNo?: string;
  /** Kitâb-ı Mukaddes: book abbreviation, bab and cümle ("Yar.1:12"). */
  readonly kitap?: string;
  readonly bab?: string;
  readonly cumle?: string;
}

/** Where in the work: what `cut` reads at the end of a reference. */
interface Place {
  label?: string;
  kitab?: string;
  hadisNo?: string;
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

/** The ordinary first words of a reference's prefix, which may be lower-cased. */
const PREFIX_WORD = /^(Bu|Şu|Daha|Geniş|Ayrıca|Bk|Bkz|Bakınız|Krş|Karş|Karşılaştırınız|Mesela|Meselâ|Örnek|Örneğin|Nakleden|Naklen|Aktaran|Akt|Zikreden|Alıntılayan|Benzer|Konu|Konuyla|Bilgi|Detaylı|Ayrıntılı|Farklı|Aksi|İlgili|Bunun|Bunlar|See|Cf|Vgl|Quoted|Cited)(?=\.?(?:\s|$|:))/u;
const PREFIX = /^((?:[\p{L}\s,;]{0,80}?\s)?(?:bk\.|bkz\.|bakınız|krş\.|karş\.)|(?:nakleden|naklen|aktaran|akt\.|zikreden|alıntılayan|quoted\s+in|cited\s+in)\s*:?|ayrıca\s+bk\.|ayrıca\s+bkz\.|ayrıca\s+bakınız|bk\.|bkz\.|bakınız|krş\.|karş\.|karşılaştırınız|mesela|örnek\s+olarak|see\s+also|see|cf\.|vgl\.)\s*/iu;
const SAME = /^(op\.?\s*cit\.?|a\.?\s?g\.?\s?e\.?|a\.?\s?g\.?\s?m\.?|a\.?\s?e\.?|age\.?|agm\.?|aynı\s+eser|aynı\s+yer|a\.?\s?y\.?|ibid\.?|ibidem|ay\.?\s?e\.?|aynı\s+makale)(?=[\s,.]|$)\s*,?\s*/i;
/** The cited place at the end: "45", "1/45", "45-47", "45 vd.", "vr. 12b", "II/45". */
/** Works "a.g.m." (adı geçen makale) may point to. */
const ARTICLE = /^(journalArticle|magazineArticle|newspaperArticle|bookSection|encyclopediaArticle|conferencePaper|dictionaryEntry)$/;
const LOCATOR = /,\s*((?:[IVXLC]+|\d+)\s*\/\s*)?((?:\d{1,3}[ab]?(?:\s*[-–]\s*\d+[ab]?)?(?:,\s*\d{1,3}[ab]?(?:\s*[-–]\s*\d+[ab]?)?)+|\d+[ab]?(?:\s*[-–]\s*\d+[ab]?)?(?:\s*vd\.)?|vr\.\s*\d+[ab]?(?:\s*[-–]\s*\d+[ab]?)?|(?:s|ss|sh|p|pp)\.\s*\d+(?:\s*[-–]\s*\d+)?)(?:\s*\([^()]{1,40}\))?)\.?\s*$/i;
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

/**
 * "Kara bu görüşü eleştirir; bk. Kara, Tasavvuf, 53.": the author's own words before "; bk." belong to the
 * reference that follows, as its prefix; they are not a reference of their own.
 */
function withComments(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /^(?:ayrıca\s+)?(?:bk\.|bkz\.|bakınız|krş\.|karş\.|cf\.|see)\s/iu.test(p) && !/\d/.test(prev) && /^[\p{L}\s,’'-]{3,80}$/u.test(prev) && prev.split(" ").length >= 2 && !/,/.test(prev)) out[out.length - 1] = `${prev}; ${p}`;
    else out.push(p);
  }
  return out;
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
  const locator = m[2]!.replace(/^(?:s|ss|sh|p|pp)\.\s*/i, "").replace(/(\d[ab]?)\s*[-–]\s*(?=\d)/g, "$1-").trim();
  return { body: s.slice(0, m.index).trim(), ...(volume ? { volume } : {}), locator };
}

const fold = (s: string) => foldText(s).replace(/^(el|al|er|es|en|et|ed|ez|eş|es)\s/, "");

/** Folded surnames and titles, worked out once per record (a thesis cites the same works hundreds of times). */
const folded = new WeakMap<Item, { surnames: string[]; title: string; short: string; work: string; container: string; given: string[] }>();
/** Whoever a short form names first: the author, or the artist, inventor, director … of a work that has no author. */
const MAIN_CREATOR = new Set(["author", "editor", "inventor", "artist", "director", "interviewee", "programmer", "cartographer", "composer", "performer", "podcaster", "presenter"]);

function keysOf(item: Item) {
  let k = folded.get(item);
  if (!k) {
    k = {
      surnames: item.creators.filter((c) => MAIN_CREATOR.has(c.creatorType)).map((c) => fold(c.lastName ?? c.name ?? "")).filter(Boolean),
      title: fold(titleOf(item)),
      short: fold(item.fields.shortTitle ?? ""),
      // The work a text edition in an article publishes ("Risâle fi hakkı ebeveyi’r-Resûl"): its later notes use that name.
      work: fold(item.itemType === "journalArticle" ? (item.fields.seriesText ?? "") : ""),
      container: fold(item.fields.publicationTitle ?? ""),
      // A classical name ("Ebü’l-Hüseyn Müslim b. el-Haccâc"): later notes may use any of its names ("Müslim").
      given: item.creators
        .filter((c) => c.creatorType === "author" && / b\. | bin | ibn /i.test(` ${c.firstName ?? ""} `))
        .flatMap((c) => fold(c.firstName ?? "").split(" "))
        .filter((w) => w.length > 3),
    };
    folded.set(item, k);
  }
  return k;
}

function surnames(item: Item): string[] {
  return keysOf(item).surnames;
}

/** "Kara, Tasavvuf ve Tarikatlar" → the work among `pool` by that author whose title (or short title) begins so. */
/** "Topaloğlu vd.", "Topaloğlu - Çelebi", "Roper (ed.)" → the first author's surname. */
const authorKey = (s: string) => fold(s.replace(/\s*\((?:ed|eds|haz|ç(?:ev)?)\.?\)\s*$/i, "").replace(/\s+(?:vd\.?|et al\.?)$/i, "").split(/\s+[-–]\s+|\s+ve\s+|\s*&\s*/)[0]!);
/** By that author — or, for an unsigned newspaper piece, in that paper ("Milliyet, “Yetki Kanunları”"). */
const byAuthor = (it: Item, author: string) =>
  !author || surnames(it).some((s) => s === author || s.endsWith(` ${author}`) || author.endsWith(` ${s}`)) || (!it.creators.length && keysOf(it).container === author) || (!author.includes(" ") && keysOf(it).given.includes(author));

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

function findShort(body0: string, pool: readonly Item[]): Item | null {
  // An art work or a document keeps its number: "Halı Seccade, No. 420", "Şefik Direnoğlu, Alparslan Portresi, No. 000511".
  const numbered = /,\s*No\.?(?:\s*\S.*)?$/u.exec(body0);
  const body = numbered ? body0.slice(0, numbered.index) : body0;
  if (numbered && !body.includes(",")) {
    const t = fold(body.replace(/[“”"«»]/g, ""));
    const hits = [...new Set(pool)].filter((it) => keysOf(it).title === t);
    if (hits.length === 1) return hits[0]!;
  }
  const comma = firstComma(body);
  // "Nakleden: Kara, …": words of the writer's own before the name are not part of it (nothing may be lost).
  if (comma > 0 && (/[:;]/.test(body.slice(0, comma)) || body.slice(0, comma).trim().split(/\s+/).length > 5)) return null;
  const author = comma > 0 ? authorKey(body.slice(0, comma)) : "";
  // A manuscript's short form keeps its shelf mark: "Keşşî, et-Temhîd (Şehit Ali Paşa, 1153)".
  const raw = (comma > 0 ? body.slice(comma + 1) : body).replace(/\s*\([^()]*\)\s*$/, "").trim();
  const title = fold(raw.replace(/[“”"«»]/g, ""));
  if (!title) return null;
  const mine = [...new Set(pool)].filter((it) => byAuthor(it, author));
  const pick = (hits: Item[]) => (hits.length === 1 ? hits[0]! : (hits.find((h) => keysOf(h).short === title) ?? null));
  const starts = mine.filter((it) => {
    // A court decision is named by its number: "Yargıtay, K. 2019/1204".
    if (it.fields.docketNumber && title === fold(`K. ${it.fields.docketNumber}`)) return true;
    // Software is named with its version: "EndNote X9".
    if (it.fields.versionNumber && title === fold(`${titleOf(it)} ${it.fields.versionNumber}`)) return true;
    const { title: t, short: st } = keysOf(it);
    const { work } = keysOf(it);
    return t.startsWith(title) || (st && (st === title || title.startsWith(st))) || (work && work === title);
  });
  if (starts.length) return pick(starts);
  if (!author) return null;
  // A short title taken from inside the title ("Suça Teşebbüsten Vazgeçme"), or its initials ("GAS").
  const inside = mine.filter((it) => keysOf(it).title.includes(title) || (/^[\p{Lu}]{2,6}$/u.test(raw) && initials(titleOf(it)) === raw.toLowerCase()));
  if (inside.length === 1) return inside[0]!;
  // A short title of the author's own making ("MAK, Cinsel İstismar Olaylarının Önlenmesi … Raporu"): the author's only work, if most of its words are in the title.
  if (mine.length === 1) {
    const words = title.split(" ").filter((w) => w.length > 3);
    const full = new Set(keysOf(mine[0]!).title.split(" "));
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

const place = (p: Place): Place => ({ ...(p.kitab ? { kitab: p.kitab, ...(p.bab ? { bab: p.bab } : {}), ...(p.hadisNo ? { hadisNo: p.hadisNo } : {}) } : {}), ...(p.kitap ? { kitap: p.kitap, bab: p.bab, cumle: p.cumle } : {}), ...(p.label ? { label: p.label } : {}), ...(p.volume ? { volume: p.volume } : {}), ...(p.locator ? { locator: p.locator } : {}), ...(p.sure ? { sure: p.sure, ayet: p.ayet } : {}), ...(p.madde ? { madde: p.madde } : {}) });

/**
 * A hadith collection's place: the quoted kitâb and the bâb (or hadith) number,
 * "(no. 34)" as the hadith no ("Müslim, “Îmân”, 12 (no. 34)").
 */
function hadithPlace(item: Item, p: Place): Place {
  if (!/^hadis-(bab|no)$/.test(citeMode(item)) || !p.madde) return p;
  const loc = p.locator ?? "";
  const no = /\((?:no\.?|hadis\s+no\.?)\s*([\d-]+)\)/i.exec(loc);
  const bab = loc.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return { kitab: p.madde, ...(bab ? { bab } : {}), ...(no ? { hadisNo: no[1]! } : {}), ...(p.volume && !bab ? { volume: p.volume } : {}) };
}

/** "Buhârî, Îmân, 2" (the old way, kitâb without quotes): the hadith collection by that author met before. */
function findHadith(body: string, pool: readonly Item[]): { item: Item; kitab: string } | null {
  const m = /^([^,“"]{2,40}),\s*([^,“”"()]{2,40})$/.exec(body.trim());
  if (!m) return null;
  const author = authorKey(m[1]!);
  const works = [...new Set(pool)].filter((it) => byAuthor(it, author) && /^hadis-(bab|no)$/.test(citeMode(it)));
  return works.length === 1 ? { item: works[0]!, kitab: m[2]!.trim() } : null;
}

/** A Kur’ân meâl or tefsir: "el-Bakara 2/14" alone in a later note points to it. */
const isQuran = (it: Item) => /kur[’'ʾ]?[aâ]n|meal|meâl|tefsir/i.test(titleOf(it));

/** Reason given to a short reference whose work was neither cited in full before nor found in the library. */
export const SHORT_UNKNOWN = "kısa künye; eser daha önce tam künyeyle anılmamış, kütüphanede de yok";

/** Reads the notes in order; `library` is searched for each work before a new record is made. */
export function readHandNotes(notes: readonly string[], library: readonly Item[]): HandNote[] {
  const created: Item[] = [];
  const copies = copyFinder(library);
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
    for (const part of withComments(splitNote(text))) {
      const pm = PREFIX.exec(part);
      // "Bk." → "bk." (the note's first letter is set when it is written); a name ("Kara bu görüşü …") keeps its capital.
      const prefix = pm ? pm[1]!.replace(/^\p{Lu}(?=\p{Ll}*\.?(?:\s|$|:))/u, (c, i, all: string) => (PREFIX_WORD.test(all) ? c.toLocaleLowerCase("tr") : c)).replace(/\s+/g, " ") : undefined;
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
        const ref: HandRef = { item: work, isNew: created.includes(work), form: "age", ...hadithPlace(work, place(c)), ...(prefix ? { prefix } : {}) };
        refs.push(ref);
        seen.splice(seen.indexOf(work), 1);
        seen.push(work);
        continue;
      }
      const sm = SAME.exec(rest);
      if (sm) {
        // The work cited just before: earlier in this note ("Kara, Tasavvuf, 12; a.g.e., 13"), else in the note before.
        let prev = refs[refs.length - 1] ?? previous;
        // "a.g.m." names an article: after a book, the article cited last ("Kutlu, …; Kara, …; a.g.m., 5" is Kutlu's).
        if (prev && /^(a\.?\s?g\.?\s?m\.?|agm\.?|aynı\s+makale)$/i.test(sm[1]!.trim()) && !ARTICLE.test(prev.item.itemType)) {
          const art = [...seen].reverse().find((it) => ARTICLE.test(it.itemType));
          if (art) prev = { item: art, isNew: created.includes(art), form: "age" };
        }
        if (!prev) {
          reason = "a.g.e. önceki bir eseri göstermiyor";
          break;
        }
        const tail = rest.slice(sm[0].length).trim();
        const cc = tail ? cut(`, ${tail.replace(/^,\s*/, "")}`) : { body: "" };
        // "a.g.e., “Menâḳıb”, 24": what is left is a quoted kitâb or madde.
        const q = /^,?\s*[“"]([^”"]+)[”"]$/.exec(cc.body.trim());
        const c: Place = q ? { ...cc, madde: q[1]! } : cc;
        const sameLoc = /^a\.?\s?y\.?|aynı\s+yer/i.test(sm[1]!);
        // "a.g.e., “Îmân”, 3": the kitâb or madde after it counts as for any short form.
        const own = hadithPlace(prev.item, place(c));
        const where: Place = Object.keys(own).length
          ? own
          : { ...(prev.volume ? { volume: prev.volume } : {}), ...(sameLoc && prev.locator ? { locator: prev.locator } : {}) };
        refs.push({ item: prev.item, isNew: prev.isNew, form: "age", ...where, ...(prefix ? { prefix } : {}) });
        if (seen.includes(prev.item)) seen.splice(seen.indexOf(prev.item), 1);
        seen.push(prev.item);
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
        refs.push({ item: k, isNew: created.includes(k), form: "short", ...where, ...(prefix ? { prefix } : {}) });
        continue;
      }
      // "el-Bakara 2/14." alone: the Kur’ân meâl cited before.
      if (!body && c.sure) {
        const q = [...seen].reverse().find(isQuran);
        if (!q) {
          reason = "âyet atfı önceki bir meâli göstermiyor";
          break;
        }
        refs.push({ item: q, isNew: created.includes(q), form: "short", ...where, ...(prefix ? { prefix } : {}) });
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
      if (!item && shortable) {
        const hd = findHadith(body, seen) ?? findHadith(body, library);
        if (hd) {
          item = hd.item;
          where = { ...where, madde: hd.kitab };
        }
      }
      let isNew = false;
      const full = !item;
      if (!item) {
        const r = parseReference(`${body}.`);
        const f = r?.item.fields;
        // A full reference has an author or an imprint; a sentence of the author's own has neither.
        const looksFull = r && (f?.title || f?.docketNumber) && (r.item.creators.length > 0 || f.date || f.issueDate || f.archive || f.accessDate) && (f.date || f.dateDecided || f.issueDate || f.patentNumber || f.company || f.publisher || f.publicationTitle || f.encyclopediaTitle || f.dictionaryTitle || f.university || f.place || f.archive || f.accessDate || f.url);
        if (!r || !looksFull) {
          // "Buhârî, “Îmân”, 2" with no full reference anywhere before: a short form of a work not known yet.
          reason = shortable && /^[^,()“”"]{2,50},\s*[^()]{2,90}$/.test(body) && (c.locator || c.madde || c.volume) ? SHORT_UNKNOWN : "künye olarak okunamadı";
          break;
        }
        const old = copies.find(r.item);
        if (old) item = old;
        else {
          item = { ...r.item, source: "dipnot" };
          created.push(item);
          copies.add(item);
          isNew = true;
          if (r.unsure.length) unsureOf.set(item, r.unsure);
        }
      }
      // "Müslim, “Ticârât”, 45" for a record read as "Haccâc, Ebü’l-Hüseyn Müslim b. el-": the
      // well-known name goes to the surname box, the whole name to the given name (İSNAD's Zotero rule).
      if (!full && created.includes(item)) {
        const comma = firstComma(body);
        const used = comma > 0 ? authorKey(body.slice(0, comma)) : "";
        const c = item.creators.find((x) => x.creatorType === "author" && x.firstName && x.lastName);
        if (used && c && !surnames(item).includes(used)) {
          const word = c.firstName!.split(/\s+/).find((w) => fold(w) === used);
          if (word) {
            const whole = `${c.firstName!.trim()}${/-$/.test(c.firstName!.trim()) ? "" : " "}${c.lastName}`;
            c.lastName = word;
            c.firstName = whole;
            folded.delete(item);
          }
        }
      }
      where = hadithPlace(item, where);
      // Kept in the order last cited ("Kara, a.g.e." is Kara's work cited last).
      if (seen.includes(item)) seen.splice(seen.indexOf(item), 1);
      seen.push(item);
      const ref: HandRef = { item, isNew: isNew || created.includes(item), form: full ? "full" : "short", ...(full ? {} : { written: body.replace(/\s*\([^()]*\)\s*$/, "").trim() }), ...where, ...(prefix ? { prefix } : {}), ...(isNew && unsureOf.get(item)?.includes("diğer yazarlar (vd.)") ? { unsure: ["diğer yazarlar (vd.)"] } : {}) };
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

// ---------------------------------------------------------------- footnotes against the bibliography

export interface BibCheck {
  /** Works cited in the notes that the bibliography does not list (with the notes citing them, 1-based). */
  readonly missing: { item: Item; notes: number[] }[];
  /** Bibliography lines no note cites. */
  readonly uncited: string[];
  /** Bibliography lines that could not be read as references. */
  readonly unreadLines: string[];
  readonly citedCount: number;
  readonly listedCount: number;
  /** İSNAD: works first cited with a short reference (or a.g.e.), by note number. */
  readonly shortFirst: { item: Item; note: number }[];
  /** Works given in full again after their first citation (İSNAD writes the short form). */
  readonly fullAgain: { item: Item; notes: number[] }[];
  /** Notes with a.g.e. / a.e. / Ibid. */
  readonly age: number[];
  /** Works shortened in more than one way ("Kara, Tasavvuf" · "Kara, Tasavvuf ve Tarikatlar"). */
  readonly shortVariants: { item: Item; forms: string[] }[];
}

/** Full first, short after, no a.g.e. (İSNAD's rule for footnotes), as the notes were typed. */
export function firstMentions(read: readonly HandNote[]): Pick<BibCheck, "shortFirst" | "fullAgain" | "age" | "shortVariants"> {
  const forms = new Map<Item, Map<string, string>>();
  for (const n of read)
    for (const r of n.refs ?? []) {
      if (r.form !== "short" || !r.written) continue;
      const m = forms.get(r.item) ?? new Map<string, string>();
      // Letters only: "Kara, Tasavvuf" and "Kara, Tasavvuf." are one form.
      m.set(foldText(r.written.replace(/[“”"]/g, "")), r.written);
      forms.set(r.item, m);
    }
  const shortVariants = [...forms].filter(([, m]) => m.size > 1).map(([item, m]) => ({ item, forms: [...m.values()] }));
  const met = new Set<Item>();
  const shortFirst: { item: Item; note: number }[] = [];
  const again = new Map<Item, number[]>();
  const age = new Set<number>();
  for (const n of read)
    for (const r of n.refs ?? []) {
      if (r.form === "age") age.add(n.index + 1);
      if (!met.has(r.item)) {
        met.add(r.item);
        if (r.form && r.form !== "full") shortFirst.push({ item: r.item, note: n.index + 1 });
      } else if (r.form === "full") again.set(r.item, [...(again.get(r.item) ?? []), n.index + 1]);
    }
  return { shortFirst, fullAgain: [...again].map(([item, notes]) => ({ item, notes })), age: [...age], shortVariants };
}

const sameWork = (a: Item, b: Item): boolean => {
  if (existingCopy(a, [b])) return true;
  const sa = surnames(a)[0] ?? fold(a.fields.publicationTitle ?? "");
  const sb = surnames(b)[0] ?? fold(b.fields.publicationTitle ?? "");
  if (sa && sb && sa !== sb) return false;
  const ta = fold(titleOf(a));
  const tb = fold(titleOf(b));
  return ta.length > 3 && tb.length > 3 && (ta.startsWith(tb) || tb.startsWith(ta));
};

/**
 * A thesis written by hand: are the works its footnotes cite all in its
 * bibliography, and does the bibliography list only works cited? (What a
 * jury checks first.) `notes` are the footnotes in order; `bibliography` the
 * reference lines of the bibliography (headings already left out).
 */
export function checkBibliography(notes: readonly string[], bibliography: readonly string[], library: readonly Item[] = [], alsoCited: readonly Item[] = []): BibCheck {
  const listed: { line: string; item: Item }[] = [];
  const unreadLines: string[] = [];
  for (const line of bibliography) {
    const r = parseReference(line);
    if (r?.item.fields.title || r?.item.fields.docketNumber) listed.push({ line, item: r!.item });
    else unreadLines.push(line);
  }
  // Short references ("Buhârî, “Îmân”, 2") may have their full form only in the bibliography.
  const read = readHandNotes(notes, [...library, ...listed.map((l) => l.item)]);
  const cited = new Map<Item, number[]>(alsoCited.map((it) => [it, []]));
  for (const n of read) for (const r of n.refs ?? []) cited.set(r.item, [...(cited.get(r.item) ?? []), n.index + 1]);
  const missing = [...cited].filter(([it]) => !listed.some((l) => sameWork(it, l.item))).map(([item, ns]) => ({ item, notes: [...new Set(ns)] }));
  const uncited = listed.filter((l) => ![...cited.keys()].some((it) => sameWork(it, l.item))).map((l) => l.line);
  // A work already cited with Derkenar may have had its full reference there.
  const fm = firstMentions(read);
  const viaDerkenar = new Set(alsoCited);
  return { missing, uncited, unreadLines, citedCount: cited.size, listedCount: listed.length, ...fm, shortFirst: fm.shortFirst.filter((x) => !viaDerkenar.has(x.item)) };
}

/** "(Kara, 2005: 45; Ocak 1996)" and "Kara (2005)": the author and year of each in-text citation typed by hand. */
export function inTextAuthorYears(text: string): { who: string; year: string; at: string }[] {
  const out: { who: string; year: string; at: string }[] = [];
  for (const m of text.matchAll(/\(([^()]{4,240})\)/g)) {
    for (const part of splitNote(m[1]!)) {
      const p = part.replace(/^(?:bk\.|bkz\.|krş\.|ayrıca\s+bk\.|see|cf\.)\s*/i, "").trim();
      const r = /^(.+?)[,\s]+(?:\d{3,4}\s*\/\s*)?((?:1[5-9]|20)\d{2}[a-z]?)\b/u.exec(p);
      if (!r) continue;
      const who = fold(r[1]!.replace(/\s+(vd\.|et al\.?|ve\s+.+|and\s+.+|&\s*.+)$/i, "").trim());
      if (who && who.split(" ").length <= 3 && !/^(o|ö|v|d)$/.test(who)) out.push({ who, year: r[2]!, at: part.trim() });
    }
  }
  // Narrative: "Kara (2005) der ki", "Kara (2005: 45)".
  for (const m of text.matchAll(/(\p{Lu}[\p{L}’'-]{2,})(?:\s+(?:vd\.|ve\s+\p{Lu}[\p{L}’'-]+))?\s+\(((?:1[5-9]|20)\d{2}[a-z]?)(?:[,:][^()]*)?\)/gu)) out.push({ who: fold(m[1]!.replace(/[’'][\p{L}]+$/u, "")), year: m[2]!, at: m[0] });
  return out;
}

/** In-text citations typed by hand against the bibliography, by first author's surname and year. */
export function checkInTextBibliography(text: string, bibliography: readonly string[]): { missing: string[]; uncited: string[]; unreadLines: string[]; citedCount: number; listedCount: number } {
  const cites = inTextAuthorYears(text);
  const listed: { line: string; who: string; years: string[] }[] = [];
  const unreadLines: string[] = [];
  for (const line of bibliography) {
    const r = parseReference(line);
    const who = r ? (surnames(r.item)[0] ?? fold(r.item.fields.publicationTitle ?? "")) : "";
    if (r && who) listed.push({ line, who, years: (r.item.fields.date ?? "").match(/\d{4}/g) ?? [] });
    else unreadLines.push(line);
  }
  const matches = (c: { who: string; year: string }, l: { who: string; years: string[] }) => (l.who === c.who || l.who.endsWith(` ${c.who}`)) && l.years.includes(c.year.slice(0, 4));
  const missing = [...new Set(cites.filter((c) => !listed.some((l) => matches(c, l))).map((c) => c.at))];
  const uncited = listed.filter((l) => !cites.some((c) => matches(c, l))).map((l) => l.line);
  return { missing, uncited, unreadLines, citedCount: new Set(cites.map((c) => `${c.who} ${c.year}`)).size, listedCount: listed.length };
}

// ---------------------------------------------------------------- a bibliography typed by hand

/** A heading inside the list ("KAYNAKÇA", "Makaleler", "B. Arşiv Belgeleri"): no year, no punctuation of a reference. */
const isHeading = (l: string) => l.length < 60 && !/\d{3,4}|[“”"]|:\s/.test(l);

/** Which lines are headings: short, no year, no reference punctuation, and after a finished line or another heading. */
function headingFlags(raw: readonly string[]): boolean[] {
  const flags: boolean[] = [];
  raw.forEach((l, i) => {
    const prev = raw[i - 1];
    flags.push(Boolean(l) && isHeading(l) && !/[.)]$/.test(l) && (i === 0 || !prev || /[.)\]]$/.test(prev) || flags[i - 1] === true));
  });
  return flags;
}

/** The reference lines of a bibliography typed by hand: headings left out, "———." given its author. */
export function bibliographyLines(text: string): string[] {
  // Headings out first (a heading has no full stop and would be joined to the next reference).
  const raw = text.split("\n").map((l) => l.trim());
  const flags = headingFlags(raw);
  return expandSameAuthor(splitReferences(raw.filter((l, i) => l && !flags[i]).join("\n")));
}

/** The section headings of a typed bibliography ("Kitaplar", "Makaleler", "B. Arşiv Belgeleri"), its own title left out. */
export function sectionHeadings(text: string): string[] {
  const raw = text.split("\n").map((l) => l.trim());
  const flags = headingFlags(raw);
  return raw.filter((l, i) => flags[i] && !/^(kaynakça|kaynaklar|bibliyografya|bibliography|references|works cited)$/i.test(l));
}

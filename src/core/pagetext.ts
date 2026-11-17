/**
 * Kapaktan / künye sayfasından kayıt: the text of a title page, a copyright
 * (künye) page, a thesis cover or an article's first page — read from a PDF
 * or by OCR from a photo — turned into a record.
 *
 * In order of trust:
 *   1. a DOI or ISBN on the page: the catalogues are asked (the pane does that);
 *   2. the page's own "Atıf / Cite as:" line, read as a reference;
 *   3. the layout: the largest line is the title, a name next to it the
 *      author, "… Yayınları" the publisher, a known city the place,
 *      "8. Baskı: Ekim 2005" the edition and year.
 * What is only a guess is listed in `unsure`.
 */
import { parseReference } from "./freetext.js";
import { foldText, placeIn } from "./isnadstyle.js";
import { type Creator, type Item, emptyItem } from "./zotero.js";

/** One line of the page; `size` is its letter height (any unit; 0 when unknown). */
export interface PageLine {
  readonly text: string;
  readonly size: number;
}

export interface PageReading {
  readonly dois: string[];
  readonly isbns: string[];
  /** The page's own "Atıf:" reference, when it has one. */
  readonly citeAs: string | null;
  /** The record read from the page (from `citeAs` or the layout); null when nothing sensible was found. */
  readonly item: Item | null;
  readonly unsure: string[];
  readonly how: "atif" | "sayfa" | null;
}

// ---------------------------------------------------------------- identifiers

const DOI_RE = /\b10\.\d{4,9}\/[^\s"<>]+/g;

/** DOIs printed on the page ("DOI: 10.…", "https://doi.org/10.…"). */
export function doisIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/­/g, "").matchAll(DOI_RE)) {
    const d = m[0].replace(/[.,;:)\]]+$/, "");
    if (!out.some((o) => o.toLowerCase() === d.toLowerCase())) out.push(d);
  }
  return out;
}

function isbn13Ok(d: string): boolean {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d[i]) * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(d[12]);
}

function isbn10Ok(d: string): boolean {
  let s = 0;
  for (let i = 0; i < 10; i++) s += (d[i] === "X" || d[i] === "x" ? 10 : Number(d[i])) * (10 - i);
  return s % 11 === 0;
}

/** OCR reads 0 as O, 1 as l or I, 5 as S inside numbers. */
function digitsOf(s: string): string {
  return s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/[^\dXx]/g, "");
}

/** ISBNs on the page whose check digit is right; the printed book's before the e-book's. */
export function isbnsIn(text: string): string[] {
  const found: { isbn: string; e: boolean }[] = [];
  const add = (raw: string, e: boolean) => {
    const d = digitsOf(raw).toUpperCase();
    const ok = (d.length === 13 && /^97[89]\d{10}$/.test(d) && isbn13Ok(d)) || (d.length === 10 && /^\d{9}[\dX]$/.test(d) && isbn10Ok(d));
    if (ok && !found.some((f) => f.isbn === d)) found.push({ isbn: d, e });
  };
  // Labelled: "ISBN 978-975-995-111-9", "ISBN: 975 995 111 7", "e-ISBN …", "ISBN (PDF) …".
  for (const m of text.matchAll(/(e-?\s*)?ISBN(?:-1[03])?\s*(\([^)]{0,20}\))?\s*[:：]?\s*([0-9OolIS|B][0-9OolIS|B\s-]{8,20}[0-9Xx])/gi)) add(m[3]!, Boolean(m[1]) || /pdf|e-?book|online|elektronik|dijital/i.test(m[2] ?? ""));
  // Bare 978/979 numbers (a barcode's caption).
  for (const m of text.matchAll(/\b97[89][\s-]?(?:\d[\s-]?){9}\d\b/g)) add(m[0], false);
  return found.sort((a, b) => Number(a.e) - Number(b.e)).map((f) => f.isbn);
}

// ---------------------------------------------------------------- "Atıf:" lines

const CITE_LABEL = /^(?:atıf(?:\s+için)?|atif|kaynak\s+göster(?:mek\s+için)?|kaynakça\s+gösterimi|bu\s+makaleye\s+atıf(?:\s+(?:için|vermek\s+için))?|önerilen\s+atıf|cite\s+(?:as|this\s+article)|citation|how\s+to\s+cite(?:\s+this\s+article)?|to\s+cite\s+this\s+article|suggested\s+citation)\s*(?:\/\s*(?:cite\s+as|citation|how\s+to\s+cite|atıf)\s*)?[:：]\s*/i;
/** A line that starts another block of the page (so the reference ends before it). */
const BLOCK_LABEL = /^(?:[\p{L}][\p{L} ]{1,30}\s*(?:\/\s*[\p{L} ]{2,30})?[:：]|https?:\/\/(?!doi)|©|copyright|bu\s+(?:çalışma|makale|eser)|this\s+(?:work|article)|received|accepted|geliş|kabul|yayın\s+tarihi)/iu;

/** The reference a journal prints for its article ("Atıf: Kara, Mustafa. …"), Turkish one first. */
export function citeAsIn(lines: readonly string[]): string | null {
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CITE_LABEL.exec(lines[i]!.trim());
    if (!m) continue;
    let ref = lines[i]!.trim().slice(m[0].length);
    for (let j = i + 1; j < lines.length && j <= i + 6; j++) {
      const l = lines[j]!.trim();
      if (!l || CITE_LABEL.test(l) || (BLOCK_LABEL.test(l) && !/^(?:doi|https?:\/\/doi)/i.test(l))) break;
      ref = /-$/.test(ref) && /^\p{Ll}/u.test(l) ? ref.slice(0, -1) + l : `${ref} ${l}`;
    }
    ref = ref.trim();
    if (ref.length > 20) found.push(ref);
  }
  return found[0] ?? null;
}

/** Letter by letter to plain ASCII lower case (same length), so the patterns below match "BASKI", "Baskı", "baski" alike. */
export function fold(s: string): string {
  let out = "";
  for (const c of s) {
    const b = c === "İ" || c === "ı" ? "i" : c.normalize("NFD")[0]!.toLowerCase();
    out += b.length === c.length ? b : c;
  }
  return out;
}
const F = (re: RegExp): RegExp => new RegExp(fold(re.source).replace(/\\p\{l\}/g, "\\p{L}").replace(/\\p\{lu\}/g, "\\p{Lu}").replace(/\\p\{ll\}/g, "\\p{Ll}"), re.flags);

// ---------------------------------------------------------------- the layout

const NOISE = F(/(yayın\s+yönetmeni|genel\s+yayın|yayın\s+koordinat|kapak|tasarım|dizgi|mizanpaj|düzelti|redaksiyon|sayfa\s+düzeni|grafik|baskı\s+ve\s+cilt|matbaa\s*:|basım\s+yeri|sertifika|adres|\btel\b|telefon|faks|\bfax\b|e-?posta|e-?mail|www\.|@|kütüphane\s+bilgi\s+kartı|kataloglama|cataloging|tüm\s+hakları|bütün\s+hakları|all\s+rights|copyright|©|izin\s+alınmadan|without\s+(?:the\s+)?permission|printed\s+in|basılmıştır|mah\.|cad\.|sok\.|no\s*:\s*\d|pk\.|\bp\.k\.|posta\s+kodu|ıssn|issn|danışman|advisor|supervisor|jüri|\bt\.\s*c\.?$|^t\.c\.?$|^republic\s+of\s+turkey$)/i);
const STAFF_EDITOR = F(/(yayın\s+yönetmeni|kapak|tasarım|dizgi|mizanpaj|düzelti|redaksiyon|sertifika|baskı\s+ve\s+cilt)/i);
const ROLE_LINE = F(/^(çeviren(?:ler)?|çev\.|tercüme(?:\s+eden)?|mütercim|türkçesi|türkçeleştiren|translated\s+by|hazırlayan(?:lar)?|yayına\s+hazırlayan(?:lar)?|haz\.|hzl\.|derleyen|editör(?:ler)?|ed\.|eds\.|edited\s+by|editor(?:s)?|tahkik|thk\.|muhakkik|sadeleştiren|sad\.)\s*[:：]?\s+(.+)$/i);
const ROLE_OF: [RegExp, string][] = [
  [F(/^(çev|tercüme|mütercim|türkçe|translated)/i), "translator"],
  [F(/^(tahkik|thk|muhakkik)/i), "muhakkik"],
  [F(/^(sadeleştiren|sad)/i), "sadelestiren"],
  [F(/^(edit|ed\.|eds\.|derleyen)/i), "editor"],
  [F(/^(hazırlayan|yayına|haz|hzl)/i), "hazirlayan"],
];
const PUBLISHER_RE = F(/\b(yayınları|yayınevi|yayıncılık|yayınlar|neşriyat(?:ı)?|kitabevi|kitapları|kitap|basımevi|matbaası|press|publishing|publications|publishers|verlag|éditions|editions|books)\b/i);
const EDITION_RE = F(/(\d{1,2})\s*\.\s*(?:baskı|basım|bası)\b|\b(\d{1,2})(?:st|nd|rd|th)\s+(?:edition|printing)|\b(first|second|third|fourth|fifth)\s+(?:edition|printing)|(?:baskı|basım)\s*[:：]?\s*(\d{1,2})\b/i);
const WORD_EDITION: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const THESIS_RE = F(/\b(doktora\s+tezi|yüksek\s+lisans\s+tezi|sanatta\s+yeterlik\s+tezi|uzmanlık\s+tezi|bitirme\s+tezi|doctoral\s+(?:dissertation|thesis)|ph\.?\s*d\.?\s+(?:dissertation|thesis)|master'?s?\s+thesis|ma\s+thesis|dissertation)\b/i);
const HONORIFIC = /^(?:(?:prof|doç|doc|yrd|dr|öğr|ogr|üyesi|gör|arş|uzm|assoc|asst|assist|ass)\.?\s*)+/i;
const ARTICLE_RE = F(/\b(cilt|sayı|volume|vol\.|issue|number)\b/i);

function letters(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

function clean(s: string): string {
  return s.replace(/[|_~•·*]+/g, " ").replace(/\s+/g, " ").replace(/^[\s.,;:-]+|[\s,;:-]+$/g, "").trim();
}

/** "PROF. DR. MUSTAFA KARA" → a person; "Tasavvuf ve Tarikatlar Tarihi" → not. */
function looksLikeName(s: string): boolean {
  const t = s.replace(HONORIFIC, "").trim();
  if (!t || /\d|[:;!?"“”]/.test(t) || t.length > 60) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((w) => /^(ve|ile|bir|ve|of|the|and|in|on|için|üzerine|hakkında|tarihi|dergisi|üniversitesi|enstitüsü|fakültesi)$/i.test(w))) return false;
  return words.every((w) => /^(?:\p{Lu}|el-|al-|ibn|b\.|bin)/u.test(w) || /^(?:de|van|von|der|al|el|ibn|bin)$/i.test(w));
}

/** "Mustafa Kara - Ahmet Yılmaz", "Mustafa Kara ve Ahmet Yılmaz" → each person. */
function namesOf(s: string, creatorType: string): Creator[] {
  return s
    .split(/\s*(?:,|;|&|\s-\s|–|\bve\b|\band\b)\s*/i)
    .map((n) => n.replace(HONORIFIC, "").trim())
    .filter((n) => n && letters(n) > 2)
    .map((n) => {
      const w = n.split(/\s+/);
      if (w.length === 1) return { creatorType, name: n };
      return { creatorType, firstName: w.slice(0, -1).join(" "), lastName: w[w.length - 1]! };
    });
}

/** The latest year on a line ("1. Baskı: 1985 / 8. Baskı: 2005" → 2005); hicrî/milâdî pairs kept. */
function yearOf(s: string): string | null {
  const pair = /\b(1[2-4]\d{2})\s*\/\s*(1[89]\d{2}|20\d{2})\b/.exec(s);
  if (pair) return `${pair[1]}/${pair[2]}`;
  const ys = [...s.matchAll(/\b(1[5-9]\d{2}|20\d{2})\b/g)].map((m) => Number(m[1])).filter((y) => y <= new Date().getFullYear() + 1);
  return ys.length ? String(Math.max(...ys)) : null;
}

function editionOf(s: string): number | null {
  const m = EDITION_RE.exec(fold(s));
  if (!m) return null;
  return Number(m[1] ?? m[2] ?? m[4]) || WORD_EDITION[(m[3] ?? "").toLowerCase()] || null;
}

/** "Dergâh Yayınları: 412", "DERGÂH YAYINLARI / Tasavvuf Dizisi" → "DERGÂH YAYINLARI". */
function publisherOf(s: string): string {
  const p = s
    .replace(/\s*[:：/|-]\s*(?:\d+|[\p{L} ]*(?:dizisi|serisi|series|kitaplığı)\b.*)$/iu, "")
    .replace(/\s*(?:yayın|yay\.)\s*no\s*[:：]?\s*\d+.*$/i, "")
    .replace(/^[©c]\s*/i, "")
    .replace(/\s*,?\s*(?:1[5-9]\d{2}|20\d{2})\s*$/, "");
  const place = placeIn(p);
  return clean(place ? p.replace(new RegExp(`\\s*[,-]?\\s*${place.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,-]?\\s*`, "i"), " ") : p);
}

interface Line {
  text: string;
  size: number;
  i: number;
}

/** The record the page's layout gives (title page, künye page, thesis cover, article first page). */
export function readLayout(input: readonly PageLine[]): { item: Item; unsure: string[] } | null {
  const lines: Line[] = input.map((l, i) => ({ text: clean(l.text), size: l.size || 0, i })).filter((l) => l.text && letters(l.text) >= 2 || /\d{4}/.test(l.text));
  if (!lines.length) return null;
  const all = lines.map((l) => l.text).join("\n");
  const unsure: string[] = [];
  const used = new Set<number>();
  const thesis = THESIS_RE.exec(fold(all));
  const article = !thesis && ARTICLE_RE.test(fold(all)) && /\b(dergi|journal|review|studies|arastirma|bulten|mecmua)/i.test(fold(all)) && !PUBLISHER_RE.test(fold(all).replace(/dergi\w*/gi, ""));
  const item = emptyItem(thesis ? "thesis" : article ? "journalArticle" : "book", "sayfa");
  const kunye = lines.some((l) => STAFF_EDITOR.test(fold(l.text))) || /isbn/i.test(all);

  // Contributors with a role word: "Çeviren: Ahmet Serdaroğlu".
  for (const l of lines) {
    const m = ROLE_LINE.exec(fold(l.text));
    if (!m) continue;
    used.add(l.i);
    const type = ROLE_OF.find(([re]) => re.test(m[1]!))?.[1] ?? "contributor";
    if (type === "editor" && kunye && item.itemType === "book" && !/edited|derleyen/i.test(m[1]!)) continue; // the house editor of a künye page
    item.creators.push(...namesOf(l.text.slice(l.text.length - m[2]!.length), type));
  }
  for (const l of lines) if (NOISE.test(fold(l.text))) used.add(l.i);

  // Edition and year: the printing in hand is the latest "N. Baskı".
  let edition = 0;
  let year: string | null = null;
  for (const l of lines) {
    const e = editionOf(l.text);
    if (e === null) continue;
    used.add(l.i);
    const y = yearOf(l.text);
    if (e >= edition) {
      edition = e;
      if (y) year = y;
    }
  }
  if (edition > 1 && item.itemType === "book") item.fields.edition = String(edition);

  // Publisher, place.
  let place: string | null = null;
  const pubLines = lines.filter((l) => !used.has(l.i) && PUBLISHER_RE.test(fold(l.text)) && letters(l.text) < 70);
  if (item.itemType === "book" && pubLines.length) {
    // The shortest line naming the publisher (the long ones are addresses and series lines).
    const best = [...pubLines].sort((a, b) => a.text.length - b.text.length)[0]!;
    item.fields.publisher = publisherOf(best.text);
    for (const l of pubLines) used.add(l.i);
    place = placeIn(best.text)?.place ?? null;
    year ??= /\d{4}/.test(best.text) ? yearOf(best.text) : null;
  }
  if (thesis) {
    const raw = all.slice(thesis.index + thesis[0].indexOf(thesis[1]!), thesis.index + thesis[0].indexOf(thesis[1]!) + thesis[1]!.length);
    item.fields.thesisType = raw.toLocaleLowerCase("tr").replace(/(^|\s)(\p{Ll})/gu, (_, sp: string, c: string) => sp + c.toLocaleUpperCase("tr")).replace(/ Tezi$/, " Tezi");
    const uni = lines.filter((l) => /universitesi|university|enstitusu|institute|fakultesi/.test(fold(l.text)));
    const order = (t: string) => (/universite|university/.test(fold(t)) ? 0 : /enstitu|institute/.test(fold(t)) ? 1 : 2);
    const parts = uni.filter((l) => order(l.text) < 2).sort((a, b) => order(a.text) - order(b.text)).map((l) => clean(l.text.replace(/^t\.?\s*c\.?\s*/i, "")));
    if (parts.length) item.fields.university = [...new Set(parts)].join(", ");
    for (const l of lines) if (THESIS_RE.test(fold(l.text)) || /universitesi|university|enstitusu|institute|fakultesi|anabilim|ana\s+bilim|bilim\s+dali|programi|department/.test(fold(l.text))) used.add(l.i);
  }
  if (article) {
    const v = /(?:cilt|volume|vol\.)\s*[:/]?\s*(\d+)/.exec(fold(all));
    const n = /(?:sayi|issue|number|no\.)\s*[:/]?\s*(\d+)/.exec(fold(all));
    const pp = /(?:ss\.|sayfa|pp\.|pages?)\s*[:/]?\s*(\d+)\s*[-–]\s*(\d+)/i.exec(all);
    if (v) item.fields.volume = v[1]!;
    if (n) item.fields.issue = n[1]!;
    if (pp) item.fields.pages = `${pp[1]}-${pp[2]}`;
    const header = lines.find((l) => /\b(dergi\w*|journal|review|studies|mecmua\w*|bulten\w*)\b/.test(fold(l.text)) && letters(l.text) < 90);
    if (header) {
      item.fields.publicationTitle = clean(header.text.replace(/\s*[|/,-]?\s*(cilt|volume|vol\.|sayı|issue|\d{4}|e?-?issn).*$/i, ""));
      used.add(header.i);
      unsure.push("dergi adı");
    }
    for (const l of lines) if (ARTICLE_RE.test(fold(l.text)) && /\d/.test(l.text)) used.add(l.i);
  }
  for (const l of lines) {
    if (place) break;
    const p = placeIn(l.text);
    if (!p) continue;
    // A city on a publisher or edition line ("8. Baskı: İstanbul, 2005"), or a line that is only the city (and a year).
    const alone = letters(l.text) - letters(p.raw) < 3;
    if (!alone && !(PUBLISHER_RE.test(fold(l.text)) || editionOf(l.text) !== null)) continue;
    if (NOISE.test(fold(l.text)) && !alone) continue;
    place = p.place;
    if (alone) used.add(l.i);
  }
  if (!year) {
    // A line that is only a year, or "Ankara 2015", or the copyright line.
    for (const l of [...lines].reverse()) {
      if (/^(?:[\p{L} ]{0,20}[\s,-]*)?(?:\d{4}\s*\/\s*)?\d{4}\.?$/u.test(l.text) || /©|copyright/i.test(l.text)) {
        year = yearOf(l.text);
        if (year) {
          if (!NOISE.test(fold(l.text)) || /©/.test(l.text)) used.add(l.i);
          break;
        }
      }
    }
  }
  if (place) item.fields.place = place;
  if (year) item.fields.date = year;

  // Title and author from what is left: the title is set largest.
  const rest = lines.filter((l) => !used.has(l.i) && letters(l.text) >= 3 && !/^\d/.test(l.text) && !/(isbn|doi\b|https?:)/i.test(l.text) && !(kunye && /\b(dizisi|serisi|series|kitapligi)\b/.test(fold(l.text))));
  if (!rest.length) return item.fields.publisher || item.fields.university ? { item, unsure: ["başlık"] } : null;
  // Sizes tell the title only when the page sets it apart (OCR heights of one font differ by a fifth or so).
  const sizes = rest.map((l) => l.size).filter((x) => x > 0);
  const sized = sizes.length > 1 && Math.max(...sizes) >= 1.3 * Math.min(...sizes);
  const names = rest.filter((l) => looksLikeName(l.text) || (/^(?:prof|doc|dr)\b/.test(fold(l.text)) && letters(l.text) < 50));
  let titleLines: Line[];
  if (sized) {
    const nonNames = rest.filter((l) => !names.includes(l));
    const pool = nonNames.length ? nonNames : rest;
    const max = Math.max(...pool.map((l) => l.size));
    const top = pool.filter((l) => l.size >= max * 0.82);
    // The title's lines are one run (a title set over two or three lines).
    const first = top[0]!;
    titleLines = [first];
    for (const l of top.slice(1)) if (l.i - titleLines[titleLines.length - 1]!.i <= 2) titleLines.push(l);
    else break;
    // A smaller line right under the title, not a name: the subtitle.
    const last = titleLines[titleLines.length - 1]!;
    const sub = pool.find((l) => l.i > last.i && l.i - last.i <= 2 && !titleLines.includes(l) && l.size < max * 0.82 && l.size >= max * 0.4 && !looksLikeName(l.text));
    if (sub) titleLines = [...titleLines, { ...sub, text: `: ${sub.text}` }];
  } else {
    // No sizes (plain text): the first line that is not a name; a künye page lists the title before the author.
    const t = rest.find((l) => !names.includes(l)) ?? rest[0]!;
    titleLines = [t];
    unsure.push("başlık");
  }
  const title = titleLines.map((l) => l.text).join(" ").replace(/\s+:\s*/g, ": ").replace(/[.:,;-]+$/, "").trim();
  if (letters(title) < 3) return null;
  item.fields.title = title;
  for (const l of titleLines) used.add(l.i);

  // Author: a name next to the title (above it on a cover, below it on a künye page).
  if (!item.creators.some((c) => c.creatorType === "author")) {
    const near = names.filter((l) => !used.has(l.i)).sort((a, b) => Math.abs(a.i - titleLines[0]!.i) - Math.abs(b.i - titleLines[0]!.i));
    const author = near[0];
    if (author) {
      const authors = namesOf(author.text, item.itemType === "book" && item.creators.length && !names.length ? "editor" : "author");
      item.creators.unshift(...authors);
      used.add(author.i);
      // A second name line next to the first (one author per line).
      const second = near[1];
      if (second && Math.abs(second.i - author.i) === 1 && !sized) item.creators.splice(authors.length, 0, ...namesOf(second.text, "author"));
      else if (second && Math.abs(second.i - author.i) === 1 && Math.abs(second.size - author.size) < 0.15 * (author.size || 1)) item.creators.splice(authors.length, 0, ...namesOf(second.text, "author"));
    } else if (!item.creators.length) unsure.push("yazar");
  }
  if (item.itemType === "book" && !item.fields.publisher) unsure.push("yayınevi");
  if (!item.fields.date) unsure.push("yıl");
  if (item.itemType !== "journalArticle" && !item.fields.place && !/(press|publishing|verlag)/i.test(item.fields.publisher ?? "")) unsure.push("yer");
  return { item, unsure };
}

/** Everything the page says. */
export function readPage(input: readonly PageLine[]): PageReading {
  const text = input.map((l) => l.text).join("\n");
  const dois = doisIn(text);
  const isbns = isbnsIn(text);
  const citeAs = citeAsIn(input.map((l) => l.text));
  if (citeAs) {
    const r = parseReference(citeAs);
    if (r && r.item.fields.title) {
      r.item.source = "sayfa";
      if (dois[0] && !r.item.fields.DOI) r.item.fields.DOI = dois[0];
      return { dois, isbns, citeAs, item: r.item, unsure: r.unsure, how: "atif" };
    }
  }
  const lay = readLayout(input);
  if (lay) {
    if (dois[0] && lay.item.itemType !== "book") lay.item.fields.DOI = dois[0];
    if (isbns[0] && lay.item.itemType === "book") lay.item.fields.ISBN = isbns[0];
  }
  return { dois, isbns, citeAs, item: lay?.item ?? null, unsure: lay?.unsure ?? [], how: lay ? "sayfa" : null };
}

/** Plain text (no sizes) as page lines. */
export function linesOf(text: string): PageLine[] {
  return text.replace(/\r/g, "").split("\n").map((t) => ({ text: t, size: 0 }));
}

/** Fills what the catalogue left empty from what the page says (the catalogue wins where both have a value). */
export function completeFromPage(found: Item, page: Item | null): Item {
  if (!page) return found;
  const fields = { ...found.fields };
  for (const [k, v] of Object.entries(page.fields)) if (v && !fields[k] && k !== "title") fields[k] = v;
  if (!fields.title && page.fields.title) fields.title = page.fields.title;
  const creators = found.creators.length ? [...found.creators, ...page.creators.filter((c) => c.creatorType !== "author" && !found.creators.some((f) => f.creatorType === c.creatorType && foldText(f.lastName ?? f.name ?? "") === foldText(c.lastName ?? c.name ?? "")))] : page.creators;
  return { ...found, fields, creators };
}

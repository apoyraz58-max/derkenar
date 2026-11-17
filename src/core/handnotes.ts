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
}

export interface HandNote {
  readonly index: number;
  readonly text: string;
  /** The citation the note becomes; null: kept as it is (`reason` says why). */
  readonly refs: HandRef[] | null;
  readonly reason?: string;
}

const PREFIX = /^(ayrıca\s+bk\.|ayrıca\s+bkz\.|ayrıca\s+bakınız|bk\.|bkz\.|bakınız|krş\.|karş\.|karşılaştırınız|mesela|örnek\s+olarak|see\s+also|see|cf\.|vgl\.)\s*/i;
const SAME = /^(a\.?\s?g\.?\s?e\.?|a\.?\s?g\.?\s?m\.?|a\.?\s?e\.?|age\.?|agm\.?|aynı\s+eser|aynı\s+yer|a\.?\s?y\.?|ibid\.?|ibidem|ay\.?\s?e\.?|aynı\s+makale)(?=[\s,.]|$)\s*,?\s*/i;
/** The cited place at the end: "45", "1/45", "45-47", "45 vd.", "vr. 12b", "II/45". */
const LOCATOR = /,\s*((?:[IVXLC]+|\d+)\s*\/\s*)?(\d+(?:\s*[-–]\s*\d+)?(?:\s*vd\.)?|vr\.\s*\d+[ab]?(?:\s*[-–]\s*\d+[ab]?)?|s\.\s*\d+(?:\s*[-–]\s*\d+)?)\.?\s*$/i;

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

function cut(s: string): { body: string; volume?: string; locator?: string } {
  const m = LOCATOR.exec(s);
  // "…, İstanbul, 2005." ends with the year, not a page.
  if (!m || (!m[1] && /^(1[0-9]|20)\d{2}$/.test(m[2]!) && !/\b(1[0-9]|20)\d{2}\b/.test(s.slice(0, m.index)))) return { body: s.replace(/\.\s*$/, "") };
  const volume = m[1]?.replace(/\s*\/\s*$/, "").trim();
  const locator = m[2]!.replace(/^s\.\s*/i, "").replace(/\s*[-–]\s*/g, "-").trim();
  return { body: s.slice(0, m.index).trim(), ...(volume ? { volume } : {}), locator };
}

const fold = (s: string) => foldText(s).replace(/^(el|al|er|es|en|et|ed|ez|eş|es)\s/, "");

function surnames(item: Item): string[] {
  return item.creators.filter((c) => c.creatorType === "author" || c.creatorType === "editor").map((c) => fold(c.lastName ?? c.name ?? "")).filter(Boolean);
}

/** "Kara, Tasavvuf ve Tarikatlar" → the work among `pool` by that author whose title (or short title) begins so. */
function findShort(body: string, pool: readonly Item[]): Item | null {
  const comma = body.indexOf(",");
  const author = comma > 0 ? fold(body.slice(0, comma)) : "";
  const title = fold((comma > 0 ? body.slice(comma + 1) : body).replace(/[“”"«»]/g, ""));
  if (!title) return null;
  const hits = pool.filter((it) => {
    if (author && !surnames(it).some((s) => s === author || s.endsWith(` ${author}`) || author.endsWith(` ${s}`))) return false;
    const t = fold(titleOf(it));
    const st = fold(it.fields.shortTitle ?? "");
    return t.startsWith(title) || (st && (st === title || title.startsWith(st)));
  });
  return hits.length === 1 ? hits[0]! : (hits.find((h) => fold(h.fields.shortTitle ?? "") === title) ?? null);
}

/** Reads the notes in order; `library` is searched for each work before a new record is made. */
export function readHandNotes(notes: readonly string[], library: readonly Item[]): HandNote[] {
  const created: Item[] = [];
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
      const sm = SAME.exec(rest);
      if (sm) {
        if (!previous) {
          reason = "a.g.e. önceki bir eseri göstermiyor";
          break;
        }
        const tail = rest.slice(sm[0].length).trim();
        const c: { volume?: string; locator?: string } = tail ? cut(`, ${tail.replace(/^,\s*/, "")}`) : {};
        const sameLoc = /^a\.?\s?y\.?|aynı\s+yer/i.test(sm[1]!);
        const ref: HandRef = { item: previous.item, isNew: previous.isNew, ...(c.volume ? { volume: c.volume } : previous.volume && !c.locator ? { volume: previous.volume } : {}), ...(c.locator ? { locator: c.locator } : sameLoc && previous.locator ? { locator: previous.locator } : {}), ...(prefix ? { prefix } : {}) };
        refs.push(ref);
        continue;
      }
      const { body, volume, locator } = cut(rest);
      // A short form of a work already met (in these notes, then in the library).
      const short = body.length < 120 && !/\(.*:\s*.*\d{3,4}.*\)/.test(body) ? (findShort(body, seen) ?? findShort(body, library)) : null;
      let item: Item | null = short;
      let isNew = false;
      if (!item) {
        const r = parseReference(`${body}.`);
        const f = r?.item.fields;
        // A full reference has an author or an imprint; a sentence of the author's own has neither.
        const looksFull = r && f?.title && (r.item.creators.length > 0 || f.date) && (f.date || f.publisher || f.publicationTitle || f.university || f.place);
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
        }
      }
      if (!seen.includes(item)) seen.push(item);
      const ref: HandRef = { item, isNew: isNew || created.includes(item), ...(volume ? { volume } : {}), ...(locator ? { locator } : {}), ...(prefix ? { prefix } : {}) };
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

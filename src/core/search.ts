/**
 * In-memory search over the library. The haystack of each item is folded once
 * (Turkish dotless/dotted i, circumflex and transliteration marks, case), so a
 * query is a handful of substring checks per item: 10 000 items in a few ms.
 */
import { type Item, creatorLine, noteText, yearOf } from "./zotero.js";

const MARKS = /[̀-ͯʼʾʿ‘’‛ʹʻ'`´]/g;

/** "İhyâü ‘Ulûmi’d-Dîn" → "ihyau ulumid-din". */
export function fold(text: string): string {
  return text
    .replace(/[İIı]/g, "i")
    .normalize("NFD")
    .replace(MARKS, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export { creatorLine as authorLine } from "./zotero.js";
interface Entry {
  readonly item: Item;
  readonly family: string;
  readonly title: string;
  readonly rest: string;
  readonly year: string;
  readonly hijri: string;
}

export interface SearchHit {
  readonly item: Item;
  readonly score: number;
}

export class SearchIndex {
  private entries: Entry[] = [];

  constructor(items: Iterable<Item> = []) {
    this.reset(items);
  }

  reset(items: Iterable<Item>): void {
    this.entries = [];
    for (const item of items) this.entries.push(SearchIndex.entry(item));
  }

  get size(): number {
    return this.entries.length;
  }

  private static entry(item: Item): Entry {
    const people = item.creators;
    const title = item.fields.title ?? "";
    const rest: string[] = [];
    for (const [k, v] of Object.entries(item.fields)) if (k !== "title" && k !== "date") rest.push(v);
    return {
      item,
      family: fold(people.map((c) => c.lastName ?? c.name ?? "").join(" ")),
      title: fold([title, item.fields.shortTitle].filter(Boolean).join(" ")),
      rest: fold([people.map((c) => c.firstName ?? "").join(" "), ...rest, item.tags.map((t) => t.tag).join(" "), item.notes.map((n) => noteText(n.note)).join(" "), item.key].join(" ")),
      year: yearOf(item).split("/").pop() ?? "",
      hijri: yearOf(item).split("/")[0] ?? "",
    };
  }

  /**
   * Every word of the query must match somewhere. A word matching the start of
   * an author's family name or a year scores highest, so "gazzali 1982" or
   * "yılmaz kelam" put the intended work on top.
   */
  search(query: string, limit = 50, filter?: (item: Item) => boolean): SearchHit[] {
    const words = fold(query).split(" ").filter(Boolean);
    const hits: SearchHit[] = [];
    for (const e of this.entries) {
      if (filter && !filter(e.item)) continue;
      let score = 0;
      let ok = true;
      for (const w of words) {
        if (/^\d{3,4}$/.test(w) && (e.year === w || e.hijri === w)) score += 6;
        else if (startsWord(e.family, w)) score += 5;
        else if (e.family.includes(w)) score += 3;
        else if (startsWord(e.title, w)) score += 3;
        else if (e.title.includes(w)) score += 2;
        else if (e.rest.includes(w)) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (ok) hits.push({ item: e.item, score });
    }
    hits.sort((a, b) => b.score - a.score || compareItems(a.item, b.item));
    return hits.slice(0, limit);
  }
}

function startsWord(haystack: string, word: string): boolean {
  if (haystack.startsWith(word)) return true;
  let i = haystack.indexOf(` ${word}`);
  if (i >= 0) return true;
  i = haystack.indexOf(`-${word}`);
  return i >= 0;
}

function compareItems(a: Item, b: Item): number {
  return creatorLine(a).localeCompare(creatorLine(b), "tr") || yearOf(a).localeCompare(yearOf(b));
}

/**
 * Quick format, as in Zotero's citation bar: "gazzali 1/45", "gazzali s. 45",
 * "kemalpaşazade vr. 12b" → search words + cilt/sayfa. A lone four-digit number
 * stays a year ("gazzali 1982").
 */
export function parseQuick(q: string): { words: string; volume?: string; locator?: string; label?: string } {
  const m = /^(.*?)[\s,]+(?:(s\.|ss\.|sayfa|vr\.|varak)\s*)?(\d+\/\d+[ab]?(?:-\d+[ab]?)?|\d{1,3}[ab]?(?:-\d+[ab]?)?|\d{4}[ab]?-\d+[ab]?)$/i.exec(q.trim());
  const prefixed = /^(.*?)[\s,]+(s\.|ss\.|sayfa|vr\.|varak)\s*(\d+[ab]?(?:-\d+[ab]?)?)$/i.exec(q.trim());
  const hit = prefixed ?? m;
  if (!hit || !hit[1]!.trim()) return { words: q };
  // İSNAD writes varak numbers without "vr." (77b): the prefix is only a typing aid.
  const label = undefined as string | undefined;
  const loc = hit[3]!;
  const slash = /^(\d+)\/(.+)$/.exec(loc);
  return { words: hit[1]!, ...(slash ? { volume: slash[1], locator: slash[2] } : { locator: loc }), ...(label ? { label } : {}) };
}


/**
 * In-memory search over the library. The haystack of each item is folded once
 * (Turkish dotless/dotted i, circumflex and transliteration marks, case), so a
 * query is a handful of substring checks per item: 10 000 items in a few ms.
 */
import type { CslItem, CslName, LibraryItem } from "./types.js";

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

export function nameText(name: CslName): string {
  return name.literal ?? [name.given, name["non-dropping-particle"], name.family].filter(Boolean).join(" ");
}

export function year(item: CslItem): string {
  const parts = item.issued?.["date-parts"]?.[0];
  if (parts && parts[0] !== undefined) return String(parts[0]);
  const raw = item.issued?.literal ?? item.issued?.raw ?? "";
  return /\d{3,4}/.exec(raw)?.[0] ?? "";
}

export function creators(item: CslItem): CslName[] {
  return item.author ?? item.editor ?? item.translator ?? [];
}

/** "Gazzâlî, Yılmaz ve Kara" style short author line for result lists. */
export function authorLine(item: CslItem, max = 3): string {
  const names = creators(item).map((n) => n.family ?? n.literal ?? n.given ?? "");
  if (names.length === 0) return "";
  if (names.length > max) return `${names.slice(0, max).join(", ")} vd.`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}` : names[0]!;
}

interface Entry {
  readonly item: LibraryItem;
  readonly family: string;
  readonly title: string;
  readonly rest: string;
  readonly year: string;
}

export interface SearchHit {
  readonly item: LibraryItem;
  readonly score: number;
}

export class SearchIndex {
  private entries: Entry[] = [];

  constructor(items: Iterable<LibraryItem> = []) {
    this.reset(items);
  }

  reset(items: Iterable<LibraryItem>): void {
    this.entries = [];
    for (const item of items) this.entries.push(SearchIndex.entry(item));
  }

  get size(): number {
    return this.entries.length;
  }

  private static entry(item: LibraryItem): Entry {
    const c = item.csl;
    const people = [...(c.author ?? []), ...(c.editor ?? []), ...(c.translator ?? [])];
    return {
      item,
      family: fold(people.map((n) => n.family ?? n.literal ?? "").join(" ")),
      title: fold([c.title, c["title-short"], c["original-title"]].filter(Boolean).join(" ")),
      rest: fold(
        [
          people.map((n) => n.given ?? "").join(" "),
          c["container-title"],
          c["collection-title"],
          c.publisher,
          c["publisher-place"],
          c.DOI,
          c.ISBN,
          c.note,
          (item.tags ?? []).join(" "),
          item.key,
        ]
          .filter(Boolean)
          .join(" "),
      ),
      year: year(c),
    };
  }

  /**
   * Every word of the query must match somewhere. A word matching the start of
   * an author's family name or a year scores highest, so "gazzali 1982" or
   * "yılmaz kelam" put the intended work on top.
   */
  search(query: string, limit = 50, filter?: (item: LibraryItem) => boolean): SearchHit[] {
    const words = fold(query).split(" ").filter(Boolean);
    const hits: SearchHit[] = [];
    for (const e of this.entries) {
      if (filter && !filter(e.item)) continue;
      let score = 0;
      let ok = true;
      for (const w of words) {
        if (/^\d{4}$/.test(w) && e.year === w) score += 6;
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

function compareItems(a: LibraryItem, b: LibraryItem): number {
  return authorLine(a.csl).localeCompare(authorLine(b.csl), "tr") || year(a.csl).localeCompare(year(b.csl));
}

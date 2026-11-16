/**
 * The same author written differently ("Gazzâlî" / "Gazzali", "Ebû Hâmid
 * Muhammed el-" / "Ebû Hâmid", "İbn Teymiyye" / "İbn Teymiyye, Takıyyüddîn"):
 * recognised for a.mlf. and reported by the İSNAD check.
 */
import { fold } from "./search.js";
import type { Creator, Item } from "./zotero.js";

const ARTICLE = /^(?:[ae][lrsztdnş]|eş|ed)-/u;

/** "el-Gazzâlî" → "gazzali"; "İbn-i Sînâ" → "ibn sina". */
export function familyKey(c: Creator): string {
  const raw = c.name ?? c.lastName ?? "";
  return fold(raw)
    .split(/\s+/)
    .map((w) => w.replace(ARTICLE, ""))
    .join(" ")
    .replace(/\bibn-?i\b/g, "ibn")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function givenTokens(c: Creator): string[] {
  if (c.name !== undefined) return [];
  return fold(c.firstName ?? "")
    .replace(/[^\p{L}\p{N}. -]+/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(ARTICLE, "").replace(/\.$/, ""))
    .filter((w) => w && !/^(?:[ae][lrsztdnş]|es|ed)$/.test(w));
}

/** Initials match words ("a" ~ "ahmet"); otherwise words must be equal. */
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/** One given name is the start of the other ("Ebû Hâmid" ⊂ "Ebû Hâmid Muhammed"), or one is missing. */
export function sameAuthor(a: Creator, b: Creator): boolean {
  const fa = familyKey(a);
  if (!fa || fa !== familyKey(b)) return false;
  const ga = givenTokens(a);
  const gb = givenTokens(b);
  if (!ga.length || !gb.length) return true;
  const [short, long] = ga.length <= gb.length ? [ga, gb] : [gb, ga];
  return short.every((t, i) => tokenMatch(t, long[i]!));
}

export function sameAuthors(a: readonly Creator[], b: readonly Creator[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((c, i) => sameAuthor(c, b[i]!));
}

export interface NameVariant {
  /** Spellings found, most used first. */
  spellings: { creator: Creator; label: string; count: number }[];
}

const label = (c: Creator) => c.name ?? [c.lastName, c.firstName].filter(Boolean).join(", ");

/** Groups of creators that are one person written in more than one way. */
export function nameVariants(items: readonly Item[]): NameVariant[] {
  const groups: { creators: Creator[] }[] = [];
  for (const it of items) {
    if (it.deleted) continue;
    for (const c of it.creators) {
      if (!familyKey(c)) continue;
      const g = groups.find((x) => sameAuthor(x.creators[0]!, c));
      if (g) g.creators.push(c);
      else groups.push({ creators: [c] });
    }
  }
  const out: NameVariant[] = [];
  for (const g of groups) {
    const counts = new Map<string, { creator: Creator; count: number }>();
    for (const c of g.creators) {
      const k = label(c);
      const e = counts.get(k) ?? { creator: c, count: 0 };
      e.count++;
      counts.set(k, e);
    }
    if (counts.size < 2) continue;
    out.push({ spellings: [...counts].map(([k, v]) => ({ label: k, ...v })).sort((a, b) => b.count - a.count || b.label.length - a.label.length) });
  }
  return out;
}

/** Rewrites every creator matching `target` to `target`'s spelling (role kept). */
export function unifyName(items: readonly Item[], target: Creator, variants: readonly Creator[]): Item[] {
  const labels = new Set(variants.map(label));
  return items
    .filter((it) => it.creators.some((c) => labels.has(label(c)) && label(c) !== label(target)))
    .map((it) => ({
      ...it,
      creators: it.creators.map((c) => (labels.has(label(c)) ? { creatorType: c.creatorType, ...(target.name !== undefined ? { name: target.name } : { lastName: target.lastName, ...(target.firstName ? { firstName: target.firstName } : {}) }) } : c)),
    }));
}

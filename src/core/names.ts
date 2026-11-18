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
    .replace(/(\p{L})\1+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function givenTokens(c: Creator): string[] {
  if (c.name !== undefined) return [];
  return fold(c.firstName ?? "")
    .replace(/(\p{L})\1+/gu, "$1")
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

/**
 * The words of the shorter given name appear in the longer one in the same
 * order: titles, künye, lakab or nisbe added anywhere do not matter
 * ("Ebû Hâmid Muhammed" ~ "Huccetü’l-İslâm Ebû Hâmid Muhammed b. Muhammed").
 * A missing given name matches any.
 */
export function sameAuthor(a: Creator, b: Creator): boolean {
  const fa = familyKey(a);
  if (!fa || fa !== familyKey(b)) return false;
  const ga = givenTokens(a);
  const gb = givenTokens(b);
  if (!ga.length || !gb.length) return true;
  const [short, long] = ga.length <= gb.length ? [ga, gb] : [gb, ga];
  let j = 0;
  for (const t of short) {
    while (j < long.length && !tokenMatch(t, long[j]!)) j++;
    if (j === long.length) return false;
    j++;
  }
  return true;
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
  // Only creators with the same family key can be one person: compared within that bucket only.
  const byFamily = new Map<string, { creators: Creator[] }[]>();
  for (const it of items) {
    if (it.deleted) continue;
    for (const c of it.creators) {
      const fk = familyKey(c);
      if (!fk) continue;
      const bucket = byFamily.get(fk) ?? [];
      const g = bucket.find((x) => sameAuthor(x.creators[0]!, c));
      if (g) g.creators.push(c);
      else {
        const ng = { creators: [c] };
        bucket.push(ng);
        groups.push(ng);
      }
      byFamily.set(fk, bucket);
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

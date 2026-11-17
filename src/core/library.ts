/**
 * Library operations Zotero's middle pane offers: filtering by collection,
 * tag and trash, sorting, duplicate detection and merging, collection tree.
 */
import { foldText } from "./isnadstyle.js";
import { fold } from "./search.js";
import { type Collection, type Item, creatorLine, now, titleOf, yearOf } from "./zotero.js";

export type View = { kind: "all" } | { kind: "collection"; key: string; deep?: boolean } | { kind: "unfiled" } | { kind: "trash" } | { kind: "duplicates" } | { kind: "document"; keys: ReadonlySet<string> } | { kind: "recent" };

export function inView(item: Item, view: View, collections: readonly Collection[] = []): boolean {
  if (view.kind === "trash") return Boolean(item.deleted);
  if (item.deleted) return false;
  switch (view.kind) {
    case "all":
    case "duplicates":
    case "recent":
      return true;
    case "unfiled":
      return item.collections.length === 0;
    case "document":
      return view.keys.has(item.key);
    case "collection": {
      if (item.collections.includes(view.key)) return true;
      if (!view.deep) return false;
      const sub = descendants(view.key, collections);
      return item.collections.some((c) => sub.has(c));
    }
  }
}

export function descendants(key: string, collections: readonly Collection[]): Set<string> {
  const out = new Set<string>();
  const walk = (k: string) => {
    for (const c of collections) if (c.parentKey === k && !out.has(c.key)) (out.add(c.key), walk(c.key));
  };
  walk(key);
  return out;
}

/** Collections in tree order with their depth, for an indented list. */
export function collectionTree(collections: readonly Collection[]): { c: Collection; depth: number }[] {
  const keys = new Set(collections.map((c) => c.key));
  const out: { c: Collection; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    const kids = collections.filter((c) => (parent ? c.parentKey === parent : !c.parentKey || !keys.has(c.parentKey))).sort((a, b) => a.name.localeCompare(b.name, "tr"));
    for (const c of kids) {
      out.push({ c, depth });
      walk(c.key, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

export type SortKey = "creator" | "title" | "date" | "dateAdded" | "dateModified" | "itemType";

export function sortItems(items: Item[], key: SortKey, desc = false): Item[] {
  const val = (i: Item): string => {
    switch (key) {
      case "creator":
        return fold(creatorLine(i)) || "￿";
      case "title":
        return fold(titleOf(i));
      case "date":
        return (yearOf(i).split("/").pop() ?? "").padStart(4, "0");
      case "dateAdded":
        return i.dateAdded;
      case "dateModified":
        return i.dateModified;
      case "itemType":
        return i.itemType;
    }
  };
  const sorted = [...items].sort((a, b) => val(a).localeCompare(val(b), "tr") || fold(titleOf(a)).localeCompare(fold(titleOf(b)), "tr"));
  return desc ? sorted.reverse() : sorted;
}

/** All tags with how many (non-deleted) items carry them. */
export function tagCounts(items: readonly Item[]): { tag: string; count: number; automatic: boolean }[] {
  const m = new Map<string, { count: number; automatic: boolean }>();
  for (const i of items) {
    if (i.deleted) continue;
    for (const t of i.tags) {
      const e = m.get(t.tag) ?? { count: 0, automatic: true };
      e.count++;
      if (t.type !== 1) e.automatic = false;
      m.set(t.tag, e);
    }
  }
  return [...m].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => a.tag.localeCompare(b.tag, "tr"));
}

// ---------------------------------------------------------------- duplicates

function normTitle(i: Item): string {
  return fold(titleOf(i)).replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 60);
}

function firstFamily(i: Item): string {
  const c = i.creators[0];
  return fold(c?.lastName ?? c?.name ?? "");
}

/**
 * Groups of probable duplicates, as Zotero finds them: same DOI or ISBN, or
 * the same title with matching year (when both have one) and first creator.
 */
export function findDuplicates(items: readonly Item[]): Item[][] {
  const live = items.filter((i) => !i.deleted);
  const parent = new Map<string, string>(live.map((i) => [i.key, i.key]));
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const by = new Map<string, string>();
  const link = (sig: string, key: string) => {
    const other = by.get(sig);
    if (other) union(key, other);
    else by.set(sig, key);
  };
  for (const i of live) {
    const doi = i.fields.DOI?.trim().toLowerCase();
    if (doi) link(`doi:${doi}`, i.key);
    for (const isbn of (i.fields.ISBN ?? "").split(/[\s,;]+/).map((x) => x.replace(/[^0-9X]/gi, "")).filter((x) => x.length >= 10)) link(`isbn:${isbn}`, i.key);
  }
  const byTitle = new Map<string, Item[]>();
  for (const i of live) {
    const t = normTitle(i);
    if (t.length < 4) continue;
    byTitle.set(t, [...(byTitle.get(t) ?? []), i]);
  }
  for (const group of byTitle.values()) {
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const x = group[a]!;
        const y = group[b]!;
        const yx = yearOf(x);
        const yy = yearOf(y);
        const fx = firstFamily(x);
        const fy = firstFamily(y);
        if ((yx && yy && yx !== yy) || (fx && fy && fx !== fy) || x.itemType !== y.itemType) continue;
        union(x.key, y.key);
      }
    }
  }
  const groups = new Map<string, Item[]>();
  for (const i of live) groups.set(find(i.key), [...(groups.get(find(i.key)) ?? []), i]);
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Merges into the first (master) item: empty fields filled, tags/collections/notes/relations united. */
export function mergeItems(master: Item, others: readonly Item[]): Item {
  const m: Item = { ...master, fields: { ...master.fields }, creators: [...master.creators], tags: [...master.tags], collections: [...master.collections], notes: [...master.notes], relations: [...master.relations] };
  for (const o of others) {
    for (const [k, v] of Object.entries(o.fields)) if (v && !m.fields[k]) m.fields[k] = v;
    if (!m.creators.length) m.creators = [...o.creators];
    for (const t of o.tags) if (!m.tags.some((x) => x.tag === t.tag)) m.tags.push(t);
    for (const c of o.collections) if (!m.collections.includes(c)) m.collections.push(c);
    for (const n of o.notes) if (!m.notes.some((x) => x.note === n.note)) m.notes.push(n);
    for (const r of o.relations) if (r !== m.key && !m.relations.includes(r)) m.relations.push(r);
    if (o.dateAdded < m.dateAdded) m.dateAdded = o.dateAdded;
  }
  m.relations = m.relations.filter((r) => !others.some((o) => o.key === r));
  m.dateModified = now();
  return m;
}

/** ISBN as 13 digits (ISBN-10 converted), for comparing. */
function isbn13(raw: string): string {
  const d = raw.replace(/[^0-9X]/gi, "").toUpperCase();
  if (d.length !== 10) return d;
  const core = "978" + d.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + String((10 - (sum % 10)) % 10);
}

/**
 * The library's record of the same work, if there is one: same DOI, same
 * ISBN (10 or 13), or the same title, year and first creator. Used when a
 * work is added, so the library does not get it twice.
 */
export function existingCopy(candidate: Item, items: readonly Item[]): Item | undefined {
  const doi = candidate.fields.DOI?.trim().toLowerCase();
  const isbns = new Set((candidate.fields.ISBN ?? "").split(/[\s,;]+/).filter((x) => x.replace(/[^0-9X]/gi, "").length >= 10).map(isbn13));
  const t = normTitle(candidate);
  const y = yearOf(candidate);
  const f = firstFamily(candidate);
  return items.find((i) => {
    if (i.deleted) return false;
    if (i.key === candidate.key) return true;
    if (doi && i.fields.DOI?.trim().toLowerCase() === doi) return true;
    if (isbns.size && (i.fields.ISBN ?? "").split(/[\s,;]+/).some((x) => isbns.has(isbn13(x)))) return true;
    if (t.length < 4 || normTitle(i) !== t) return false;
    const yi = yearOf(i);
    const fi = firstFamily(i);
    return !(y && yi && y !== yi) && !(f && fi && f !== fi) && Boolean(f || fi || y || yi);
  });
}

// ---------------------------------------------------------------- the library's own spelling

const SPELLED_FIELDS = ["publisher", "place", "publicationTitle", "university", "bookTitle", "encyclopediaTitle", "dictionaryTitle", "proceedingsTitle", "series"];

/** Letters a careful spelling has and a quick one leaves out (â î û ā ʿ ḥ …). */
function marks(s: string): number {
  return (s.normalize("NFD").match(/[̀-ͯ]|[ʿʾ’]/g) ?? []).length;
}

const bare = (s: string) => s.normalize("NFC").replace(/[ʿʾ’'‘`]/g, "").replace(/\s+/g, " ").trim();

function spellings(items: readonly Item[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  const add = (kind: string, v: string | undefined) => {
    if (!v || v.length < 3) return;
    const k = `${kind}|${foldText(v)}`;
    const variants = m.get(k) ?? new Map<string, number>();
    variants.set(v, (variants.get(v) ?? 0) + 1);
    m.set(k, variants);
  };
  for (const it of items) {
    if (it.deleted) continue;
    for (const c of it.creators) {
      add("name", c.name);
      if (c.lastName && c.firstName) add("person", `${c.lastName}\u0000${c.firstName}`);
    }
    for (const f of SPELLED_FIELDS) add("field", it.fields[f]);
  }
  return m;
}

/**
 * A new record written the way the library already writes the same person,
 * publisher, place or journal: "Gazzâli" (read from a photo) → "Gazzâlî",
 * "Dergah Yayinlari" → "Dergâh Yayınları". Only spellings that differ in
 * marks and case, never in letters; and never towards a plainer spelling.
 */
export function librarySpelling(item: Item, library: readonly Item[]): { item: Item; changed: string[] } {
  const known = spellings(library.filter((i) => i.key !== item.key));
  const changed: string[] = [];
  const best = (kind: string, v: string): string | null => {
    const variants = known.get(`${kind}|${foldText(v)}`);
    if (!variants) return null;
    const caps = (x: string) => x === x.toLocaleUpperCase("tr") && /\p{L}{2}/u.test(x);
    const [top] = [...variants.entries()].filter(([x]) => !caps(x) || caps(v)).sort((a, b) => marks(b[0]) - marks(a[0]) || b[1] - a[1]);
    if (!top) return null;
    const w = top[0];
    return w !== v && marks(w) >= marks(v) && bare(w).length === bare(v).length ? w : null;
  };
  const creators = item.creators.map((c) => {
    if (c.name) {
      const w = best("name", c.name);
      if (w) {
        changed.push(w);
        return { ...c, name: w };
      }
      return c;
    }
    if (!c.lastName || !c.firstName) return c;
    const w = best("person", `${c.lastName}\u0000${c.firstName}`);
    if (!w) return c;
    const [lastName, firstName] = w.split("\u0000") as [string, string];
    changed.push(`${firstName} ${lastName}`);
    return { ...c, lastName, firstName };
  });
  const fields = { ...item.fields };
  for (const f of SPELLED_FIELDS) {
    const v = fields[f];
    if (!v) continue;
    const w = best("field", v);
    if (w) {
      fields[f] = w;
      changed.push(w);
    }
  }
  return changed.length ? { item: { ...item, creators, fields }, changed } : { item, changed };
}

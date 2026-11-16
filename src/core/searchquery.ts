/**
 * Advanced search and saved searches, as in Zotero: a list of conditions
 * (field, operator, value) joined by "all" or "any".
 */
import { descendants } from "./library.js";
import { fold } from "./search.js";
import { type Collection, type Item, creatorFull, noteText, titleOf, yearOf } from "./zotero.js";

export type Op = "contains" | "doesNotContain" | "is" | "isNot" | "isBefore" | "isAfter" | "isInTheLast";

export interface Condition {
  field: string;
  op: Op;
  value: string;
}

export interface SavedSearch {
  key: string;
  name: string;
  mode: "all" | "any";
  conditions: Condition[];
}

/** Searchable fields, Turkish labels; "field:<name>" searches one Zotero field. */
export const SEARCH_FIELDS: readonly (readonly [string, string])[] = [
  ["any", "Bütün alanlar ve notlar"],
  ["title", "Başlık"],
  ["creator", "Kişi (yazar, muhakkik…)"],
  ["year", "Yıl"],
  ["itemType", "Kaynak türü"],
  ["tag", "Etiket"],
  ["collection", "Koleksiyon"],
  ["note", "Not"],
  ["publicationTitle", "Yayın / dergi / kitap adı"],
  ["publisher", "Yayınevi"],
  ["place", "Basım yeri"],
  ["abstractNote", "Özet"],
  ["extra", "Ekstra"],
  ["dateAdded", "Eklenme tarihi"],
  ["dateModified", "Değişiklik tarihi"],
  ["attachment", "Ek dosya / bağlantı adı"],
];

export const OPS: Record<Op, string> = {
  contains: "içerir",
  doesNotContain: "içermez",
  is: "eşittir",
  isNot: "eşit değildir",
  isBefore: "önce",
  isAfter: "sonra",
  isInTheLast: "son … gün içinde",
};

export function opsFor(field: string): Op[] {
  if (field === "dateAdded" || field === "dateModified") return ["isBefore", "isAfter", "isInTheLast"];
  if (field === "year") return ["is", "isNot", "isBefore", "isAfter"];
  if (field === "itemType" || field === "collection") return ["is", "isNot"];
  if (field === "tag") return ["is", "isNot", "contains", "doesNotContain"];
  return ["contains", "doesNotContain", "is", "isNot"];
}

function values(item: Item, field: string, collections: readonly Collection[]): string[] {
  const f = item.fields;
  switch (field) {
    case "any":
      return [...Object.values(f), ...item.creators.map(creatorFull), ...item.tags.map((t) => t.tag), ...item.notes.map((n) => noteText(n.note)), ...(item.attachments ?? []).map((a) => a.title)];
    case "title":
      return [titleOf(item), f.shortTitle ?? ""];
    case "creator":
      return item.creators.map(creatorFull);
    case "year":
      return [yearOf(item).split("/").pop() ?? ""];
    case "itemType":
      return [item.itemType];
    case "tag":
      return item.tags.map((t) => t.tag);
    case "collection":
      return item.collections.flatMap((k) => [k, ...collections.filter((c) => c.key === k).map((c) => c.name)]);
    case "note":
      return item.notes.map((n) => noteText(n.note));
    case "publicationTitle":
      return [f.publicationTitle, f.bookTitle, f.encyclopediaTitle, f.dictionaryTitle, f.proceedingsTitle, f.websiteTitle, f.blogTitle, f.forumTitle].filter((x): x is string => Boolean(x));
    case "publisher":
      return [f.publisher, f.university, f.institution, f.label, f.company, f.studio, f.network, f.distributor].filter((x): x is string => Boolean(x));
    case "dateAdded":
      return [item.dateAdded];
    case "dateModified":
      return [item.dateModified];
    case "attachment":
      return (item.attachments ?? []).map((a) => `${a.title} ${a.fileName ?? ""} ${a.url ?? ""}`);
    default:
      return [f[field] ?? ""];
  }
}

function test(item: Item, c: Condition, collections: readonly Collection[], nowMs: number): boolean {
  if (c.field === "collection" && (c.op === "is" || c.op === "isNot")) {
    const keys = new Set([c.value, ...descendants(c.value, collections)]);
    const inside = item.collections.some((k) => keys.has(k));
    return c.op === "is" ? inside : !inside;
  }
  const vals = values(item, c.field, collections).map(fold);
  const v = fold(c.value);
  switch (c.op) {
    case "contains":
      return vals.some((x) => x.includes(v));
    case "doesNotContain":
      return !vals.some((x) => x.includes(v));
    case "is":
      return vals.some((x) => x === v);
    case "isNot":
      return !vals.some((x) => x === v);
    case "isBefore":
      return vals.some((x) => x !== "" && x < v);
    case "isAfter":
      return vals.some((x) => x !== "" && x > v);
    case "isInTheLast": {
      const days = Number(c.value) || 0;
      const since = new Date(nowMs - days * 86400000).toISOString();
      return values(item, c.field, collections).some((x) => x >= since);
    }
  }
}

export function matches(item: Item, s: Pick<SavedSearch, "mode" | "conditions">, collections: readonly Collection[] = [], nowMs = Date.now()): boolean {
  const conds = s.conditions.filter((c) => c.value.trim() !== "" || c.op === "isNot" || c.op === "doesNotContain");
  if (!conds.length) return true;
  return s.mode === "all" ? conds.every((c) => test(item, c, collections, nowMs)) : conds.some((c) => test(item, c, collections, nowMs));
}

/** One-line summary for lists: "Başlık içerir 'kelâm' ve Yıl önce 1990". */
export function describe(s: Pick<SavedSearch, "mode" | "conditions">): string {
  const label = new Map(SEARCH_FIELDS);
  return s.conditions.map((c) => `${label.get(c.field) ?? c.field} ${OPS[c.op]} "${c.value}"`).join(s.mode === "all" ? " ve " : " veya ");
}

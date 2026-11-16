/**
 * The library travels inside the Word document: a compressed copy is kept in
 * a custom XML part, so clearing Office's add-in cache, re-adding the add-in
 * or moving to another computer never loses it.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import type { SavedSearch } from "./searchquery.js";
import type { Collection, Item } from "./zotero.js";

export const LIBRARY_NS = "https://apoyraz58-max.github.io/derkenar/library";

export interface LibraryCopy {
  v: 1;
  saved: string;
  items: Item[];
  collections: Collection[];
  searches: SavedSearch[];
  tagColors: { tag: string; color: string }[];
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function packLibrary(copy: Omit<LibraryCopy, "v" | "saved">): string {
  const data: LibraryCopy = { v: 1, saved: new Date().toISOString(), ...copy };
  const b64 = toBase64(gzipSync(strToU8(JSON.stringify(data)), { level: 9 }));
  return `<derkenar xmlns="${LIBRARY_NS}" v="1">${b64}</derkenar>`;
}

export function unpackLibrary(xml: string): LibraryCopy | null {
  const m = /<derkenar[^>]*>([A-Za-z0-9+/=\s]+)<\/derkenar>/.exec(xml);
  if (!m) return null;
  try {
    const data = JSON.parse(strFromU8(gunzipSync(fromBase64(m[1]!.replace(/\s+/g, ""))))) as LibraryCopy;
    return data.v === 1 && Array.isArray(data.items) ? data : null;
  } catch {
    return null;
  }
}

/** Union by key; the newer dateModified wins (items), the copy fills what the library lacks. */
export function mergeLibrary(
  local: { items: Item[]; collections: Collection[]; searches: SavedSearch[] },
  copy: LibraryCopy,
): { items: Item[]; collections: Collection[]; searches: SavedSearch[]; added: number; updated: number } {
  const items = new Map(local.items.map((i) => [i.key, i]));
  let added = 0;
  let updated = 0;
  for (const it of copy.items) {
    const mine = items.get(it.key);
    if (!mine) {
      items.set(it.key, it);
      added++;
    } else if (it.dateModified > mine.dateModified) {
      items.set(it.key, it);
      updated++;
    }
  }
  const byKey = <T extends { key: string }>(a: T[], b: T[]) => {
    const m = new Map(a.map((x) => [x.key, x]));
    for (const x of b) if (!m.has(x.key)) m.set(x.key, x);
    return [...m.values()];
  };
  return { items: [...items.values()], collections: byKey(local.collections, copy.collections), searches: byKey(local.searches, copy.searches), added, updated };
}

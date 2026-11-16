/**
 * The library in the add-in's own browser storage (IndexedDB): items,
 * collections and small settings. Loaded into memory at start; every change
 * is written through at once, so nothing waits on storage while searching.
 */
import type { Collection, Item } from "../core/zotero.js";

const DB = "derkenar";
const STORES = ["items", "collections", "meta"] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("items", { keyPath: "key" });
      req.result.createObjectStore("collections", { keyPath: "key" });
      req.result.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Tarayıcı deposu (IndexedDB) kullanılamıyor."));
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Depo hatası"));
    tx.onabort = () => reject(tx.error ?? new Error("Depo işlemi durdu"));
  });
}

async function all<T>(store: StoreName): Promise<T[]> {
  try {
    const db = await open();
    return await new Promise<T[]>((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export const loadItems = () => all<Item>("items");
export const loadCollections = () => all<Collection>("collections");

/** Puts and deletes in one transaction. */
export async function write(store: "items" | "collections", put: readonly (Item | Collection)[], remove: readonly string[] = []): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const s = tx.objectStore(store);
  for (const x of put) s.put(x);
  for (const k of remove) s.delete(k);
  await done(tx);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction("meta").objectStore("meta").get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction("meta", "readwrite");
  if (value === undefined) tx.objectStore("meta").delete(key);
  else tx.objectStore("meta").put(value, key);
  await done(tx);
}

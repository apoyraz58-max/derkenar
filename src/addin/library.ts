/**
 * The user's library in the add-in's own browser storage (IndexedDB), loaded
 * into memory at start so search never waits on storage or the network.
 */
import type { LibraryItem } from "../core/types.js";

const DB = "derkenar";
const ITEMS = "items";
const META = "meta";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ITEMS, { keyPath: "key" });
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB kullanılamıyor"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB hatası"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB işlemi durdu"));
  });
}

export async function loadItems(): Promise<LibraryItem[]> {
  try {
    const db = await open();
    try {
      return await new Promise<LibraryItem[]>((resolve, reject) => {
        const req = db.transaction(ITEMS).objectStore(ITEMS).getAll();
        req.onsuccess = () => resolve(req.result as LibraryItem[]);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** Adds or replaces items and removes the given keys, in one transaction. */
export async function saveItems(put: readonly LibraryItem[], remove: readonly string[] = []): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(ITEMS, "readwrite");
    const store = tx.objectStore(ITEMS);
    for (const item of put) store.put(item);
    for (const key of remove) store.delete(key);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Removes every item from one source ("zotero:users/1", "file:a.bib"). */
export async function removeSource(source: string, all: readonly LibraryItem[]): Promise<void> {
  await saveItems([], all.filter((i) => i.source === source).map((i) => i.key));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const req = db.transaction(META).objectStore(META).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(META, "readwrite");
    if (value === undefined) tx.objectStore(META).delete(key);
    else tx.objectStore(META).put(value, key);
    await done(tx);
  } finally {
    db.close();
  }
}

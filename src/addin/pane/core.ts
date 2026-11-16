/**
 * Shared pane state and helpers: the library in memory, the document state,
 * the CSL renderer, messages, and a queue that keeps Word operations in order.
 */
import { DEFAULT_STYLE } from "../../core/docstate.js";
import { Renderer } from "../../core/engine.js";
import { SearchIndex } from "../../core/search.js";
import { BUILTIN_STYLES } from "../../core/styles.js";
import type { CiteRef, DocState } from "../../core/types.js";
import type { SavedSearch } from "../../core/searchquery.js";
import { type Collection, type Item, now } from "../../core/zotero.js";
import * as store from "../store.js";
import * as word from "../word.js";

export const S = {
  items: [] as Item[],
  byKey: new Map<string, Item>(),
  index: new SearchIndex(),
  collections: [] as Collection[],
  searches: [] as SavedSearch[],
  /** Zotero-style colored tags: tag → color, in order (keys 1–9 in Zotero). */
  tagColors: [] as { tag: string; color: string }[],
  doc: null as DocState | null,
  /** Citation being built or edited. */
  basket: [] as CiteRef[],
  editing: null as string | null,
  basketDirty: false,
  /** Items ticked in the library list. */
  selected: new Set<string>(),
  /** Library view value ("all", "c:KEY", "trash" …). */
  libView: "all",
};

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Small element builder: h("button", { class: "link", onclick }, "Sil"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") (el as unknown as Record<string, unknown>)[k] = v;
    else if (k === "class") el.className = String(v);
    else if (k === "value" || k === "checked" || k === "selected" || k === "hidden" || k === "disabled") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

export function setMessage(text: string, kind: "info" | "success" | "warning" | "error" = "info"): void {
  const m = $("message");
  m.textContent = text;
  m.className = `message ${kind}`;
  m.hidden = !text;
}

let busyCount = 0;
export async function run<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
  busyCount++;
  $("busy-text").textContent = `${label}…`;
  $("busy").hidden = false;
  try {
    return await task();
  } catch (e) {
    console.error(e);
    setMessage(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  } finally {
    if (--busyCount === 0) $("busy").hidden = true;
  }
}

/** Word operations run one at a time (the watcher must not interleave with an insert). */
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export function doc(): DocState {
  if (!S.doc) {
    S.doc = word.loadState();
    if (!S.doc.style) S.doc.style = DEFAULT_STYLE;
  }
  return S.doc;
}

// ---------------------------------------------------------------- views

const listeners = new Map<string, (() => void)[]>();
export function onShow(view: string, fn: () => void): void {
  listeners.set(view, [...(listeners.get(view) ?? []), fn]);
}

const scrolls = new Map<string, number>();
let current = "atif";

/** Switches the pane to a view; each view keeps its own scroll position. */
export function showView(name: string): void {
  if (name !== current) {
    scrolls.set(current, window.scrollY);
    current = name;
  }
  for (const v of ["atif", "kutuphane", "kaynak", "yeni", "belge", "denetim", "aktar", "veri", "yardim"]) {
    $(`view-${v}`).hidden = v !== name;
    const tab = document.getElementById(`tab-${v}`);
    tab?.setAttribute("aria-selected", String(v === name || ((name === "kaynak" || name === "yeni") && v === "kutuphane")));
  }
  for (const fn of listeners.get(name) ?? []) fn();
  window.scrollTo(0, scrolls.get(name) ?? 0);
}

// ---------------------------------------------------------------- library

const changeListeners: (() => void)[] = [];
export function onLibraryChange(fn: () => void): void {
  changeListeners.push(fn);
}

export function libraryChanged(): void {
  S.byKey = new Map(S.items.map((i) => [i.key, i]));
  S.index.reset(S.items.filter((i) => !i.deleted));
  for (const fn of changeListeners) fn();
  scheduleCopy();
}

// ---------------------------------------------------------------- library copy in the document

let copyTimer = 0;
let copyReady = false;
/** A few seconds after the last change, the document's library copy is refreshed. */
function scheduleCopy(): void {
  if (!copyReady || doc().keepLibrary === false) return;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => void saveLibraryCopy(), 4000);
}

export async function saveLibraryCopy(): Promise<void> {
  try {
    const { packLibrary } = await import("../../core/librarycopy.js");
    await word.writeLibraryCopy(packLibrary({ items: S.items, collections: S.collections, searches: S.searches, tagColors: S.tagColors }));
  } catch (e) {
    console.warn("Kütüphane belgeye yazılamadı", e);
  }
}

/**
 * Brings back what the document's copy has and this computer's storage lacks
 * (cleared cache, re-added add-in, another computer). Returns a message or "".
 */
async function restoreFromDocument(): Promise<string> {
  const xml = await word.readLibraryCopy().catch(() => null);
  if (!xml) return "";
  const { unpackLibrary, mergeLibrary } = await import("../../core/librarycopy.js");
  const copy = unpackLibrary(xml);
  if (!copy) return "";
  const merged = mergeLibrary({ items: S.items, collections: S.collections, searches: S.searches }, copy);
  if (!merged.added && !merged.updated && merged.collections.length === S.collections.length && merged.searches.length === S.searches.length) return "";
  const wasEmpty = S.items.length === 0;
  await store.write("items", merged.items);
  await store.write("collections", merged.collections);
  await store.write("searches", merged.searches);
  S.items = merged.items;
  S.collections = merged.collections;
  S.searches = merged.searches;
  if (!S.tagColors.length && copy.tagColors?.length) {
    S.tagColors = copy.tagColors;
    await store.setMeta("tagColors", S.tagColors);
  }
  return wasEmpty ? `Kütüphane bu belgedeki kopyadan geri yüklendi (${merged.items.length} kaynak).` : merged.added ? `Belgedeki kütüphane kopyasından ${merged.added} kaynak eklendi.` : "";
}

export async function loadLibrary(): Promise<void> {
  const [items, collections, searches, colors] = await Promise.all([store.loadItems(), store.loadCollections(), store.loadSearches(), store.getMeta<{ tag: string; color: string }[]>("tagColors")]);
  S.items = items;
  S.collections = collections;
  S.searches = searches;
  S.tagColors = colors ?? [];
  const restored = await restoreFromDocument();
  copyReady = true;
  libraryChanged();
  if (restored) setMessage(restored, "success");
  // Ask the browser not to evict the add-in's storage under disk pressure.
  void navigator.storage?.persist?.().catch(() => undefined);
}

/**
 * Adds or replaces items (and removes keys) in memory and storage. `local`:
 * the user changed them here, so Zotero items get the mark for "Zotero'ya gönder".
 */
export async function putItems(items: readonly Item[], remove: readonly string[] = [], local = false): Promise<void> {
  if (local) items = items.map((i) => (i.source.startsWith("zotero:") ? { ...i, dirty: true } : i));
  await store.write("items", items, remove);
  const map = new Map(S.items.map((i) => [i.key, i]));
  for (const k of remove) map.delete(k);
  for (const i of items) map.set(i.key, i);
  S.items = [...map.values()];
  libraryChanged();
}

/** A local change: new modification time, and Zotero items are marked for "Zotero'ya gönder". */
export function touched(item: Item): Item {
  return { ...item, dateModified: now(), ...(item.source.startsWith("zotero:") ? { dirty: true } : {}) };
}

export async function saveItem(item: Item): Promise<Item> {
  const next = touched(item);
  await putItems([next], [], true);
  return next;
}

export async function putCollections(collections: readonly Collection[], remove: readonly string[] = []): Promise<void> {
  await store.write("collections", collections, remove);
  const map = new Map(S.collections.map((c) => [c.key, c]));
  for (const k of remove) map.delete(k);
  for (const c of collections) map.set(c.key, c);
  S.collections = [...map.values()];
  libraryChanged();
}

export async function putSearches(searches: readonly SavedSearch[], remove: readonly string[] = []): Promise<void> {
  await store.write("searches", searches, remove);
  const map = new Map(S.searches.map((x) => [x.key, x]));
  for (const k of remove) map.delete(k);
  for (const x of searches) map.set(x.key, x);
  S.searches = [...map.values()];
  libraryChanged();
}

export async function setTagColors(colors: { tag: string; color: string }[]): Promise<void> {
  S.tagColors = colors;
  await store.setMeta("tagColors", colors);
  libraryChanged();
}

/** The item as the library has it, else the copy stored in the document. */
export function work(key: string): Item | undefined {
  return S.byKey.get(key) ?? doc().items[key];
}

// ---------------------------------------------------------------- styles and renderer

const textCache = new Map<string, Promise<string>>();
function fetchText(path: string): Promise<string> {
  let p = textCache.get(path);
  if (!p) {
    p = fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path} yüklenemedi (${r.status}).`);
      return r.text();
    });
    p.catch(() => textCache.delete(path));
    textCache.set(path, p);
  }
  return p;
}

const locales: Record<string, string> = {};
let rendererKey = "";
let renderer: Renderer | null = null;

export async function getRenderer(): Promise<Renderer> {
  const d = doc();
  const key = `${d.style}|${d.locale}`;
  if (renderer && rendererKey === key) return renderer;
  const [xml] = await Promise.all([
    fetchText(`styles/${d.style}.csl`),
    ...["tr-TR", "en-US"].map(async (l) => {
      locales[l] = await fetchText(`styles/locales-${l}.xml`);
    }),
  ]);
  renderer = new Renderer(xml, (l) => locales[l], d.locale);
  rendererKey = key;
  return renderer;
}

export function styleTitle(id: string): string {
  return BUILTIN_STYLES.find((s) => s.id === id)?.title ?? id;
}

export function renderSummary(): void {
  const live = S.items.filter((i) => !i.deleted).length;
  $("summary").textContent = `${styleTitle(doc().style)} · ${live} kaynak`;
}

/** Copies text to the clipboard (falls back to a hidden textarea inside Office). */
export async function copyText(text: string, html?: string): Promise<void> {
  try {
    if (html && "ClipboardItem" in window) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
      return;
    }
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h("textarea", { style: "position:fixed;left:-9999px" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function download(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

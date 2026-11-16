/**
 * Getting works into the library: Zotero exports (Zotero RDF, CSL JSON,
 * BibTeX/BibLaTeX, RIS), the Zotero web or local API, DOI and ISBN lookups.
 */
import type { CslItem } from "./types.js";
import { type Collection, type Item, emptyItem, fromCsl, fromZoteroData, textToNoteHtml, now } from "./zotero.js";

/** Stable short id from the work's content, for files without ids. */
export function contentKey(parts: readonly (string | undefined)[]): string {
  const basis = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) h = Math.imul(h ^ basis.charCodeAt(i), 16777619);
  return `K${(h >>> 0).toString(36).toUpperCase()}`.slice(0, 8).padEnd(8, "0");
}

/** Fixes what LaTeX conversion leaves behind ("ı̂" → "î") and drops converter internals. */
export function tidy(raw: Record<string, unknown>): CslItem {
  const item: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    item[k] = tidyValue(v);
  }
  if (!item.type) item.type = "document";
  return item as CslItem;
}

function tidyValue(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/ı(?=[̀-ͯ])/g, "i").normalize("NFC");
  if (Array.isArray(v)) return v.map(tidyValue);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = tidyValue(x);
    return o;
  }
  return v;
}

export type FileFormat = "zotero-rdf" | "csl-json" | "bibtex" | "ris" | "unknown";

export function detectFormat(text: string, fileName = ""): FileFormat {
  const t = text.replace(/^﻿/, "").trimStart();
  if (/\.rdf$/i.test(fileName) || /<rdf:RDF[\s>]/.test(t.slice(0, 2000))) return "zotero-rdf";
  if (/\.json$/i.test(fileName) || t.startsWith("[") || t.startsWith("{")) return "csl-json";
  if (/\.(bib|bibtex)$/i.test(fileName) || /^@\w+\s*[{(]/m.test(t)) return "bibtex";
  if (/\.(ris|txt)$/i.test(fileName) || /^TY {2}- /m.test(t)) return "ris";
  return "unknown";
}

export interface ImportResult {
  items: Item[];
  collections: Collection[];
  format: FileFormat;
}

/** Parses an export file. citation-js and the XML parser load only when needed. */
export async function parseFile(text: string, fileName: string): Promise<ImportResult> {
  const format = detectFormat(text, fileName);
  const source = `file:${fileName}`;
  if (format === "zotero-rdf") {
    const { parseZoteroRdf } = await import("./rdf.js");
    return { ...parseZoteroRdf(text, source), format };
  }
  let raw: Record<string, unknown>[];
  if (format === "csl-json") {
    const data = JSON.parse(text.replace(/^﻿/, "")) as unknown;
    const list = Array.isArray(data) ? data : ((data as { items?: unknown[] }).items ?? [data]);
    raw = list as Record<string, unknown>[];
  } else if (format === "bibtex" || format === "ris") {
    const { Cite } = await import("@citation-js/core");
    await import("@citation-js/plugin-bibtex");
    await import("@citation-js/plugin-ris");
    raw = (await Cite.async(text)).data as Record<string, unknown>[];
  } else {
    throw new Error("Dosya biçimi tanınmadı. Zotero RDF, CSL JSON, BibTeX (.bib) veya RIS (.ris) dosyası seçin.");
  }
  const items = raw.map((r) => {
    const csl = tidy(r);
    const given = typeof r["citation-key"] === "string" ? String(r["citation-key"]) : typeof r.id === "string" && !String(r.id).startsWith("temp_id") ? String(r.id) : "";
    const key = given ? keyFrom(given) : contentKey([csl.title, csl.author?.[0]?.family, JSON.stringify(csl.issued ?? ""), csl.DOI]);
    const item = fromCsl(csl, source, key);
    // RIS/BibTeX keywords become tags, notes become notes.
    const kw = r.keyword ?? r.keywords;
    if (typeof kw === "string") for (const t of kw.split(/[,;]\s*/).filter(Boolean)) item.tags.push({ tag: t });
    if (given && /\d/.test(given)) item.fields.citationKey ||= given;
    return item;
  });
  return { items, collections: [], format };
}

/** Zotero item keys are 8 characters; other ids are kept recognisable but safe. */
function keyFrom(id: string): string {
  const last = id.split("/").pop() ?? id;
  return /^[23456789A-Z]{8}$/.test(last) ? last : last.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40) || contentKey([id]);
}

// ---------------------------------------------------------------- Zotero API

export interface ZoteroConfig {
  /** "users/1234567" or "groups/98765". Local Zotero: "users/0". */
  readonly library: string;
  readonly apiKey?: string;
  /** https://api.zotero.org (default) or http://localhost:23119/api (Zotero 7, local API on). */
  readonly base?: string;
}

export interface ZoteroSync {
  readonly items: Item[];
  readonly deletedKeys: string[];
  readonly version: number;
  readonly collections: Collection[];
}

interface ZoteroObject {
  key: string;
  version: number;
  data: Record<string, unknown> & { itemType?: string; parentItem?: string; note?: string };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Zotero API objects → items, child notes attached to their parents. */
export function zoteroToItems(objects: readonly ZoteroObject[], library: string): Item[] {
  const source = `zotero:${library}`;
  const items = new Map<string, Item>();
  const notes: ZoteroObject[] = [];
  for (const o of objects) {
    const type = o.data.itemType;
    if (type === "attachment" || type === "annotation") continue;
    if (type === "note") {
      if (o.data.parentItem) notes.push(o);
      else {
        // Standalone note: kept as a document so nothing is lost.
        const item = emptyItem("document", source);
        item.key = o.key;
        item.fields.title = (o.data.note ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 80) || "Not";
        item.notes.push({ key: o.key, note: String(o.data.note ?? ""), dateModified: String(o.data.dateModified ?? now()) });
        item.tags.push({ tag: "_bağımsız not", type: 1 });
        items.set(o.key, item);
      }
      continue;
    }
    items.set(o.key, fromZoteroData({ ...o.data, key: o.key }, source, o.version));
  }
  for (const n of notes) {
    const parent = items.get(n.data.parentItem!);
    if (parent) parent.notes.push({ key: n.key, note: String(n.data.note ?? ""), dateModified: String(n.data.dateModified ?? now()) });
  }
  return [...items.values()];
}

/**
 * Downloads everything changed since `since` (0: the whole library), 100
 * objects per request, four requests at a time. Deleted items come back as keys.
 */
export async function syncZotero(cfg: ZoteroConfig, since: number, fetchFn: Fetch = fetch, onProgress?: (done: number, total: number) => void): Promise<ZoteroSync> {
  const base = (cfg.base ?? "https://api.zotero.org").replace(/\/$/, "");
  const root = `${base}/${cfg.library}`;
  const headers: Record<string, string> = { "Zotero-API-Version": "3" };
  if (cfg.apiKey) headers["Zotero-API-Key"] = cfg.apiKey;
  const get = async (path: string): Promise<Response> => {
    const r = await fetchFn(`${root}${path}`, { headers });
    if (r.status === 403) throw new Error("Zotero erişimi reddetti: API anahtarını ve kütüphane numarasını denetleyin.");
    if (!r.ok) throw new Error(`Zotero yanıt vermedi (${r.status}).`);
    return r;
  };
  const query = `format=json&include=data&limit=100&since=${since}`;
  const first = await get(`/items?${query}&start=0`);
  const total = Number(first.headers.get("Total-Results") ?? "0");
  const version = Number(first.headers.get("Last-Modified-Version") ?? since);
  const objects: ZoteroObject[] = [...((await first.json()) as ZoteroObject[])];
  onProgress?.(objects.length, total);
  const starts: number[] = [];
  for (let s = 100; s < total; s += 100) starts.push(s);
  for (let i = 0; i < starts.length; i += 4) {
    const batch = await Promise.all(starts.slice(i, i + 4).map(async (s) => (await (await get(`/items?${query}&start=${s}`)).json()) as ZoteroObject[]));
    for (const p of batch) objects.push(...p);
    onProgress?.(objects.length, total);
  }
  let deletedKeys: string[] = [];
  if (since > 0) {
    const d = (await (await get(`/deleted?since=${since}`)).json()) as { items?: string[] };
    deletedKeys = d.items ?? [];
  }
  const collections: Collection[] = [];
  try {
    for (let start = 0; ; start += 100) {
      const page = (await (await get(`/collections?format=json&limit=100&start=${start}`)).json()) as { key: string; data: { name: string; parentCollection?: string | false } }[];
      for (const x of page) collections.push({ key: x.key, name: x.data.name, ...(x.data.parentCollection ? { parentKey: x.data.parentCollection } : {}) });
      if (page.length < 100) break;
    }
  } catch {
    /* collections are optional */
  }
  return { items: zoteroToItems(objects, cfg.library), deletedKeys, version, collections };
}

// ---------------------------------------------------------------- DOI / ISBN

export function cleanDoi(text: string): string | null {
  const m = /10\.\d{4,9}\/[^\s"<>]+/i.exec(text.trim());
  return m ? m[0].replace(/[.,;)]+$/, "") : null;
}

export function cleanIsbn(text: string): string | null {
  const digits = text.replace(/[^0-9Xx]/g, "").toUpperCase();
  return digits.length === 10 || digits.length === 13 ? digits : null;
}

export async function lookupDoi(doi: string, fetchFn: Fetch = fetch): Promise<Item> {
  const r = await fetchFn(`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/vnd.citationstyles.csl+json`);
  if (!r.ok) throw new Error(`DOI bulunamadı (${doi}).`);
  const csl = tidy((await r.json()) as Record<string, unknown>);
  for (const k of ["reference", "license", "link", "funder", "assertion", "indexed", "deposited", "content-domain", "created", "member", "prefix", "score", "source", "references-count", "is-referenced-by-count", "relation", "subject", "update-policy", "published", "published-print", "published-online", "journal-issue"]) delete csl[k];
  return fromCsl(csl, "doi");
}

export async function lookupIsbn(isbn: string, fetchFn: Fetch = fetch): Promise<Item> {
  const r = await fetchFn(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) throw new Error(`ISBN bulunamadı (${isbn}).`);
  const data = ((await r.json()) as Record<string, OpenLibraryBook>)[`ISBN:${isbn}`];
  if (!data) throw new Error(`ISBN bulunamadı (${isbn}).`);
  const item = emptyItem("book", "isbn");
  item.fields.title = [data.title, data.subtitle].filter(Boolean).join(": ");
  item.creators = (data.authors ?? []).map((a) => ({ creatorType: "author", ...splitName(a.name) }));
  if (data.publishers?.[0]) item.fields.publisher = data.publishers[0].name;
  if (data.publish_places?.[0]) item.fields.place = data.publish_places[0].name;
  const y = /\d{4}/.exec(data.publish_date ?? "")?.[0];
  if (y) item.fields.date = y;
  if (data.number_of_pages) item.fields.numPages = String(data.number_of_pages);
  item.fields.ISBN = isbn;
  return item;
}

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: { name: string }[];
  publishers?: { name: string }[];
  publish_places?: { name: string }[];
  publish_date?: string;
  number_of_pages?: number;
}

/** "Ahmet Yılmaz" → Yılmaz / Ahmet; "Yılmaz, Ahmet" also works. */
export function splitName(name: string): { lastName?: string; firstName?: string; name?: string } {
  const n = name.trim();
  if (n.includes(",")) {
    const [family, ...given] = n.split(",");
    return { lastName: family!.trim(), firstName: given.join(",").trim() };
  }
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { name: n };
  const lastName = parts.pop()!;
  return { lastName, firstName: parts.join(" ") };
}

export { textToNoteHtml };

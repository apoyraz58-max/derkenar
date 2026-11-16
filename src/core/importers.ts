/**
 * Getting works into the library: Zotero (web or local API), CSL-JSON,
 * BibTeX/BibLaTeX and RIS files (Zotero, EndNote, Mendeley, Google Scholar
 * exports), DOI and ISBN lookups.
 */
import type { CslItem, CslName, LibraryItem } from "./types.js";

/** Stable short id from the work's content, for files without ids. */
export function contentKey(item: Partial<CslItem>): string {
  const basis = [item.title, item.author?.[0]?.family, JSON.stringify(item.issued ?? ""), item.DOI].join("|");
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) h = Math.imul(h ^ basis.charCodeAt(i), 16777619);
  return `k${(h >>> 0).toString(36)}`;
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

export type FileFormat = "csl-json" | "bibtex" | "ris" | "unknown";

export function detectFormat(text: string, fileName = ""): FileFormat {
  const t = text.replace(/^﻿/, "").trimStart();
  if (/\.json$/i.test(fileName) || t.startsWith("[") || t.startsWith("{")) return "csl-json";
  if (/\.(bib|bibtex)$/i.test(fileName) || /^@\w+\s*[{(]/m.test(t)) return "bibtex";
  if (/\.(ris|txt)$/i.test(fileName) || /^TY {2}- /m.test(t)) return "ris";
  return "unknown";
}

/** Parses an export file. citation-js is loaded only when a BibTeX/RIS file needs it. */
export async function parseFile(text: string, fileName: string): Promise<LibraryItem[]> {
  const format = detectFormat(text, fileName);
  const source = `file:${fileName}`;
  let raw: Record<string, unknown>[];
  if (format === "csl-json") {
    const data = JSON.parse(text.replace(/^﻿/, "")) as unknown;
    const list = Array.isArray(data) ? data : (data as { items?: unknown[] }).items ?? [data];
    raw = list as Record<string, unknown>[];
  } else if (format === "bibtex" || format === "ris") {
    const { Cite } = await import("@citation-js/core");
    await import("@citation-js/plugin-bibtex");
    await import("@citation-js/plugin-ris");
    raw = (await Cite.async(text)).data as Record<string, unknown>[];
  } else {
    throw new Error("Dosya biçimi tanınmadı. CSL JSON, BibTeX (.bib) veya RIS (.ris) dosyası seçin.");
  }
  return raw.map((r) => {
    const csl = tidy(r);
    const given = typeof r["citation-key"] === "string" ? (r["citation-key"] as string) : typeof r.id === "string" && !String(r.id).startsWith("temp_id") ? String(r.id) : "";
    const key = given || contentKey(csl);
    csl.id = key;
    return { key, csl, source };
  });
}

// ---------------------------------------------------------------- Zotero

export interface ZoteroConfig {
  /** "users/1234567" or "groups/98765". Local Zotero: "users/0". */
  readonly library: string;
  readonly apiKey?: string;
  /** https://api.zotero.org (default) or http://localhost:23119/api (Zotero 7, local API on). */
  readonly base?: string;
}

export interface ZoteroPage {
  readonly items: LibraryItem[];
  readonly deletedKeys: string[];
  readonly version: number;
  readonly collections: Record<string, string>;
}

interface ZoteroObject {
  key: string;
  version: number;
  data?: { itemType?: string; collections?: string[]; tags?: { tag: string }[]; parentItem?: string };
  csljson?: Record<string, unknown>;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function headers(cfg: ZoteroConfig): Record<string, string> {
  const h: Record<string, string> = { "Zotero-API-Version": "3" };
  if (cfg.apiKey) h["Zotero-API-Key"] = cfg.apiKey;
  return h;
}

const SKIP_TYPES = new Set(["attachment", "note", "annotation"]);

export function zoteroToLibrary(objects: readonly ZoteroObject[], library: string): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const o of objects) {
    if (!o.csljson || SKIP_TYPES.has(o.data?.itemType ?? "")) continue;
    const csl = tidy(o.csljson);
    csl.id = o.key;
    out.push({
      key: o.key,
      csl,
      source: `zotero:${library}`,
      collections: o.data?.collections ?? [],
      tags: (o.data?.tags ?? []).map((t) => t.tag),
      version: o.version,
    });
  }
  return out;
}

/**
 * Downloads everything changed since `since` (0: the whole library), 100 items
 * per request, several requests at a time. Deleted items come back as keys.
 */
export async function syncZotero(cfg: ZoteroConfig, since: number, fetchFn: Fetch = fetch, onProgress?: (done: number, total: number) => void): Promise<ZoteroPage> {
  const base = (cfg.base ?? "https://api.zotero.org").replace(/\/$/, "");
  const root = `${base}/${cfg.library}`;
  const h = headers(cfg);
  const get = async (path: string): Promise<Response> => {
    const r = await fetchFn(`${root}${path}`, { headers: h });
    if (r.status === 403) throw new Error("Zotero erişimi reddetti: API anahtarını ve kütüphane numarasını denetleyin.");
    if (!r.ok) throw new Error(`Zotero yanıt vermedi (${r.status}).`);
    return r;
  };
  const query = `format=json&include=data,csljson&limit=100&since=${since}`;
  const first = await get(`/items?${query}&start=0`);
  const total = Number(first.headers.get("Total-Results") ?? "0");
  const version = Number(first.headers.get("Last-Modified-Version") ?? since);
  const pages: ZoteroObject[][] = [(await first.json()) as ZoteroObject[]];
  onProgress?.(pages[0]!.length, total);
  const starts: number[] = [];
  for (let s = 100; s < total; s += 100) starts.push(s);
  let done = pages[0]!.length;
  for (let i = 0; i < starts.length; i += 4) {
    const batch = await Promise.all(
      starts.slice(i, i + 4).map(async (s) => (await (await get(`/items?${query}&start=${s}`)).json()) as ZoteroObject[]),
    );
    for (const p of batch) {
      pages.push(p);
      done += p.length;
    }
    onProgress?.(done, total);
  }
  let deletedKeys: string[] = [];
  if (since > 0) {
    const d = (await (await get(`/deleted?since=${since}`)).json()) as { items?: string[] };
    deletedKeys = d.items ?? [];
  }
  const collections: Record<string, string> = {};
  try {
    const c = (await (await get(`/collections?format=json&limit=100`)).json()) as { key: string; data: { name: string } }[];
    for (const x of c) collections[x.key] = x.data.name;
  } catch {
    /* collections are optional */
  }
  return { items: zoteroToLibrary(pages.flat(), cfg.library), deletedKeys, version, collections };
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

export async function lookupDoi(doi: string, fetchFn: Fetch = fetch): Promise<LibraryItem> {
  const r = await fetchFn(`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/vnd.citationstyles.csl+json`);
  if (!r.ok) throw new Error(`DOI bulunamadı (${doi}).`);
  const csl = tidy((await r.json()) as Record<string, unknown>);
  for (const k of ["reference", "license", "link", "funder", "assertion", "indexed", "deposited", "content-domain", "created"]) delete csl[k];
  const key = `doi:${doi.toLowerCase()}`;
  csl.id = key;
  return { key, csl, source: "doi" };
}

export async function lookupIsbn(isbn: string, fetchFn: Fetch = fetch): Promise<LibraryItem> {
  const r = await fetchFn(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) throw new Error(`ISBN bulunamadı (${isbn}).`);
  const data = ((await r.json()) as Record<string, OpenLibraryBook>)[`ISBN:${isbn}`];
  if (!data) throw new Error(`ISBN bulunamadı (${isbn}).`);
  const key = `isbn:${isbn}`;
  const csl: CslItem = {
    id: key,
    type: "book",
    title: [data.title, data.subtitle].filter(Boolean).join(": "),
    author: (data.authors ?? []).map((a) => splitName(a.name)),
    publisher: data.publishers?.[0]?.name,
    "publisher-place": data.publish_places?.[0]?.name,
    ISBN: isbn,
  };
  const y = /\d{4}/.exec(data.publish_date ?? "")?.[0];
  if (y) csl.issued = { "date-parts": [[Number(y)]] };
  if (data.number_of_pages) csl["number-of-pages"] = String(data.number_of_pages);
  return { key, csl: tidy(csl as unknown as Record<string, unknown>), source: "isbn" };
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

/** "Ahmet Yılmaz" → {given: "Ahmet", family: "Yılmaz"}; "Yılmaz, Ahmet" also works. */
export function splitName(name: string): CslName {
  const n = name.trim();
  if (n.includes(",")) {
    const [family, ...given] = n.split(",");
    return { family: family!.trim(), given: given.join(",").trim() };
  }
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { literal: n };
  const family = parts.pop()!;
  return { family, given: parts.join(" ") };
}

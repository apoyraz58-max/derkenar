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
    throw new Error("Dosya biçimi tanınmadı. RDF, CSL JSON, BibTeX (.bib) veya RIS (.ris) dosyası seçin.");
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
  const attachments: ZoteroObject[] = [];
  for (const o of objects) {
    const type = o.data.itemType;
    if (type === "annotation") continue;
    if (type === "attachment") {
      if (o.data.parentItem) attachments.push(o);
      continue;
    }
    if (type === "note") {
      if (o.data.parentItem) notes.push(o);
      else {
        // Standalone note.
        const item = emptyItem("note", source);
        item.key = o.key;
        item.version = o.version;
        item.notes.push({ key: o.key, note: String(o.data.note ?? ""), dateModified: String(o.data.dateModified ?? now()) });
        item.tags = ((o.data.tags as { tag: string; type?: number }[] | undefined) ?? []).map((t) => ({ tag: t.tag, ...(t.type ? { type: t.type } : {}) }));
        item.collections = (o.data.collections as string[] | undefined) ?? [];
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
  // Linked URLs come along; Zotero's stored files stay in Zotero (their link is kept).
  for (const a of attachments) {
    const parent = items.get(a.data.parentItem!);
    if (!parent) continue;
    const url = String(a.data.url ?? "");
    const mode = String(a.data.linkMode ?? "");
    (parent.attachments ??= []).push({
      key: a.key,
      kind: "link",
      title: String(a.data.title ?? (url || "Ek")),
      url: url || (mode.startsWith("imported") ? `zotero://select/library/items/${a.key}` : undefined),
      contentType: a.data.contentType ? String(a.data.contentType) : undefined,
      dateAdded: String(a.data.dateAdded ?? now()),
    });
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
    if (r.status === 403) throw new Error("Çevrimiçi kütüphane erişimi reddetti: API anahtarını ve kütüphane numarasını denetleyin.");
    if (!r.ok) throw new Error(`Çevrimiçi kütüphane yanıt vermedi (${r.status}).`);
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

/** CSL types other services use for the same thing ("monograph", "book-chapter" …). */
const CSL_TYPE_ALIASES: Record<string, string> = {
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  "book-set": "book",
  "book-series": "book",
  "book-chapter": "chapter",
  "book-section": "chapter",
  "book-part": "chapter",
  "reference-entry": "entry-encyclopedia",
  "journal-article": "article-journal",
  "proceedings-article": "paper-conference",
  dissertation: "thesis",
  "posted-content": "article",
  "report-component": "report",
};

/** Lists where CSL wants text (Crossref sends ISBN, title, container-title as arrays). */
function flattenCsl(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = k === "ISBN" || k === "ISSN" ? [...new Set(v)].join(", ") : v[0];
    else out[k] = v;
  }
  const type = String(out.type ?? "");
  if (CSL_TYPE_ALIASES[type]) out.type = CSL_TYPE_ALIASES[type];
  return out;
}

/**
 * DOI → item. DOIs are registered by several agencies: Crossref (most
 * journals, DergiPark), DataCite (many books, theses, datasets), mEDRA and
 * others. Crossref is asked first, then doi.org's content negotiation (which
 * answers for every agency), then DataCite directly.
 */
export async function lookupDoi(doi: string, fetchFn: Fetch = fetch): Promise<Item> {
  const csl = "application/vnd.citationstyles.csl+json";
  const tries: [string, RequestInit | undefined][] = [
    [`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/${csl}`, undefined],
    [`https://doi.org/${encodeURI(doi)}`, { headers: { Accept: csl } }],
    [`https://api.datacite.org/dois/${csl}/${encodeURIComponent(doi)}`, undefined],
  ];
  let reached = false;
  for (const [url, init] of tries) {
    try {
      const r = await fetchFn(url, init);
      reached = true;
      if (!r.ok) continue;
      const data = (await r.json()) as Record<string, unknown>;
      if (!data || typeof data !== "object" || (!data.title && !data.type)) continue;
      const item = tidy(flattenCsl(data));
      for (const k of ["reference", "license", "link", "funder", "assertion", "indexed", "deposited", "content-domain", "created", "member", "prefix", "score", "source", "references-count", "is-referenced-by-count", "relation", "subject", "update-policy", "published", "published-print", "published-online", "journal-issue", "original-title", "short-title", "alternative-id", "isbn-type", "issn-type", "id"]) delete item[k];
      item.type ??= "document";
      const result = fromCsl({ ...item, id: "" }, "doi");
      result.fields.DOI ||= doi;
      if (!result.fields.title) continue;
      return result;
    } catch {
      /* next service */
    }
  }
  throw new Error(reached ? `DOI hiçbir kayıt kuruluşunda bulunamadı (${doi}). Numarayı denetleyin; kitabın DOI'si yoksa ISBN ile deneyin.` : `DOI servislerine ulaşılamadı (${doi}): internet bağlantısını denetleyin.`);
}

/** ISBN: Open Library first, Google Books when Open Library does not know the book (common for Turkish books). */
/** ISBN → book: several catalogues at once (see isbn.ts). */
export async function lookupIsbn(isbn: string, fetchFn: Fetch = fetch, googleKey?: string): Promise<Item> {
  const { lookupIsbnAll } = await import("./isbn.js");
  return lookupIsbnAll(isbn, { fetchFn, googleKey });
}

/** PubMed id → item (NCBI E-utilities). */
export async function lookupPmid(pmid: string, fetchFn: Fetch = fetch): Promise<Item> {
  const r = await fetchFn(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmid}`);
  const d = r.ok ? ((await r.json()) as { result?: Record<string, PubmedSummary> }).result?.[pmid] : undefined;
  if (!d || !d.title) throw new Error(`PMID bulunamadı (${pmid}).`);
  const item = emptyItem("journalArticle", "pmid");
  item.fields.title = d.title.replace(/\.$/, "");
  item.creators = (d.authors ?? []).filter((a) => a.authtype === "Author").map((a) => {
    const [last, ...ini] = a.name.split(" ");
    return { creatorType: "author", lastName: last!, firstName: ini.join(" ") };
  });
  item.fields.publicationTitle = d.fulljournalname ?? d.source ?? "";
  if (d.volume) item.fields.volume = d.volume;
  if (d.issue) item.fields.issue = d.issue;
  if (d.pages) item.fields.pages = d.pages;
  if (d.pubdate) item.fields.date = d.pubdate.slice(0, 4);
  const doi = d.articleids?.find((x) => x.idtype === "doi")?.value;
  if (doi) item.fields.DOI = doi;
  item.fields.extra = `PMID: ${pmid}`;
  return item;
}

interface PubmedSummary {
  title?: string;
  authors?: { name: string; authtype: string }[];
  fulljournalname?: string;
  source?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  pubdate?: string;
  articleids?: { idtype: string; value: string }[];
}

/** arXiv id ("2101.01234", "arXiv:hep-th/9901001") → preprint. */
export async function lookupArxiv(id: string, fetchFn: Fetch = fetch): Promise<Item> {
  const r = await fetchFn(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
  const xml = r.ok ? await r.text() : "";
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  const tag = (t: string, s = entry ?? ""): string | undefined => new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(s)?.[1]?.replace(/\s+/g, " ").trim();
  if (!entry || !tag("title")) throw new Error(`arXiv kaydı bulunamadı (${id}).`);
  const item = emptyItem("preprint", "arxiv");
  item.fields.title = tag("title")!;
  item.creators = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) => ({ creatorType: "author", ...splitName(m[1]!) }));
  const published = tag("published");
  if (published) item.fields.date = published.slice(0, 10);
  const summary = tag("summary");
  if (summary) item.fields.abstractNote = summary;
  item.fields.repository = "arXiv";
  item.fields.archiveID = `arXiv:${id}`;
  item.fields.url = `https://arxiv.org/abs/${id}`;
  return item;
}

export function cleanPmid(text: string): string | null {
  return /^\s*(?:pmid:?\s*)?(\d{5,9})\s*$/i.exec(text)?.[1] ?? null;
}

export function cleanArxiv(text: string): string | null {
  return /(?:arxiv:|arxiv\.org\/abs\/)\s*([\w.\/-]+?)(?:v\d+)?\s*$/i.exec(text.trim())?.[1] ?? (/^\s*(\d{4}\.\d{4,5})(v\d+)?\s*$/.exec(text)?.[1] ?? null);
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

// ---------------------------------------------------------------- write back to Zotero

export interface PushResult {
  /** Items Zotero accepted, with their new version and the dirty mark cleared. */
  readonly saved: Item[];
  readonly failed: { key: string; message: string }[];
  readonly version: number;
}

/**
 * Sends changed and new items to the Zotero library (needs an API key with
 * write access). Each item carries the version it was synced at: when the
 * item changed in Zotero meanwhile, Zotero refuses it (412) and it is reported,
 * never overwritten. Child notes and files stay where they are.
 */
export async function pushToZotero(cfg: ZoteroConfig, items: readonly Item[], zoteroCollections: ReadonlySet<string>, fetchFn: Fetch = fetch): Promise<PushResult> {
  const { toZoteroData } = await import("./zotero.js");
  const base = (cfg.base ?? "https://api.zotero.org").replace(/\/$/, "");
  const headers: Record<string, string> = { "Zotero-API-Version": "3", "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Zotero-API-Key"] = cfg.apiKey;
  const saved: Item[] = [];
  const failed: { key: string; message: string }[] = [];
  let version = 0;
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const body = batch.map((item) => {
      const data: Record<string, unknown> =
        item.itemType === "note"
          ? { key: item.key, itemType: "note", note: item.notes[0]?.note ?? "", tags: item.tags, collections: item.collections }
          : { ...toZoteroData(item) };
      delete data.dateAdded;
      delete data.dateModified;
      data.collections = ((data.collections as string[]) ?? []).filter((c) => zoteroCollections.has(c));
      data.version = item.version ?? 0;
      return data;
    });
    const r = await fetchFn(`${base}/${cfg.library}/items`, { method: "POST", headers, body: JSON.stringify(body) });
    if (r.status === 403) throw new Error("Çevrimiçi kütüphane yazmayı reddetti: API anahtarına yazma izni verin (hesap ayarları → Settings → Security → anahtarı düzenle → 'Allow write access').");
    if (!r.ok) throw new Error(`Çevrimiçi kütüphane yanıt vermedi (${r.status}).`);
    version = Number(r.headers.get("Last-Modified-Version") ?? version);
    const res = (await r.json()) as { successful?: Record<string, { key: string; version: number }>; unchanged?: Record<string, string>; failed?: Record<string, { key?: string; code: number; message: string }> };
    batch.forEach((item, j) => {
      const ok = res.successful?.[String(j)];
      const same = res.unchanged?.[String(j)];
      const bad = res.failed?.[String(j)];
      if (ok || same) {
        const { dirty: _d, ...rest } = item;
        saved.push({ ...rest, version: ok?.version ?? version ?? item.version, source: `zotero:${cfg.library}` });
      } else if (bad) {
        failed.push({ key: item.key, message: bad.code === 412 ? "Çevrimiçi kütüphanede de değişmiş; önce alın, sonra yeniden gönderin." : bad.message });
      }
    });
  }
  return { saved, failed, version };
}

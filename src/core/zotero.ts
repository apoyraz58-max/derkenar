/**
 * Derkenar's item model is Zotero's (item types, fields, creators, tags,
 * notes, collections, relations), driven by Zotero's own data schema, plus
 * the roles İSNAD needs and Zotero lacks: muhakkik, nâşir, hazırlayan,
 * sadeleştiren. Conversion to CSL-JSON follows Zotero's schema mappings.
 */
import schemaJson from "./zschema.json";
import type { CslDate, CslItem, CslName } from "./types.js";

interface Schema {
  version: number;
  itemTypes: { itemType: string; fields: string[][]; creatorTypes: string[] }[];
  dateFields: string[];
  csl: { types: Record<string, string[]>; fields: { text: Record<string, string[]>; date: Record<string, string> }; names: Record<string, string> };
  labels: Record<"tr" | "en", { itemTypes: Record<string, string>; fields: Record<string, string>; creatorTypes: Record<string, string> }>;
}
const schema = schemaJson as unknown as Schema;
export const SCHEMA_VERSION = schema.version;

// ---------------------------------------------------------------- model

export interface Creator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** Single-field name (institution, or a name that must not be split). */
  name?: string;
}

export interface Tag {
  tag: string;
  /** 1: automatic (imported), absent: manual. */
  type?: number;
}

export interface Note {
  key: string;
  /** Simple HTML, as Zotero stores notes. */
  note: string;
  dateModified: string;
}

export interface Item {
  key: string;
  itemType: string;
  fields: Record<string, string>;
  creators: Creator[];
  tags: Tag[];
  collections: string[];
  /** Keys of related items. */
  relations: string[];
  notes: Note[];
  dateAdded: string;
  dateModified: string;
  deleted?: boolean;
  /** "zotero:users/1", "file:kutuphane.rdf", "doi", "isbn", "manual", "belge". */
  source: string;
  version?: number;
  /** Changed in Derkenar since the last Zotero sync (sent by "Zotero'ya gönder"). */
  dirty?: boolean;
  attachments?: Attachment[];
  /** İSNAD citation system chosen in the editor (hadis-bab, hadis-no, hadis-cilt, sozluk); empty: recognised. */
  citeMode?: string;
}

/** Zotero attachment: a link, or a file kept in the add-in's storage. */
export interface Attachment {
  key: string;
  kind: "link" | "file";
  title: string;
  url?: string;
  fileName?: string;
  contentType?: string;
  size?: number;
  dateAdded: string;
}

/** Standalone note (Zotero item type "note"): content in notes[0]. Not citable. */
export const NOTE_TYPE = "note";
export function isNoteItem(item: Item): boolean {
  return item.itemType === NOTE_TYPE;
}

export interface Collection {
  key: string;
  name: string;
  parentKey?: string;
}

// ---------------------------------------------------------------- İSNAD roles

/** Derkenar creator types → the CSL variables the İSNAD style prints as thk., nşr., haz., sad. */
export const ISNAD_ROLES: Record<string, { label: string; csl: string; extra: string[] }> = {
  muhakkik: { label: "Muhakkik (thk.)", csl: "collection-editor", extra: ["muhakkik", "thk", "tahkik"] },
  nasir: { label: "Nâşir (nşr.)", csl: "editorial-director", extra: ["nasir", "nâşir", "naşir", "nşr", "neşir"] },
  hazirlayan: { label: "Hazırlayan (haz.)", csl: "director", extra: ["hazirlayan", "hazırlayan", "haz"] },
  sadelestiren: { label: "Sadeleştiren (sad.)", csl: "reviewed-author", extra: ["sadelestiren", "sadeleştiren", "sad"] },
  muellif: { label: "Müellif (mlf.) — neşredilen eserin yazarı", csl: "original-author", extra: ["muellif", "müellif", "mlf"] },
};

/** Zotero creator types that the İSNAD style already prints as an İSNAD role. */
const ZOTERO_TO_ISNAD: Record<string, string> = { seriesEditor: "muhakkik" };

// ---------------------------------------------------------------- schema helpers

const typeIndex = new Map(schema.itemTypes.map((t) => [t.itemType, t]));

export function itemTypes(): string[] {
  return schema.itemTypes.map((t) => t.itemType);
}

export function itemTypeLabel(type: string, lang: "tr" | "en" = "tr"): string {
  return schema.labels[lang].itemTypes[type] ?? type;
}

/** Labels Zotero's Turkish locale leaves in English, and İSNAD wording. */
const TR_FIELDS: Record<string, string> = {
  originalDate: "Özgün Tarih (ilk baskı / telif)",
  originalPublisher: "Özgün Yayınevi",
  originalPlace: "Özgün Yayın Yeri",
  rights: "Haklar",
  eventPlace: "Etkinlik Yeri",
  partNumber: "Kısım Numarası",
  partTitle: "Kısım Başlığı",
  priorityDate: "Rüçhan Tarihi",
  sessionTitle: "Oturum Başlığı",
  extra: "Ekstra",
  archive: "Arşiv / Kütüphane",
  archiveLocation: "Arşivdeki Yeri (koleksiyon, demirbaş no)",
};

export function fieldLabel(field: string, lang: "tr" | "en" = "tr"): string {
  const own = lang === "tr" ? TR_FIELDS[field] : undefined;
  return own ?? schema.labels[lang].fields[field] ?? field;
}

export function creatorTypeLabel(type: string, lang: "tr" | "en" = "tr"): string {
  return ISNAD_ROLES[type]?.label ?? schema.labels[lang].creatorTypes[type] ?? type;
}

/** Fields of an item type in Zotero's order (title first). */
export function fieldsOf(type: string): string[] {
  return (typeIndex.get(type)?.fields ?? []).map((f) => f[0]!);
}

/** Zotero creator types of the item type, then the İSNAD roles. */
export function creatorTypesOf(type: string): string[] {
  const own = typeIndex.get(type)?.creatorTypes ?? ["author", "contributor"];
  return [...own, ...Object.keys(ISNAD_ROLES)];
}

export function isDateField(type: string, field: string): boolean {
  return schema.dateFields.includes(baseField(type, field));
}

/** Type-specific field → its base field (bookTitle → publicationTitle, university → publisher). */
export function baseField(type: string, field: string): string {
  const f = typeIndex.get(type)?.fields.find((x) => x[0] === field);
  return f?.[1] ?? field;
}

/** Base field → the field this item type uses for it (publisher → university for a thesis). */
export function typeField(type: string, base: string): string | null {
  const t = typeIndex.get(type);
  if (!t) return null;
  const f = t.fields.find((x) => x[0] === base || x[1] === base);
  return f ? f[0]! : null;
}

/** Changing the item type keeps every value that has a place in the new type. */
export function changeItemType(item: Item, newType: string): Item {
  const fields: Record<string, string> = {};
  const lost: string[] = [];
  for (const [f, v] of Object.entries(item.fields)) {
    const target = typeField(newType, baseField(item.itemType, f));
    if (target) fields[target] = v;
    else if (v) lost.push(`${f}: ${v}`);
  }
  if (lost.length) fields.extra = [fields.extra, ...lost].filter(Boolean).join("\n");
  const allowed = new Set(creatorTypesOf(newType));
  const creators = item.creators.map((c) => (allowed.has(c.creatorType) ? c : { ...c, creatorType: "contributor" }));
  return { ...item, itemType: newType, fields, creators };
}

// ---------------------------------------------------------------- keys and times

const KEY_CHARS = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
export function newKey(): string {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, (b) => KEY_CHARS[b % KEY_CHARS.length]).join("");
}

export function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function emptyItem(itemType = "book", source = "manual"): Item {
  const t = now();
  return { key: newKey(), itemType, fields: {}, creators: [], tags: [], collections: [], relations: [], notes: [], dateAdded: t, dateModified: t, source };
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Zotero date text → CSL date. Hicrî/milâdî pairs ("1413/1993") and other
 * forms İSNAD writes as they are stay literal.
 */
export function parseDate(text: string): CslDate | undefined {
  // İSNAD's Zotero guide writes such dates in quotes: issued: "1422/2001".
  const t = text.trim().replace(/^["“”'](.*)["“”']$/, "$1").trim();
  if (!t || /^(ts\.?|t\.y\.?|n\.d\.?)$/i.test(t)) return undefined;
  if (/^\d{1,4}$/.test(t)) return { "date-parts": [[Number(t)]] };
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ].*)?$/.exec(t);
  if (m) return { "date-parts": [[Number(m[1]), Number(m[2]), ...(m[3] ? [Number(m[3])] : [])]] };
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (m) return { "date-parts": [[Number(m[3]), Number(m[2]), Number(m[1])]] };
  m = /^(?:(\d{1,2})\s+)?([\p{L}]+)\.?\s+(\d{4})$/u.exec(t);
  if (m && MONTHS[m[2]!.toLocaleLowerCase("tr")]) {
    const parts = [Number(m[3]), MONTHS[m[2]!.toLocaleLowerCase("tr")]!];
    if (m[1]) parts.push(Number(m[1]));
    return { "date-parts": [parts] };
  }
  m = /^([\p{L}]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/u.exec(t);
  if (m && MONTHS[m[1]!.toLowerCase()]) return { "date-parts": [[Number(m[3]), MONTHS[m[1]!.toLowerCase()]!, Number(m[2])]] };
  return { literal: t };
}

export function formatCslDate(d: CslDate | undefined): string {
  if (!d) return "";
  const p = d["date-parts"]?.[0];
  if (p && p.length) return p.map((x, i) => (i === 0 ? String(x) : String(x).padStart(2, "0"))).join("-");
  return d.literal ?? d.raw ?? "";
}

export function yearOf(item: Item): string {
  const d = item.fields.date ?? "";
  return /\d{3,4}(?:\/\d{3,4})?/.exec(d)?.[0] ?? "";
}

// ---------------------------------------------------------------- Extra field

/**
 * Zotero's Extra field may carry CSL variables, one per line:
 * "editorial-director: Last || First", "original-date: 1323".
 * Derkenar also reads Turkish role names ("thk: Hâfız || Hamza").
 */
export interface ExtraParts {
  creators: Creator[];
  csl: Record<string, string>;
  rest: string;
}

const CSL_NAME_VARS = new Set([...Object.values(schema.csl.names), ...Object.values(ISNAD_ROLES).map((r) => r.csl), "author", "editor", "translator", "container-author", "collection-editor", "editorial-director", "director", "reviewed-author", "original-author", "compiler", "illustrator", "interviewer", "recipient"]);
const CSL_TEXT_VARS = new Set([...Object.keys(schema.csl.fields.text), ...Object.keys(schema.csl.fields.date), "type", "original-title", "original-publisher", "original-publisher-place", "event-date", "medium", "status"]);
const ROLE_BY_EXTRA = new Map<string, string>();
for (const [role, r] of Object.entries(ISNAD_ROLES)) {
  ROLE_BY_EXTRA.set(r.csl, role);
  for (const e of r.extra) ROLE_BY_EXTRA.set(e, role);
}
const CREATOR_BY_CSL = new Map<string, string>();
for (const [z, c] of Object.entries(schema.csl.names)) if (!CREATOR_BY_CSL.has(c)) CREATOR_BY_CSL.set(c, z);

function parseNameValue(value: string): Omit<Creator, "creatorType"> {
  if (value.includes("||")) {
    const [last, first] = value.split("||").map((s) => s.trim());
    return { lastName: last, firstName: first };
  }
  return { name: value.trim() };
}

export function parseExtra(extra: string | undefined): ExtraParts {
  const out: ExtraParts = { creators: [], csl: {}, rest: "" };
  if (!extra) return out;
  const rest: string[] = [];
  for (const line of extra.split(/\r?\n/)) {
    const m = /^\s*([\p{L}-]+)\s*:\s*(.+)$/u.exec(line);
    const key = m?.[1]?.toLocaleLowerCase("tr");
    if (m && key) {
      const role = ROLE_BY_EXTRA.get(key);
      if (role) {
        out.creators.push({ creatorType: role, ...parseNameValue(m[2]!) });
        continue;
      }
      if (CSL_NAME_VARS.has(key)) {
        out.creators.push({ creatorType: CREATOR_BY_CSL.get(key) ?? `csl:${key}`, ...parseNameValue(m[2]!) });
        continue;
      }
      if (CSL_TEXT_VARS.has(key)) {
        out.csl[key] = m[2]!.trim().replace(/^["“”](.*)["“”]$/, "$1");
        continue;
      }
    }
    rest.push(line);
  }
  out.rest = rest.join("\n").trim();
  return out;
}

/** Lines for Extra that let Zotero keep what it has no field for. */
export function extraLine(creator: Creator): string {
  const csl = ISNAD_ROLES[creator.creatorType]?.csl ?? creator.creatorType.replace(/^csl:/, "");
  const value = creator.name ?? `${creator.lastName ?? ""} || ${creator.firstName ?? ""}`;
  return `${csl}: ${value}`;
}

// ---------------------------------------------------------------- CSL conversion

const cslTypeOf = new Map<string, string>();
for (const [csl, types] of Object.entries(schema.csl.types)) for (const t of types) if (!cslTypeOf.has(t)) cslTypeOf.set(t, csl);
const cslTextVarsOf = new Map<string, string[]>();
for (const [csl, fields] of Object.entries(schema.csl.fields.text)) for (const f of fields) cslTextVarsOf.set(f, [...(cslTextVarsOf.get(f) ?? []), csl]);
const cslDateVarOf = new Map(Object.entries(schema.csl.fields.date).map(([csl, f]) => [f, csl]));

/** Roles printed in display order ("haz. Fuat Recep - Salih Kahriman"): a one-box name can be split safely. */
const DISPLAY_ROLES = new Set(["editor", "translator", "seriesEditor", "contributor", "bookAuthor", "muhakkik", "nasir", "hazirlayan", "sadelestiren", "muellif", "interviewer", "director"]);

function cslName(c: Creator): CslName {
  if (c.name !== undefined && DISPLAY_ROLES.has(c.creatorType)) {
    const parts = c.name.trim().split(/\s+/);
    if (parts.length > 1) return { family: parts.pop()!, given: parts.join(" ") };
  }
  if (c.name !== undefined || !c.firstName) return c.name !== undefined ? { literal: c.name } : { family: c.lastName ?? "" };
  return { family: c.lastName ?? "", given: c.firstName };
}

/**
 * Zotero prints the item type's primary creator (inventor of a patent,
 * programmer of software, artist, cartographer, director of a film…) as the
 * CSL author; the schema's name map lists only the shared roles.
 */
function cslNameVar(creatorType: string, itemType?: string): string {
  if (creatorType.startsWith("csl:")) return creatorType.slice(4);
  if (ISNAD_ROLES[creatorType]) return ISNAD_ROLES[creatorType]!.csl;
  if (itemType && typeIndex.get(itemType)?.creatorTypes[0] === creatorType) return "author";
  return schema.csl.names[creatorType] ?? "contributor";
}

/**
 * CSL types the İSNAD style was written for (its header: "Software → book
 * with version number"), where newer Zotero versions send another type.
 */
const ISNAD_CSL_TYPE: Record<string, string> = { software: "book" };

export function toCsl(item: Item): CslItem {
  const baseType = cslTypeOf.get(item.itemType) ?? "document";
  const csl: CslItem = { id: item.key, type: ISNAD_CSL_TYPE[baseType] ?? baseType };
  for (const [field, value] of Object.entries(item.fields)) {
    if (!value || field === "extra") continue;
    const base = baseField(item.itemType, field);
    const dateVar = cslDateVarOf.get(base);
    if (dateVar) {
      const d = parseDate(value);
      if (d) csl[dateVar] = d;
      continue;
    }
    for (const v of cslTextVarsOf.get(base) ?? []) csl[v] = value;
  }
  const extra = parseExtra(item.fields.extra);
  for (const c of [...item.creators, ...extra.creators]) {
    const v = cslNameVar(c.creatorType, item.itemType);
    ((csl[v] as CslName[] | undefined) ?? (csl[v] = [] as CslName[]) as CslName[]).push(cslName(c));
  }
  for (const [k, v] of Object.entries(extra.csl)) {
    if (schema.csl.fields.date[k] || /date$/.test(k)) {
      const d = parseDate(v);
      if (d) csl[k] = d;
    } else csl[k] = v;
  }
  // İSNAD's Zotero rule: the edited work's title in a tahkik/neşir article goes in "Series Text" (s. 109).
  if (["journalArticle", "magazineArticle", "newspaperArticle"].includes(item.itemType) && item.fields.seriesText && !csl["collection-title"]) csl["collection-title"] = item.fields.seriesText;
  if (extra.rest) csl.note = extra.rest;
  else delete csl.note;
  return csl;
}

const zoteroTypeOf = new Map(Object.entries(schema.csl.types).map(([csl, types]) => [csl, types[0]!]));
const zoteroFieldsOfCsl = schema.csl.fields.text;

/** CSL-JSON (from a file, DOI lookup, another program) → Derkenar item. */
export function fromCsl(csl: CslItem, source: string, key?: string): Item {
  const itemType = zoteroTypeOf.get(csl.type) ?? "document";
  const item = emptyItem(itemType, source);
  if (key) item.key = key;
  const extra: string[] = [];
  for (const [k, value] of Object.entries(csl)) {
    if (k === "id" || k === "type" || value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length && typeof value[0] === "object" && ("family" in value[0] || "literal" in value[0] || "given" in value[0])) {
      const role = ROLE_BY_EXTRA.get(k) ?? CREATOR_BY_CSL.get(k);
      const allowed = role && (ISNAD_ROLES[role] || creatorTypesOf(itemType).includes(role));
      for (const n of value as CslName[]) {
        const c: Creator = n.literal !== undefined ? { creatorType: "author", name: n.literal } : { creatorType: "author", lastName: [n["non-dropping-particle"], n.family].filter(Boolean).join(" "), firstName: [n.given, n["dropping-particle"]].filter(Boolean).join(" ") || undefined };
        if (allowed) item.creators.push({ ...c, creatorType: ZOTERO_TO_ISNAD[role] ?? role });
        else extra.push(extraLine({ ...c, creatorType: `csl:${k}` }));
      }
      continue;
    }
    const dateField = schema.csl.fields.date[k];
    if (dateField) {
      const target = typeField(itemType, dateField);
      const text = formatCslDate(value as CslDate);
      if (target && text) item.fields[target] = text;
      else if (text) extra.push(`${k}: ${text}`);
      continue;
    }
    if (k === "note") {
      const p = parseExtra(String(value));
      item.creators.push(...p.creators.filter((c) => ISNAD_ROLES[c.creatorType] || creatorTypesOf(itemType).includes(c.creatorType)));
      if (p.rest) extra.push(p.rest);
      for (const [ck, cv] of Object.entries(p.csl)) extra.push(`${ck}: ${cv}`);
      continue;
    }
    const candidates = zoteroFieldsOfCsl[k];
    if (candidates && (typeof value === "string" || typeof value === "number")) {
      const target = candidates.map((f) => typeField(itemType, f)).find(Boolean);
      if (target) {
        if (!item.fields[target]) item.fields[target] = String(value);
        continue;
      }
    }
    if (typeof value === "string" || typeof value === "number") extra.push(`${k}: ${value}`);
  }
  if (extra.length) item.fields.extra = extra.join("\n");
  return item;
}

/** Zotero API item data (format=json) → Derkenar item. */
export function fromZoteroData(data: Record<string, unknown>, source: string, version?: number): Item {
  const itemType = String(data.itemType ?? "document");
  const t = now();
  const item: Item = {
    key: String(data.key),
    itemType,
    fields: {},
    creators: [],
    tags: ((data.tags as Tag[] | undefined) ?? []).map((x) => ({ tag: x.tag, ...(x.type ? { type: x.type } : {}) })),
    collections: (data.collections as string[] | undefined) ?? [],
    relations: relationKeys(data.relations),
    notes: [],
    dateAdded: String(data.dateAdded ?? t),
    dateModified: String(data.dateModified ?? t),
    source,
    ...(version !== undefined ? { version } : {}),
    ...(data.deleted ? { deleted: true } : {}),
  };
  const skip = new Set(["key", "version", "itemType", "creators", "tags", "collections", "relations", "dateAdded", "dateModified", "parentItem", "deleted", "inPublications"]);
  for (const [k, v] of Object.entries(data)) if (!skip.has(k) && typeof v === "string" && v) item.fields[k] = v;
  for (const c of (data.creators as Creator[] | undefined) ?? []) item.creators.push({ ...c, creatorType: ZOTERO_TO_ISNAD[c.creatorType] ?? c.creatorType });
  return liftExtraRoles(item);
}

function relationKeys(relations: unknown): string[] {
  const r = (relations ?? {}) as Record<string, string | string[]>;
  const list = ([] as string[]).concat(r["dc:relation"] ?? []);
  return list.map((u) => u.split("/").pop() ?? "").filter(Boolean);
}

/** Moves İSNAD roles written in Extra (the Zotero workaround) into real creators. */
export function liftExtraRoles(item: Item): Item {
  if (!item.fields.extra) return item;
  const lines: string[] = [];
  for (const line of item.fields.extra.split(/\r?\n/)) {
    const m = /^\s*([\p{L}-]+)\s*:\s*(.+)$/u.exec(line);
    const role = m ? ROLE_BY_EXTRA.get(m[1]!.toLocaleLowerCase("tr")) : undefined;
    if (m && role) item.creators.push({ creatorType: role, ...parseNameValue(m[2]!) });
    else lines.push(line);
  }
  const rest = lines.join("\n").trim();
  if (rest) item.fields.extra = rest;
  else delete item.fields.extra;
  return item;
}

/** Item data in Zotero's format, İSNAD roles that Zotero lacks moved to Extra. */
export function toZoteroData(item: Item): Record<string, unknown> {
  const allowed = new Set(typeIndex.get(item.itemType)?.creatorTypes ?? []);
  const creators: Creator[] = [];
  const extra: string[] = [];
  for (const c of item.creators) {
    if (c.creatorType === "muhakkik" && allowed.has("seriesEditor")) creators.push({ ...c, creatorType: "seriesEditor" });
    else if (allowed.has(c.creatorType)) creators.push(c);
    else extra.push(extraLine(c));
  }
  const fields = { ...item.fields };
  if (extra.length) fields.extra = [...extra, fields.extra].filter(Boolean).join("\n");
  return { key: item.key, itemType: item.itemType, ...fields, creators, tags: item.tags, collections: item.collections, dateAdded: item.dateAdded, dateModified: item.dateModified };
}

// ---------------------------------------------------------------- display helpers

export function creatorShort(c: Creator): string {
  return c.name ?? c.lastName ?? c.firstName ?? "";
}

export function creatorFull(c: Creator): string {
  return c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" ");
}

/** Primary creators: authors, else editors / muhakkik, else anyone. */
export function primaryCreators(item: Item): Creator[] {
  for (const t of [["author", "artist", "director", "inventor", "programmer", "podcaster", "presenter", "sponsor", "interviewee", "cartographer", "performer"], ["editor", "muhakkik", "hazirlayan", "nasir"]]) {
    const list = item.creators.filter((c) => t.includes(c.creatorType));
    if (list.length) return list;
  }
  return item.creators;
}

export function creatorLine(item: Item, max = 3): string {
  const names = primaryCreators(item).map(creatorShort).filter(Boolean);
  if (!names.length) return "";
  if (names.length > max) return `${names.slice(0, max).join(", ")} vd.`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}` : names[0]!;
}

export function titleOf(item: Item): string {
  if (item.itemType === NOTE_TYPE) return noteText(item.notes[0]?.note ?? "").split("\n")[0]!.slice(0, 120) || "(boş not)";
  return item.fields.title ?? item.fields.caseName ?? item.fields.nameOfAct ?? item.fields.subject ?? "";
}

/** "kelâm ilminin doğuşu" → "Kelâm İlminin Doğuşu" (Turkish-aware; short connectives stay lower). */
export function titleCase(s: string): string {
  const small = new Set(["ve", "ile", "veya", "ya", "da", "de", "ki", "mi", "bir", "fî", "fi", "min", "alâ", "ala", "an", "ilâ", "and", "or", "of", "the", "in", "on", "a", "an", "to"]);
  let first = true;
  return s.toLocaleLowerCase("tr").replace(/[\p{L}\p{N}ʿʾ’'-]+/gu, (w) => {
    const keep = !first && small.has(w);
    first = false;
    return keep ? w : w.charAt(0).toLocaleUpperCase("tr") + w.slice(1);
  });
}

export function sentenceCaseTitle(s: string): string {
  const lower = s.toLocaleLowerCase("tr");
  return lower.replace(/(^|[:.?!]\s+)(\p{L})/gu, (_, p: string, c: string) => p + c.toLocaleUpperCase("tr"));
}

/** Container title whatever the type calls it (journal, book, encyclopedia, website…). */
export function containerOf(item: Item): string {
  const f = typeField(item.itemType, "publicationTitle");
  return (f && item.fields[f]) || "";
}

export function noteText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

export function textToNoteHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
}

/**
 * ISBN → book. Several catalogues are asked at once and the best record wins;
 * empty fields are filled from the others.
 *
 *  - K10plus (union catalogue of German research libraries, SRU/MARC): holds
 *    a great many Turkish, Arabic and Persian books in theology and the
 *    humanities, with diacritics, place and publisher.
 *  - Deutsche Nationalbibliothek (SRU/MARC).
 *  - Crossref: books of publishers that register DOIs, Turkish ones included.
 *  - Google Books: optional API key (keyless requests often hit a daily quota).
 *  - Open Library.
 *
 * All five allow requests from the add-in's page (CORS).
 */
import { DOMParser } from "@xmldom/xmldom";
import { type Creator, type Item, emptyItem } from "./zotero.js";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface IsbnOptions {
  fetchFn?: Fetch;
  googleKey?: string;
}

/** Both forms of an ISBN (13 and, when it has one, 10). */
export function isbnForms(isbn: string): string[] {
  const d = isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (d.length === 10) {
    const core = "978" + d.slice(0, 9);
    return [isbn13(core), d];
  }
  if (d.length === 13 && d.startsWith("978")) {
    const core = d.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
    const c = (11 - (sum % 11)) % 11;
    return [d, core + (c === 10 ? "X" : String(c))];
  }
  return [d];
}

function isbn13(core12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core12[i]) * (i % 2 ? 3 : 1);
  return core12 + String((10 - (sum % 10)) % 10);
}

interface Found {
  source: string;
  item: Item;
}

const PRIORITY = ["k10plus", "dnb", "crossref", "google", "openlibrary"];

export async function lookupIsbnAll(isbn: string, opts: IsbnOptions = {}): Promise<Item> {
  const f = opts.fetchFn ?? fetch;
  const forms = isbnForms(isbn);
  const tries: [string, Promise<Item | null>][] = [
    ["k10plus", k10plus(forms, f)],
    ["dnb", dnb(forms, f)],
    ["crossref", crossref(forms, f)],
    ["google", google(forms, f, opts.googleKey)],
    ["openlibrary", openLibrary(forms, f)],
  ];
  const settled = await Promise.all(tries.map(async ([source, p]) => ({ source, item: await p.catch(() => null) })));
  const found = settled.filter((x): x is Found => Boolean(x.item?.fields.title));
  if (!found.length) {
    const quota = await googleQuota(settled);
    throw new Error(`ISBN bulunamadı (${forms[0]}): K10plus, Alman Millî Kütüphanesi, Crossref, Google Books ve Open Library'de kaydı yok.${quota}`);
  }
  found.sort((a, b) => score(b) - score(a) || PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source));
  const best = found[0]!.item;
  for (const { item } of found.slice(1)) {
    for (const [k, v] of Object.entries(item.fields)) if (v && !best.fields[k]) best.fields[k] = v;
    if (!best.creators.length && item.creators.length) best.creators = item.creators;
  }
  best.fields.ISBN = forms[0]!;
  best.source = "isbn";
  return best;
}

let lastGoogleStatus = 0;
async function googleQuota(_: unknown): Promise<string> {
  return lastGoogleStatus === 429 ? " (Google Books günlük kotası dolmuş; Yeni Kaynak → Google Books anahtarı ile aşılır.)" : "";
}

/** Records with diacritics, a place and a publisher beat bare ones. */
function score({ item }: Found): number {
  const f = item.fields;
  let s = 0;
  for (const k of ["title", "publisher", "place", "date", "numPages"]) if (f[k]) s += 2;
  if (item.creators.length) s += 2;
  if (/[âîûçğışöüÂÎÛÇĞİŞÖÜḥṣṭẓʿʾāīū]/.test([f.title, f.publisher, ...item.creators.map((c) => c.lastName ?? c.name ?? "")].join(" "))) s += 3;
  return s;
}

// ---------------------------------------------------------------- MARC (K10plus, DNB)

async function k10plus(forms: string[], f: Fetch): Promise<Item | null> {
  const q = forms.map((x) => `pica.isb=${x}`).join(" or ");
  const r = await f(`https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(q)}&maximumRecords=3&recordSchema=marcxml`);
  return r.ok ? marcToItem(await r.text()) : null;
}

async function dnb(forms: string[], f: Fetch): Promise<Item | null> {
  const q = forms.map((x) => `num=${x}`).join(" or ");
  const r = await f(`https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(q)}&maximumRecords=3&recordSchema=MARC21-xml`);
  return r.ok ? marcToItem(await r.text()) : null;
}

/** "İstanbul :" → "İstanbul", "[2015]" → "2015", "Ahmet Yılmaz /" → "Ahmet Yılmaz". */
const trimMarc = (s: string) => s.replace(/\s*[/:;,=]\s*$/, "").replace(/^\[(.*)\]$/, "$1").replace(/[[\]]/g, "").replace(/\s*\.$/, (m) => (/\b\p{Lu}\.$/u.test(s) ? m : "")).trim();

/** First MARC record of an SRU response → book item; null when there is none. */
export function marcToItem(xml: string): Item | null {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const record = Array.from(doc.getElementsByTagName("*")).find((e) => /(^|:)record$/.test(e.nodeName) && Array.from(e.childNodes).some((c) => /(^|:)(leader|datafield)$/.test(c.nodeName)));
  if (!record) return null;
  const fields = Array.from(record.childNodes).filter((n): n is Element => /(^|:)datafield$/.test(n.nodeName));
  const df = (tag: string) => fields.filter((e) => e.getAttribute("tag") === tag);
  const sub = (e: Element | undefined, code: string) =>
    e ? Array.from(e.childNodes).filter((n): n is Element => /(^|:)subfield$/.test(n.nodeName) && (n as Element).getAttribute("code") === code).map((n) => (n.textContent ?? "").trim()) : [];
  const one = (tag: string, code: string) => sub(df(tag)[0], code)[0] ?? "";

  const item = emptyItem("book", "isbn");
  const t = df("245")[0];
  const title = trimMarc(sub(t, "a")[0] ?? "");
  const subtitle = trimMarc(sub(t, "b")[0] ?? "");
  const part = [sub(t, "n")[0], sub(t, "p")[0]].filter(Boolean).map((x) => trimMarc(x!)).join(" ");
  // Parallel titles ("= Al-maḳāṣid") and leaked subfield codes ("$nM. Nesim Doru") are dropped.
  const clean = (x: string) => trimMarc(x.replace(/\$[a-z0-9].*$/i, "").split(/\s+=\s+/)[0]!);
  item.fields.title = [clean(title), clean(subtitle)].filter(Boolean).join(": ").replace(/\s+/g, " ") + (part ? `. ${part}` : "");
  if (!item.fields.title) return null;

  const pub = df("264").find((e) => e.getAttribute("ind2") === "1") ?? df("264")[0] ?? df("260")[0];
  const place = trimMarc(sub(pub, "a")[0] ?? "");
  if (place && !/^s\.\s?l\.?$|yer yok/i.test(place)) item.fields.place = place;
  const publisher = trimMarc(sub(pub, "b")[0] ?? "");
  if (publisher && !/^s\.\s?n\.?$/i.test(publisher)) item.fields.publisher = publisher;
  const control008 = Array.from(record.childNodes).find((n): n is Element => /(^|:)controlfield$/.test(n.nodeName) && (n as Element).getAttribute("tag") === "008")?.textContent ?? "";
  const year = /\d{4}/.exec(sub(pub, "c")[0] ?? "")?.[0] ?? (/^\d{4}$/.test(control008.slice(7, 11)) ? control008.slice(7, 11) : undefined);
  if (year) item.fields.date = year;
  const edition = trimMarc(one("250", "a"));
  const ed = edition.replace(/\.?\s*(baskı|basım|bs|ed|Aufl|edition)\.?$/i, "").replace(/^(\d+)\.?$/, "$1").trim();
  // The first edition is not written in a reference.
  if (ed && !/^(1|i|ilk|birinci|first)$/i.test(ed)) item.fields.edition = ed;
  const pages = /(\d+)\s*(s|sayfa|S|p|pages|Seiten)\b/.exec(one("300", "a"))?.[1];
  if (pages) item.fields.numPages = pages;
  const vols = /(\d+)\s*(c|cilt|Bd|vol|v)\b/i.exec(one("300", "a"))?.[1];
  if (vols && Number(vols) > 1) item.fields.numberOfVolumes = vols;
  const series = df("490")[0] ?? df("830")[0];
  if (series) {
    // A publisher's running number ("Misvak Neşriyat ; Yayın No: 53") is not a series.
    const name = trimMarc(sub(series, "a")[0] ?? "");
    const n = trimMarc(sub(series, "v")[0] ?? "");
    const fold = (x: string) => x.toLocaleLowerCase("tr").replace(/\s+(yayın(ları|evi)?|neşriyat|yayınevi|kitabevi|press)\b.*$/, "").trim();
    if (name && !(publisher && fold(name) === fold(publisher)) && !/yayın(lar)?ı?\b/i.test(name) && !/^(yayın|yay\.)/i.test(n)) {
      item.fields.series = name;
      if (n) item.fields.seriesNumber = n;
    }
  }
  const lang = one("041", "a") || "";
  if (lang) item.fields.language = { tur: "tr", ara: "ar", per: "fa", eng: "en", ger: "de", fre: "fr", ota: "ota" }[lang] ?? lang;

  const creators: Creator[] = [];
  for (const e of [...df("100"), ...df("110")]) creators.push({ creatorType: "author", ...nameOf(sub(e, "a")[0] ?? "", e.getAttribute("tag") === "110") });
  for (const e of [...df("700"), ...df("710")]) {
    const role = roleOf([...sub(e, "e"), ...sub(e, "4")].join(" "));
    if (role) creators.push({ creatorType: role, ...nameOf(sub(e, "a")[0] ?? "", e.getAttribute("tag") === "710") });
  }
  item.creators = creators.filter((c) => c.lastName || c.name);
  return item;
}

function nameOf(raw: string, corporate: boolean): { lastName?: string; firstName?: string; name?: string } {
  const n = trimMarc(raw).replace(/,$/, "");
  if (corporate || !n.includes(",")) return { name: n };
  const [last, ...first] = n.split(",");
  return { lastName: last!.trim(), firstName: first.join(",").trim() };
}

/** MARC relator term or code → creator type; null for roles a citation leaves out. */
function roleOf(rel: string): string | null {
  const r = rel.toLowerCase();
  if (!r || /\baut\b|verfasser|author|yazar/.test(r)) return "author";
  if (/haz|hrsg|\bedt\b|editor|herausgeber|ed\./.test(r)) return /haz/.test(r) ? "hazirlayan" : "editor";
  if (/thk|tahkik|tah\./.test(r)) return "muhakkik";
  if (/\btrl\b|çev|übers|translator/.test(r)) return "translator";
  return null;
}

// ---------------------------------------------------------------- JSON services

async function crossref(forms: string[], f: Fetch): Promise<Item | null> {
  for (const isbn of forms) {
    const url = `https://api.crossref.org/works?filter=isbn:${isbn}&rows=5`;
    // Crossref drops a request now and then; one retry.
    const r = await f(url).then((x) => (x.ok ? x : f(url))).catch(() => f(url));
    if (!r.ok) continue;
    const items = ((await r.json()) as { message?: { items?: CrossrefWork[] } }).message?.items ?? [];
    const w = items.find((x) => /book|monograph/.test(x.type ?? "")) ?? items[0];
    if (!w?.title?.[0]) continue;
    const item = emptyItem("book", "isbn");
    item.fields.title = [w.title[0], w.subtitle?.[0]].filter(Boolean).join(": ");
    // An edited book lists its chapter authors too; the book itself is the editors'.
    const authors = w.editor?.length && (w.type === "edited-book" || (w.author?.length ?? 0) >= 3) ? [] : (w.author ?? []);
    item.creators = [
      ...authors.map((a) => ({ creatorType: "author", lastName: unCaps(a.family), firstName: unCaps(a.given ?? "") })),
      ...(w.editor ?? []).map((a) => ({ creatorType: "editor", lastName: unCaps(a.family), firstName: unCaps(a.given ?? "") })),
    ].filter((c) => c.lastName);
    if (w.publisher) item.fields.publisher = w.publisher;
    if (w["publisher-location"]) item.fields.place = w["publisher-location"];
    const y = (w.published ?? w.issued)?.["date-parts"]?.[0]?.[0];
    if (y) item.fields.date = String(y);
    if (w.DOI) item.fields.DOI = w.DOI;
    return item;
  }
  return null;
}

interface CrossrefWork {
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: { family: string; given?: string }[];
  editor?: { family: string; given?: string }[];
  publisher?: string;
  "publisher-location"?: string;
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  DOI?: string;
}

async function google(forms: string[], f: Fetch, key?: string): Promise<Item | null> {
  for (const isbn of forms) {
    const r = await f(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key ? `&key=${encodeURIComponent(key)}` : ""}`);
    lastGoogleStatus = r.status;
    if (!r.ok) return null;
    const v = ((await r.json()) as { items?: { volumeInfo: GoogleVolume }[] }).items?.[0]?.volumeInfo;
    if (!v?.title) continue;
    const item = emptyItem("book", "isbn");
    item.fields.title = [v.title, v.subtitle].filter(Boolean).join(": ");
    item.creators = (v.authors ?? []).map((a) => ({ creatorType: "author", ...plainName(a) }));
    if (v.publisher) item.fields.publisher = v.publisher;
    if (v.publishedDate) item.fields.date = v.publishedDate.slice(0, 4);
    if (v.pageCount) item.fields.numPages = String(v.pageCount);
    if (v.language) item.fields.language = v.language;
    return item;
  }
  return null;
}

interface GoogleVolume {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  language?: string;
}

async function openLibrary(forms: string[], f: Fetch): Promise<Item | null> {
  const keys = forms.map((x) => `ISBN:${x}`).join(",");
  const r = await f(`https://openlibrary.org/api/books?bibkeys=${keys}&format=json&jscmd=data`);
  if (!r.ok) return null;
  const all = (await r.json()) as Record<string, OpenLibraryBook>;
  const data = forms.map((x) => all[`ISBN:${x}`]).find(Boolean);
  if (!data?.title) return null;
  const item = emptyItem("book", "isbn");
  item.fields.title = [data.title, data.subtitle].filter(Boolean).join(": ");
  item.creators = (data.authors ?? []).filter((a) => !/^kolektif$/i.test(a.name)).map((a) => ({ creatorType: "author", ...plainName(a.name) }));
  if (data.publishers?.[0]) item.fields.publisher = data.publishers[0].name;
  if (data.publish_places?.[0]) item.fields.place = data.publish_places[0].name;
  const y = /\d{4}/.exec(data.publish_date ?? "")?.[0];
  if (y) item.fields.date = y;
  if (data.number_of_pages) item.fields.numPages = String(data.number_of_pages);
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
function plainName(name: string): { lastName?: string; firstName?: string; name?: string } {
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

/** "MARANGOZOĞLU" → "Marangozoğlu"; names already in mixed case stay. */
function unCaps(s: string): string {
  if (!s || s !== s.toLocaleUpperCase("tr") || !/\p{L}{2}/u.test(s)) return s;
  return s.toLocaleLowerCase("tr").replace(/(^|[\s\-'’.])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("tr"));
}

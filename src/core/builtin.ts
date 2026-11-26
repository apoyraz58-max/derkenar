/**
 * Yerleşik veritabanı: eklentiyle birlikte yayımlanan, kullanıcının hiçbir dosya yüklemesi
 * gerekmeyen iki kaynak.
 *
 *   - TDV İslâm Ansiklopedisi (DİA) maddeleri: `data/builtin/dia.rdf.gz` (Zotero RDF) derleme
 *     sırasında `dia.json` olur; tek dosya, ilk aramada iner.
 *   - Derkenar makale kataloğu: DergiPark, TR Dizin ve İSAM'dan birleştirilen makalelerin yalnız
 *     kesin olanları (DOI'si kayıt ajansında doğrulanmış, iki kaynakta tutan ya da yayın kaydı derginin
 *     arşiviyle doğrulanmış). Çok büyük olduğu için parçalıdır: arama sözcüğünün ilk üç harfine göre
 *     dizin parçası, kayıtlar biner biner parça. Arama yalnız gereken parçaları indirir.
 *
 * Bu dosya Word'den bağımsızdır: kayıt biçimleri, İSNAD kaydına dönüşüm, arama anahtarı ve dizin
 * kodlaması burada; indirme `src/addin/pane/builtin.ts`'te, parçaların üretimi `scripts/builtin.ts`'te.
 */
import { type Creator, type Item, emptyItem, newKey, now, typeField } from "./zotero.js";

// ---------------------------------------------------------------- arama anahtarı

/** Aramada harf işaretleri, büyük/küçük ve Türkçe i/ı ayrımı yok ("Gazzâlî" = "gazzali"). */
export function foldKey(s: string): string {
  return s
    .replace(/[İIı]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ʿʾ‘’'`ʻʼ]/g, "")
    .replace(/(^|\s)(el|er|ez|es|eş|en|et|ed|al)-/g, "$1")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dizinde yer almayan çok sık sözcükler. */
const STOP = new Set(
  "ve ile icin bir olarak uzerine hakkinda gore kadar sonra once olan the and for with from into its their des der die das les une von".split(" "),
);

/** Bir metnin dizin sözcükleri: en az üç harf, sık sözcükler hariç. */
export function indexWords(s: string): string[] {
  return [...new Set(foldKey(s).split(" "))].filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Arama sözcükleri: her biri kaydın bir sözcüğünün başı olmalı ("gazz ihya"). */
export function queryWords(q: string): string[] {
  return [...new Set(foldKey(q).split(" "))].filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Dizin parçasının adı: sözcüğün ilk üç harfi. */
export const shardOf = (word: string) => word.slice(0, 3);

// ---------------------------------------------------------------- DİA

export const DIA_NAME = "Türkiye Diyanet Vakfı İslâm Ansiklopedisi";
export const DIA_CATALOG = "TDV İslâm Ansiklopedisi";
const DIA_PDF = "https://cdn2.islamansiklopedisi.org.tr/dosya/";
const DIA_WEB = "https://islamansiklopedisi.org.tr/";

export interface DiaEntry {
  /** Maddenin RDF'teki numarası (item_2525). */
  n: number;
  /** Künyede kullanılan başlık: basılı nüshadaki başlık (web başlığı farklıysa `w`). */
  t: string;
  w?: string;
  /** Yazarlar: [soyadı, adı]. */
  a: [string, string][];
  v?: string;
  y?: string;
  p?: string;
  pg?: string;
  e?: string;
  /** Basılı nüsha PDF'i (DIA_PDF'ten sonrası) ve web sayfası (DIA_WEB'ten sonrası). */
  pdf?: string;
  web?: string;
  /** "bk." göndermeleriyle bu maddeye yönlenen başlıklar. */
  al?: string[];
  /** Maddenin kısa tanımı ("(1808-1887) Polonya asıllı Fransız şarkiyatçısı."). */
  d?: string;
  /** Denetlenmesi gerekenler (ör. tarih cildin basım yılından farklı). */
  r?: string[];
}

export interface DiaData {
  name: string;
  source: string;
  entries: DiaEntry[];
}

function creator([last, first]: [string, string]): Creator {
  return first ? { creatorType: "author", lastName: last, firstName: first } : { creatorType: "author", lastName: last };
}

/** DİA maddesi İSNAD kaydı olarak: basılı madde (cilt, yıl, yer, sayfa), web ve PDF bağlantı eki olarak. */
export function diaItem(e: DiaEntry): Item {
  const item = emptyItem("encyclopediaArticle", "yerlesik:dia");
  const f = item.fields;
  f.title = e.t;
  f[typeField("encyclopediaArticle", "publicationTitle") ?? "encyclopediaTitle"] = DIA_NAME;
  if (e.v) f.volume = e.v;
  if (e.y) f.date = e.y;
  if (e.p) f.place = e.p;
  f.publisher = "TDV Yayınları";
  if (e.pg) f.pages = e.pg;
  if (e.e) f.edition = e.e;
  f.libraryCatalog = DIA_CATALOG;
  if (e.d) f.abstractNote = e.d;
  item.creators = e.a.map(creator);
  f.extra = [
    `Kaynak: ${DIA_CATALOG}, madde no. ${e.n}`,
    ...(e.w ? [`Web başlığı: ${e.w}`] : []),
    ...(e.r?.length ? [`Kontrol: ${e.r.join("; ")}`] : []),
  ].join("\n");
  const t = now();
  item.attachments = [
    ...(e.pdf ? [{ key: newKey(), kind: "link" as const, title: "Matbu nüsha (PDF)", url: DIA_PDF + e.pdf, dateAdded: t }] : []),
    ...(e.web ? [{ key: newKey(), kind: "link" as const, title: "Tam metin (Web sayfası)", url: DIA_WEB + e.web, dateAdded: t }] : []),
  ];
  return item;
}

const diaKeys = new WeakMap<DiaEntry, { head: string; all: string }>();
function diaKey(e: DiaEntry) {
  let k = diaKeys.get(e);
  if (!k) {
    const head = foldKey(`${e.t} ${e.w ?? ""} ${(e.al ?? []).join(" ")}`);
    k = { head: ` ${head} `, all: ` ${head} ${foldKey(e.a.map((x) => `${x[1]} ${x[0]}`).join(" "))} ` };
    diaKeys.set(e, k);
  }
  return k;
}

/**
 * DİA maddeleri: sorgunun her sözcüğü maddenin başlığında (ya da "bk." göndermesinde, yazarında) bir
 * sözcüğün başı. Başlığı sorguyla başlayan maddeler önce gelir ("gazzali" → "Gazzâlî", sonra "Gazzâlî, Ahmed").
 */
export function searchDia(q: string, data: DiaData, limit = 6): DiaEntry[] {
  const words = queryWords(q);
  if (!words.length || words.join("").length < 3) return [];
  const lead = ` ${words.join(" ")}`;
  const hits: { e: DiaEntry; rank: number }[] = [];
  for (const e of data.entries) {
    const k = diaKey(e);
    if (!words.every((w) => k.all.includes(` ${w}`))) continue;
    const rank = k.head.startsWith(`${lead} `) ? 0 : k.head.startsWith(lead) ? 1 : words.every((w) => k.head.includes(` ${w}`)) ? 2 : 3;
    hits.push({ e, rank });
  }
  hits.sort((x, y) => x.rank - y.rank || x.e.t.length - y.e.t.length);
  return hits.slice(0, limit).map((h) => h.e);
}

// ---------------------------------------------------------------- makale kataloğu

export const ARTICLE_CATALOG = "Derkenar makale kataloğu";

/** Makale kaydı (dizi, kısa olsun diye):
 *  [katalog no, yazarlar "Soyadı|Adı;…", başlık, dergi, yıl, ay, cilt, sayı, ilk sayfa, son sayfa,
 *   makale no, DOI (yalnız doğrulanmış), ISSN, dil, doğrulama yolu] */
export type ArticleRec = [string, string, string, string, number | null, number | null, string, string, string, string, string, string, string, string, string];

export const VERIFIED_HOW: Record<string, string> = {
  ajans: "DOI kayıt ajansında doğrulandı",
  iki: "en az iki kaynakta tutuyor",
  arsiv: "yayın kaydı derginin sayı arşiviyle doğrulandı",
};

export function articleAuthors(r: ArticleRec): [string, string][] {
  return r[1] ? r[1].split(";").map((p) => {
    const [l, f] = p.split("|");
    return [l ?? "", f ?? ""];
  }) : [];
}

export function articleItem(r: ArticleRec): Item {
  const [id, , title, journal, year, month, vol, iss, sp, ep, ano, doi, issn, lang, how] = r;
  const item = emptyItem("journalArticle", "yerlesik:makale");
  const f = item.fields;
  f.title = title;
  if (journal) f.publicationTitle = journal;
  if (vol) f.volume = vol;
  if (iss) f.issue = iss;
  const pages = sp && ep && ep !== sp ? `${sp}-${ep}` : sp || ano;
  if (pages) f.pages = pages;
  if (year) f.date = month ? `${year}-${String(month).padStart(2, "0")}` : String(year);
  if (doi) f.DOI = doi;
  if (issn) f.ISSN = issn;
  if (lang) f.language = lang;
  f.libraryCatalog = ARTICLE_CATALOG;
  f.extra = [`Kaynak: ${ARTICLE_CATALOG}, kayıt no. ${id}`, ...(VERIFIED_HOW[how] ? [`Doğrulama: ${VERIFIED_HOW[how]}`] : [])].join("\n");
  item.creators = articleAuthors(r).map(creator);
  return item;
}

/** Bir makalenin dizin sözcükleri: başlık ve yazar soyadları. */
export function articleWords(r: ArticleRec): string[] {
  return indexWords(`${r[2]} ${articleAuthors(r).map((a) => a[0]).join(" ")}`);
}

/** Makale kataloğunun parçalama bilgisi (`makale/meta.json`). */
export interface ArticleMeta {
  name: string;
  source: string;
  count: number;
  /** Bir kayıt parçasındaki kayıt sayısı. */
  per: number;
  /** Var olan dizin parçaları. */
  shards: string[];
}

/** Sıralı kayıt numaraları, art arda farkları 36 tabanında: [3, 10, 47] → "3,7,11". */
export function encodePostings(ids: readonly number[]): string {
  let prev = 0;
  return ids.map((id) => {
    const s = (id - prev).toString(36);
    prev = id;
    return s;
  }).join(",");
}

export function decodePostings(s: string): number[] {
  let prev = 0;
  return s ? s.split(",").map((d) => (prev += parseInt(d, 36))) : [];
}

/** Sıralı listelerin kesişimi. */
export function intersect(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]! < b[j]!) i++;
    else if (a[i]! > b[j]!) j++;
    else {
      out.push(a[i]!);
      i++;
      j++;
    }
  }
  return out;
}

/** Bir dizin parçasında sözcükle başlayan bütün dizin sözcüklerinin kayıtları (sıralı, tekil). */
export function postingsFor(word: string, shard: Record<string, string>): number[] {
  const lists: number[][] = [];
  for (const [tok, enc] of Object.entries(shard)) if (tok.startsWith(word)) lists.push(decodePostings(enc));
  if (lists.length === 1) return lists[0]!;
  return [...new Set(lists.flat())].sort((x, y) => x - y);
}

/** Bir kaydın yerleşik veritabanındaki yeri ("TDV İslâm Ansiklopedisi#2525", "Derkenar makale kataloğu#DKR0000001"). */
export function builtinSource(item: Item): string | null {
  const m = /^Kaynak: (.+?), (?:madde|kayıt) no\. (\S+)$/m.exec(item.fields.extra ?? "");
  return m ? `${m[1]}#${m[2]}` : null;
}

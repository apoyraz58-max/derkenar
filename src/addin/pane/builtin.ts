/**
 * Yerleşik veritabanı (DİA maddeleri ve Derkenar makale kataloğunun kesin kayıtları): eklentiyle aynı
 * adresten, gerektiği kadar indirilir; kullanıcı hiçbir dosya yüklemez. Atıf sekmesinde aranan sözcüklerle
 * eşleşen maddeler ve makaleler kütüphanede yoksa tek tıkla eklenip atıfa konur.
 */
import {
  type ArticleMeta,
  type ArticleRec,
  type DiaData,
  type DiaEntry,
  intersect,
  postingsFor,
  queryWords,
  searchDia,
  shardOf,
} from "../../core/builtin.js";

declare const __VERSION__: string;

const url = (p: string) => `data/${p}?v=${encodeURIComponent(typeof __VERSION__ === "string" ? __VERSION__ : "0")}`;

async function json<T>(p: string): Promise<T> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return (await r.json()) as T;
}

let dia: Promise<DiaData | null> | null = null;
let meta: Promise<ArticleMeta | null> | null = null;
const terms = new Map<string, Promise<Record<string, string>>>();
const chunks = new Map<number, Promise<ArticleRec[]>>();

const loadDia = () => (dia ??= json<DiaData>("dia.json").catch(() => null));
const loadMeta = () => (meta ??= json<ArticleMeta>("makale/meta.json").catch(() => null));
function term(s: string): Promise<Record<string, string>> {
  let p = terms.get(s);
  if (!p) {
    p = json<Record<string, string>>(`makale/t/${s}.json`).catch(() => ({}));
    terms.set(s, p);
  }
  return p;
}
function chunk(n: number): Promise<ArticleRec[]> {
  let p = chunks.get(n);
  if (!p) {
    p = json<ArticleRec[]>(`makale/r/${n}.json`).catch(() => {
      chunks.delete(n);
      return [];
    });
    chunks.set(n, p);
  }
  return p;
}

export interface BuiltinHits {
  q: string;
  dia: DiaEntry[];
  articles: ArticleRec[];
}

let last: BuiltinHits = { q: "", dia: [], articles: [] };
let pending = "";
let onReady: (() => void) | null = null;

/** Sonuçlar indikçe Atıf listesini yeniden çizmek için. */
export function onBuiltinReady(fn: () => void): void {
  onReady = fn;
}

async function articleSearch(q: string, limit: number): Promise<ArticleRec[]> {
  const words = queryWords(q).filter((w) => w.length >= 3);
  if (!words.length) return [];
  const m = await loadMeta();
  if (!m) return [];
  const have = new Set(m.shards);
  if (words.some((w) => !have.has(shardOf(w)))) return [];
  const lists = await Promise.all(words.map(async (w) => postingsFor(w, await term(shardOf(w)))));
  lists.sort((a, b) => a.length - b.length);
  let ids = lists[0] ?? [];
  for (const l of lists.slice(1)) ids = intersect(ids, l);
  const top = ids.slice(0, limit);
  return Promise.all(top.map(async (id) => (await chunk(Math.floor(id / m.per)))[id % m.per]!)).then((r) => r.filter(Boolean));
}

async function searchAll(q: string): Promise<void> {
  const [d, articles] = await Promise.all([loadDia().then((x) => (x ? searchDia(q, x, 5) : [])), articleSearch(q, 6)]);
  if (pending !== q) return; // kullanıcı bu arada başka bir şey yazdı
  last = { q, dia: d, articles };
  onReady?.();
}

/** Bu sorgunun yerleşik veritabanı sonuçları; henüz inmediyse boş döner ve inince onBuiltinReady çağrılır. */
export function builtinHits(q: string): BuiltinHits {
  const query = q.trim();
  if (query.length < 3) return { q: query, dia: [], articles: [] };
  if (last.q === query) return last;
  if (pending !== query) {
    pending = query;
    void searchAll(query).catch(() => undefined);
  }
  return { q: query, dia: [], articles: [] };
}

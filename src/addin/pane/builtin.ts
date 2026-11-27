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
  decodePostings,
  intersect,
  postingsFor,
  queryWords,
  rankArticles,
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
  const shards = await Promise.all(words.map((w) => term(shardOf(w))));
  const inter = (lists: number[][]) => {
    const l = [...lists].sort((a, b) => a.length - b.length);
    return l.slice(1).reduce((acc, x) => intersect(acc, x), l[0] ?? []);
  };
  // Önek eşleşmesi ("poy" -> Poyraz, Poyrazoğlu) ve tam eşleşme ("poyraz"): tam tutanlar önce.
  const ids = inter(words.map((w, i) => postingsFor(w, shards[i]!)));
  const exact = inter(words.map((w, i) => (shards[i]![w] ? decodePostings(shards[i]![w]!) : postingsFor(w, shards[i]!))));
  const ex = new Set(exact);
  const ordered = [...exact, ...ids.filter((id) => !ex.has(id))];
  // Sıralama için ilk 30 aday indirilir, tam tutan yazar/başlık öne alınır.
  const top = ordered.slice(0, 30);
  const recs = (await Promise.all(top.map(async (id) => (await chunk(Math.floor(id / m.per)))[id % m.per]!))).filter(Boolean);
  return rankArticles(q, recs).slice(0, limit);
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

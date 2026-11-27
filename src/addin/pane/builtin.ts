/**
 * Yerleşik veritabanı (DİA maddeleri, Künye makale kataloğunun kesin kayıtları ve Künye kitap kataloğunun
 * denetlenmiş baskıları): eklentiyle aynı
 * adresten, gerektiği kadar indirilir; kullanıcı hiçbir dosya yüklemez. Atıf sekmesinde aranan sözcüklerle
 * eşleşen maddeler ve makaleler kütüphanede yoksa tek tıkla eklenip atıfa konur.
 */
import {
  type ArticleMeta,
  type ArticleRec,
  type BookRec,
  type DiaData,
  type DiaEntry,
  decodePostings,
  intersect,
  postingsFor,
  queryWords,
  rankArticles,
  rankBooks,
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
const loadDia = () => (dia ??= json<DiaData>("dia.json").catch(() => null));

/** Parçalı katalog (makale/, kitap/): meta, dizin parçaları ve kayıt parçaları gerektikçe iner. */
class Sharded<R> {
  private meta: Promise<ArticleMeta | null> | null = null;
  private terms = new Map<string, Promise<Record<string, string>>>();
  private chunks = new Map<number, Promise<R[]>>();
  constructor(private dir: string) {}
  loadMeta() {
    return (this.meta ??= json<ArticleMeta>(`${this.dir}/meta.json`).catch(() => null));
  }
  term(s: string): Promise<Record<string, string>> {
    let p = this.terms.get(s);
    if (!p) {
      p = json<Record<string, string>>(`${this.dir}/t/${s}.json`).catch(() => ({}));
      this.terms.set(s, p);
    }
    return p;
  }
  chunk(n: number): Promise<R[]> {
    let p = this.chunks.get(n);
    if (!p) {
      p = json<R[]>(`${this.dir}/r/${n}.json`).catch(() => {
        this.chunks.delete(n);
        return [];
      });
      this.chunks.set(n, p);
    }
    return p;
  }
}
const articleCatalog = new Sharded<ArticleRec>("makale");
const bookCatalog = new Sharded<BookRec>("kitap");

export interface BuiltinHits {
  q: string;
  dia: DiaEntry[];
  articles: ArticleRec[];
  /** Sorguyla eşleşen bütün makalelerin sayısı (gösterilenlerden fazla olabilir). */
  total: number;
  books: BookRec[];
  /** Sorguyla eşleşen bütün kitapların sayısı. */
  bookTotal: number;
}

const empty = (q: string): BuiltinHits => ({ q, dia: [], articles: [], total: 0, books: [], bookTotal: 0 });
let last: BuiltinHits = empty("");
let pending = "";
let onReady: (() => void) | null = null;

/** Sonuçlar indikçe Atıf listesini yeniden çizmek için. */
export function onBuiltinReady(fn: () => void): void {
  onReady = fn;
}

async function shardedSearch<R>(cat: Sharded<R>, rank: (q: string, recs: readonly R[]) => R[], q: string, limit: number): Promise<{ recs: R[]; total: number }> {
  const words = queryWords(q).filter((w) => w.length >= 3);
  if (!words.length) return { recs: [], total: 0 };
  const m = await cat.loadMeta();
  if (!m) return { recs: [], total: 0 };
  const have = new Set(m.shards);
  if (words.some((w) => !have.has(shardOf(w)))) return { recs: [], total: 0 };
  const shards = await Promise.all(words.map((w) => cat.term(shardOf(w))));
  const inter = (lists: number[][]) => {
    const l = [...lists].sort((a, b) => a.length - b.length);
    return l.slice(1).reduce((acc, x) => intersect(acc, x), l[0] ?? []);
  };
  // Önek eşleşmesi ("poy" -> Poyraz, Poyrazoğlu) ve tam eşleşme ("poyraz"): tam tutanlar önce.
  const ids = inter(words.map((w, i) => postingsFor(w, shards[i]!)));
  const exact = inter(words.map((w, i) => (shards[i]![w] ? decodePostings(shards[i]![w]!) : postingsFor(w, shards[i]!))));
  const ex = new Set(exact);
  const ordered = [...exact, ...ids.filter((id) => !ex.has(id))];
  // Sıralama için ilk 40 aday indirilir (aynı parçadakiler tek istekte), tam tutan yazar/başlık öne alınır.
  const top = ordered.slice(0, 40);
  const recs = (await Promise.all(top.map(async (id) => (await cat.chunk(Math.floor(id / m.per)))[id % m.per]!))).filter(Boolean);
  return { recs: rank(q, recs).slice(0, limit), total: ordered.length };
}

async function searchAll(q: string): Promise<void> {
  const [d, a, b] = await Promise.all([
    loadDia().then((x) => (x ? searchDia(q, x, 5) : [])),
    shardedSearch(articleCatalog, rankArticles, q, 15),
    shardedSearch(bookCatalog, rankBooks, q, 15),
  ]);
  if (pending !== q) return; // kullanıcı bu arada başka bir şey yazdı
  last = { q, dia: d, articles: a.recs, total: a.total, books: b.recs, bookTotal: b.total };
  onReady?.();
}

/** Bu sorgunun yerleşik veritabanı sonuçları; henüz inmediyse boş döner ve inince onBuiltinReady çağrılır. */
export function builtinHits(q: string): BuiltinHits {
  const query = q.trim();
  if (query.length < 3) return empty(query);
  if (last.q === query) return last;
  if (pending !== query) {
    pending = query;
    void searchAll(query).catch(() => undefined);
  }
  return empty(query);
}

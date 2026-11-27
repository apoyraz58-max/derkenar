/**
 * Yerleşik veritabanı parçalarını üretir (derleme sırasında `scripts/build.mjs` çağırır).
 *
 *   data/builtin/dia.rdf.gz          -> <out>/dia.json
 *   data/builtin/makale.jsonl.gz     -> <out>/makale/meta.json, makale/t/<abc>.json, makale/r/<n>.json
 *
 * dia.rdf: TDV İslâm Ansiklopedisi maddelerinin Zotero RDF'i (sabit veritabanı, kullanıcıdan istenmez).
 * makale.jsonl.gz: `katalog/catalog.py builtin-export` çıktısı, satır başına bir ArticleRec.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  ARTICLE_CATALOG,
  type ArticleMeta,
  type ArticleRec,
  DIA_CATALOG,
  type DiaData,
  type DiaEntry,
  articleWords,
  encodePostings,
  foldKey,
  shardOf,
} from "../src/core/builtin.js";
import { isnadName } from "../src/core/isnadstyle.js";

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const tag = (s: string, t: string) => {
  const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(s);
  return m ? unxml(m[1]!).trim() : undefined;
};

const upperPart = (p: string) => /\p{Lu}/u.test(p) && p === p.toLocaleUpperCase("tr") && /\p{L}{2}/u.test(p);

/**
 * Basılı nüshadaki (büyük harfli) başlık İSNAD yazımıyla. Web başlığında aynı sözcük varsa onun yazımı
 * (harf işaretleriyle) alınır; yoksa büyük harfli parça İSNAD ad yazımına çevrilir ve `guessed` döner.
 * "KAZIMIRSKI, Albin (Albert) de Biberstein" + web "Kazimirski, Albert de Biberstein"
 *   -> "Kazimirski, Albin (Albert) de Biberstein".
 */
export function printedTitle(printed: string, web = ""): { title: string; guessed: boolean } {
  if (foldKey(printed) === foldKey(web)) return { title: web, guessed: false };
  const core = (w: string) => w.replace(/^[(\["“‘]+|[)\]"”’,;:.]+$/g, "");
  const webWords = new Map(web.split(/\s+/).reverse().map((w) => [foldKey(w), core(w)]));
  let guessed = false;
  const title = printed
    .split(/(\s+)/)
    .map((w) => {
      if (!/\p{Lu}{2}/u.test(w)) return w;
      const lead = /^[(\["“‘]+/.exec(w)?.[0] ?? "";
      const tail = /[)\]"”’,;:.]+$/.exec(w)?.[0] ?? "";
      const same = webWords.get(foldKey(w));
      if (same) return lead + same + tail;
      guessed = true;
      // "ACÂİBÜ’l-MAHLÛKAT": tire ve kesme işaretinden bölünür; Arapça harf-i tarif ("’l", "el-") küçük kalır.
      return w.split(/([-’'])/).map((p) => (upperPart(p) ? isnadName(p) : p)).join("");
    })
    .join("");
  return { title, guessed };
}

/** dia.rdf -> DİA maddeleri. Tarihi cildin basım yılından farklı ya da cilt/yıl/sayfası eksik maddeler işaretlenir. */
export function diaFromRdf(xml: string): DiaData {
  const attach = new Map<string, { title: string; url: string }>();
  for (const m of xml.matchAll(/<z:Attachment rdf:about="#(item_\d+)">([\s\S]*?)<\/z:Attachment>/g)) {
    const url = tag(m[2]!, "rdf:value");
    if (url) attach.set(m[1]!, { title: tag(m[2]!, "dc:title") ?? "", url });
  }
  const memo = new Map<string, string>();
  for (const m of xml.matchAll(/<bib:Memo rdf:about="#(item_\d+)">([\s\S]*?)<\/bib:Memo>/g)) {
    const html = tag(m[2]!, "rdf:value") ?? "";
    const alias = /<strong>([\s\S]*?)<\/strong>/.exec(html)?.[1]?.trim();
    if (alias) memo.set(m[1]!, alias.replace(/<[^>]+>/g, ""));
  }
  const entries: DiaEntry[] = [];
  const pending = new Map<DiaEntry, string[]>();
  for (const m of xml.matchAll(/<rdf:Description rdf:about="#item_(\d+)">([\s\S]*?)<\/rdf:Description>/g)) {
    const body = m[2]!;
    if (tag(body, "z:itemType") !== "encyclopediaArticle") continue;
    const part = /<dcterms:isPartOf>([\s\S]*?)<\/dcterms:isPartOf>/.exec(body)?.[1] ?? "";
    const own = body.replace(/<dcterms:isPartOf>[\s\S]*?<\/dcterms:isPartOf>/, "").replace(/<dc:publisher>[\s\S]*?<\/dc:publisher>/, "");
    const web = tag(own, "dc:title");
    if (!web) continue;
    const abs = tag(own, "dcterms:abstract") ?? "";
    const printed = /Bu madde basılı nüshada "([^"]+)" başlığıyla yer almıştır\.?/.exec(abs)?.[1];
    const desc = abs.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("Bu madde basılı nüshada")).join(" ");
    const authors: [string, string][] = [];
    for (const p of own.matchAll(/<foaf:Person>([\s\S]*?)<\/foaf:Person>/g)) {
      const last = tag(p[1]!, "foaf:surname");
      if (last) authors.push([last, tag(p[1]!, "foaf:givenName") ?? ""]);
    }
    const pt = printed ? printedTitle(printed, web) : { title: web, guessed: false };
    const e: DiaEntry = { n: +m[1]!, t: pt.title, a: authors };
    if (e.t !== web) e.w = web;
    const notes: string[] = [];
    if (pt.guessed) notes.push(`basılı başlık ("${printed}") web başlığından farklı; harf yazımı denetlenmeli`);
    const v = tag(part, "prism:volume");
    if (v) e.v = v.replace(/\s+/g, "").toLocaleUpperCase("tr").replace(/^EK(\d)/, "EK-$1");
    const y = tag(own, "dc:date");
    if (y) e.y = y;
    const place = tag(body, "vcard:locality");
    if (place) e.p = place;
    const pg = tag(own, "bib:pages");
    if (pg) e.pg = pg.replace(/[–—]/g, "-");
    const ed = tag(own, "prism:edition");
    if (ed) e.e = ed;
    if (desc) e.d = desc;
    for (const l of own.matchAll(/<link:link rdf:resource="#(item_\d+)"\/>/g)) {
      const a = attach.get(l[1]!);
      if (!a) continue;
      if (/\.pdf($|\?)/i.test(a.url) && a.url.includes("/dosya/")) e.pdf = a.url.replace(/^https?:\/\/[^/]+\/dosya\//, "");
      else if (a.url.startsWith("https://islamansiklopedisi.org.tr/")) e.web = a.url.slice("https://islamansiklopedisi.org.tr/".length);
    }
    const al = [...own.matchAll(/<dcterms:isReferencedBy rdf:resource="#(item_\d+)"\/>/g)].map((r) => memo.get(r[1]!)).filter((x): x is string => !!x);
    if (al.length) e.al = [...new Set(al)];
    if (notes.length) pending.set(e, notes);
    entries.push(e);
  }
  // Cildin basım yılı ve yeri: o cildin maddelerinin çoğunun yazdığı.
  const byVol = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.v || !e.y) continue;
    const k = `${e.y}|${e.p ?? ""}|${e.e ?? ""}`;
    const m = byVol.get(e.v) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + 1);
    byVol.set(e.v, m);
  }
  const usual = new Map([...byVol].map(([v, m]) => [v, [...m].sort((a, b) => b[1] - a[1])[0]![0]]));
  for (const e of entries) {
    const r: string[] = [...(pending.get(e) ?? [])];
    if (!e.v || !e.y || !e.pg) r.push(`basılı künyede ${[!e.v && "cilt", !e.y && "yıl", !e.pg && "sayfa"].filter(Boolean).join(", ")} yok`);
    else {
      const [uy, up] = usual.get(e.v)!.split("|");
      if (uy !== e.y || (up && e.p && up !== e.p)) r.push(`tarih/yer cildin basımından farklı (${e.v}. cilt: ${up ? `${up} ` : ""}${uy}); madde sonradan güncellenmiş olabilir`);
    }
    if (!e.a.length) r.push("yazar yok");
    if (r.length) e.r = r;
  }
  entries.sort((a, b) => a.t.localeCompare(b.t, "tr"));
  return { name: DIA_CATALOG, source: `dia.rdf (${entries.length} madde)`, entries };
}

/** Makale kataloğu parçaları: kayıtlar biner biner, dizin sözcüklerin ilk üç harfine göre. */
export function articleShards(lines: string[], per = 250, maxDf = Infinity) {
  const recs = lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as ArticleRec);
  const post = new Map<string, number[]>();
  recs.forEach((r, i) => {
    for (const w of articleWords(r)) {
      const l = post.get(w);
      if (l) l.push(i);
      else post.set(w, [i]);
    }
  });
  const shards = new Map<string, Record<string, string>>();
  for (const [w, ids] of post) {
    if (ids.length > maxDf) continue; // (sınır yok: sık ad ve sözcükler de aranabilsin)
    const s = shardOf(w);
    const sh = shards.get(s) ?? {};
    sh[w] = encodePostings(ids);
    shards.set(s, sh);
  }
  const chunks: ArticleRec[][] = [];
  for (let i = 0; i < recs.length; i += per) chunks.push(recs.slice(i, i + per));
  const meta: ArticleMeta = { name: ARTICLE_CATALOG, source: `${recs.length} kesin makale`, count: recs.length, per, shards: [...shards.keys()].sort() };
  return { meta, shards, chunks };
}

export function writeBuiltin(root: URL, out: URL): string[] {
  const notes: string[] = [];
  mkdirSync(out, { recursive: true });
  const diaPath = new URL("data/builtin/dia.rdf.gz", root);
  if (existsSync(diaPath)) {
    const dia = diaFromRdf(gunzipSync(readFileSync(diaPath)).toString("utf8"));
    writeFileSync(new URL("dia.json", out), JSON.stringify(dia));
    notes.push(`DİA: ${dia.entries.length} madde (${dia.entries.filter((e) => e.r).length} işaretli)`);
  }
  // makale-1.jsonl.gz, makale-2.jsonl.gz, ... (ya da eski tek dosya makale.jsonl.gz), sırayla.
  const dir0 = new URL("data/builtin/", root);
  const parts = existsSync(dir0)
    ? readdirSync(dir0).filter((f) => /^makale(-\d+)?\.jsonl\.gz$/.test(f)).sort((a, b) => (+(/\d+/.exec(a)?.[0] ?? 0)) - (+(/\d+/.exec(b)?.[0] ?? 0)))
    : [];
  if (parts.length) {
    const lines = parts.flatMap((f) => gunzipSync(readFileSync(new URL(f, dir0))).toString("utf8").split("\n"));
    const { meta, shards, chunks } = articleShards(lines);
    const dir = new URL("makale/", out);
    mkdirSync(new URL("t/", dir), { recursive: true });
    mkdirSync(new URL("r/", dir), { recursive: true });
    writeFileSync(new URL("meta.json", dir), JSON.stringify(meta));
    for (const [s, sh] of shards) writeFileSync(new URL(`t/${s}.json`, dir), JSON.stringify(sh));
    chunks.forEach((c, i) => writeFileSync(new URL(`r/${i}.json`, dir), JSON.stringify(c)));
    notes.push(`Makale: ${meta.count} kayıt, ${shards.size} dizin parçası, ${chunks.length} kayıt parçası`);
  }
  return notes;
}

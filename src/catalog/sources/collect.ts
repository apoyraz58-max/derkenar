import { createWriteStream, type WriteStream } from "node:fs";
import { link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { setTimeout } from "node:timers/promises";
import { validIsbn } from "../model.js";

const DOAB = "https://memo.doabooks.org/file/oapen/DOAB_MARCXML.xml";
export const OZGUR_MARC = "https://www.ozguryayinlari.com/site/libraryFiles/downloadPublic/15";
const OZGUR_KBART = "https://www.ozguryayinlari.com/site/tr/libraryFiles/downloadPublic/16";
const K10 = "https://sru.k10plus.de/opac-de-627";
type Fetch = typeof fetch;

async function snapshot(url: string, file: string, fetchFn: Fetch, format: "xml" | "tsv" = "xml") {
  if (!file.endsWith(`.${format}`)) throw new Error(`İndirilen anlık görüntü için .${format} uzantısı kullanın.`);
  const temp = `${file}.${randomUUID()}.part`;
  const request = () => fetchFn(url, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
    headers: { Accept: format === "xml" ? "application/xml,text/xml,application/octet-stream" : "text/tab-separated-values,text/plain,application/octet-stream", "User-Agent": "Derkenar-Catalog/0.1" },
  });
  let response = await request();
  if ([429, 502, 503, 504].includes(response.status)) {
    const retry = response.headers.get("Retry-After");
    await response.body?.cancel();
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 3;
    if (seconds > 60 || (retry && !/^\d+$/.test(retry))) throw new Error(`Kaynak daha sonra yeniden deneme istedi (${retry}).`);
    await setTimeout(seconds * 1000);
    response = await request();
  }
  if (!response.ok || !response.body || /text\/html/i.test(response.headers.get("Content-Type") ?? "")) {
    await response.body?.cancel();
    throw new Error(`Kaynak ${format.toUpperCase()} dosyası döndürmedi (HTTP ${response.status}).`);
  }
  try {
    await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(temp, { flags: "wx" }));
    await link(temp, file);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export function collectDoab(file: string, fetchFn: Fetch = fetch) {
  return snapshot(DOAB, file, fetchFn);
}

export function collectOzgur(file: string, fetchFn: Fetch = fetch) {
  return snapshot(OZGUR_MARC, file, fetchFn);
}

export function collectOzgurKbart(file: string, fetchFn: Fetch = fetch) {
  return snapshot(OZGUR_KBART, file, fetchFn, "tsv");
}

export function collectK10plus(isbn: string, file: string, fetchFn: Fetch = fetch) {
  const normalized = validIsbn(isbn);
  if (!normalized) throw new Error("Geçerli bir ISBN gerekli.");
  const query = new URLSearchParams({ version: "1.1", operation: "searchRetrieve", query: `pica.isb=${normalized}`, maximumRecords: "20", recordSchema: "marcxml" });
  return snapshot(`${K10}?${query}`, file, fetchFn);
}

// DNB adds type="Bibliographic"; the attribute is dropped so every snapshot frames records alike.
const extractRecords = (xml: string) => (xml.match(/<record xmlns="http:\/\/www\.loc\.gov\/MARC21\/slim"[^>]*>[\s\S]*?<\/record>/g) ?? [])
  .map(r => r.replace(/^<record[^>]*>/, '<record xmlns="http://www.loc.gov/MARC21/slim">'));
const DNB = "https://services.dnb.de/sru/dnb";
const writeChunk = (out: WriteStream, text: string) => new Promise<void>((resolve, reject) =>
  out.write(text, error => error ? reject(error) : resolve()));

/**
 * Pages a K10plus SRU query into one MARCXML collection. The finished file is
 * linked into place only when every requested page arrived, so an interrupted
 * harvest never leaves a partial snapshot behind.
 */
export function collectK10plusQuery(query: string, file: string, options: { limit?: number; pageSize?: number; delayMs?: number } = {},
  fetchFn: Fetch = fetch) {
  return collectSruQuery({ base: K10, schema: "marcxml", maxPage: 500, name: "K10plus" }, query, file, options, fetchFn);
}

/** Deutsche Nationalbibliothek SRU (CC0 metadata); at most 100 records per page. */
export function collectDnbQuery(query: string, file: string, options: { limit?: number; pageSize?: number; delayMs?: number } = {},
  fetchFn: Fetch = fetch) {
  return collectSruQuery({ base: DNB, schema: "MARC21-xml", maxPage: 100, name: "DNB" }, query, file, options, fetchFn);
}

async function collectSruQuery(service: { base: string; schema: string; maxPage: number; name: string }, query: string, file: string,
  options: { limit?: number; pageSize?: number; delayMs?: number }, fetchFn: Fetch) {
  if (!file.endsWith(".xml")) throw new Error("İndirilen anlık görüntü için .xml uzantısı kullanın.");
  if (!query.trim()) throw new Error("K10plus sorgusu gerekli.");
  const pageSize = Math.min(options.pageSize ?? service.maxPage, service.maxPage);
  const temp = `${file}.${randomUUID()}.part`;
  const out = createWriteStream(temp, { flags: "wx" });
  let total = 0;
  let written = 0;
  try {
    await writeChunk(out, '<?xml version="1.0" encoding="UTF-8"?>\n<collection xmlns="http://www.loc.gov/MARC21/slim">\n');
    for (let start = 1; ; start += pageSize) {
      const want = Math.min(pageSize, (options.limit ?? Number.MAX_SAFE_INTEGER) - written);
      if (want <= 0) break;
      const params = new URLSearchParams({ version: "1.1", operation: "searchRetrieve", query, maximumRecords: String(want),
        startRecord: String(start), recordSchema: service.schema });
      let response: Response | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetchFn(`${service.base}?${params}`, { signal: AbortSignal.timeout(120_000),
          headers: { Accept: "application/xml,text/xml", "User-Agent": "Derkenar-Catalog/0.1" } }).catch(() => undefined);
        if (response?.ok) break;
        await response?.body?.cancel();
        await setTimeout(2000 * 2 ** attempt);
      }
      if (!response?.ok) throw new Error(`${service.name} ${start}. kayıttan itibaren yanıt vermedi.`);
      const page = await response.text();
      const diagnostic = /<(?:\w+:)?message>([^<]*)</.exec(page)?.[1];
      if (diagnostic && !/<(?:\w+:)?recordData>/.test(page)) throw new Error(`${service.name}: ${diagnostic}`);
      total = Number(/<(?:\w+:)?numberOfRecords>(\d+)</.exec(page)?.[1] ?? 0);
      const records = extractRecords(page);
      for (const record of records) await writeChunk(out, `${record}\n`);
      written += records.length;
      if (!records.length || start + pageSize > total) break;
      if (options.delayMs) await setTimeout(options.delayMs);
    }
    await writeChunk(out, "</collection>\n");
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()));
    await link(temp, file);
    return { query, total, written };
  } finally {
    out.destroy();
    await unlink(temp).catch(() => undefined);
  }
}

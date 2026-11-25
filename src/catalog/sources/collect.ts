import { createWriteStream } from "node:fs";
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

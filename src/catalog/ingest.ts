import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { Authority } from "./authority.js";
import { mayBeTurkish, type SourceId, type RecordInput } from "./model.js";
import { Catalog } from "./store.js";
import { exchange, fileHash, reviewed } from "./sources/files.js";
import { crossrefFile } from "./sources/crossref.js";
import { ozgurKbart } from "./sources/kbart.js";
import { marcFile } from "./sources/marc.js";

export async function ingestFile(catalog: Catalog, source: SourceId, file: string, options: { limit?: number; authority?: Authority; onlyTurkey?: boolean } = {}) {
  const revision = async () => {
    const info = await stat(file, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  };
  const initial = await revision();
  const verify = async () => {
    if (await revision() !== initial) throw new Error("Toplama sırasında kaynak dosyası değiştirildi.");
  };
  const hash = await fileHash(file);
  await verify();
  const status = catalog.job(source, hash, basename(file), options.authority);
  if (status.state === "completed") return status;
  let records: AsyncIterable<RecordInput>;
  if (source === "exchange") {
    const original = await readFile(file, "utf8");
    catalog.archiveExchange(hash, original);
    records = exchange(original, basename(file), hash);
  } else if (source === "k10plus" || source === "doab" || source === "ozgur") {
    records = marcFile(file, source);
  } else if (source === "crossref") {
    records = crossrefFile(file);
  } else if (source === "ozgur-kbart") {
    records = ozgurKbart(file);
  } else if (source === "ozgur-kunye") {
    records = reviewed(file, /^https:\/\/(?:www\.)?ozguryayinlari\.com\/site\/(?:tr\/|en\/)?catalog\/download\/\d+\/\d+\/\d+$/i);
  } else if (source === "ttk" || source === "asbu") {
    records = reviewed(file);
  } else {
    throw new Error("Bu kaynak için otomatik arşivleme etkin değil.");
  }
  const keep = options.onlyTurkey ? mayBeTurkish : undefined;
  let cursor = status.cursor;
  let skipped = 0;
  let added = 0;
  let pending: RecordInput[] = [];
  for await (const record of records) {
    if (skipped < status.cursor) { skipped++; continue; }
    if (added === options.limit) {
      await verify();
      catalog.batch(source, hash, cursor, pending, false, options.authority, keep);
      return { cursor: cursor + pending.length, state: "paused" };
    }
    pending.push(record);
    added++;
    if (pending.length === 200) {
      await verify();
      catalog.batch(source, hash, cursor, pending, false, options.authority, keep);
      cursor += pending.length;
      pending = [];
    }
  }
  await verify();
  catalog.batch(source, hash, cursor, pending, true, options.authority, keep);
  return { cursor: cursor + pending.length, state: "completed" };
}

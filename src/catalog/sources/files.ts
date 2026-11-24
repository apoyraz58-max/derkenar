import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { creatorFull, liftExtraRoles, parseExtra, type Item } from "../../core/zotero.js";
import { parseFile } from "../../core/importers.js";
import { type Attribution, type RecordInput, textValue } from "../model.js";

export async function fileHash(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function inputStream(file: string) {
  const stream = createReadStream(file);
  if (!file.endsWith(".gz")) return stream;
  const gzip = createGunzip();
  stream.on("error", error => gzip.destroy(error));
  gzip.on("close", () => stream.destroy());
  return stream.pipe(gzip);
}

export async function* lines(file: string) {
  const stream = inputStream(file);
  try {
    yield* createInterface({ input: stream, crlfDelay: Infinity });
  } finally {
    stream.destroy();
  }
}

export async function* reviewed(file: string) {
  for await (const line of lines(file)) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!r.id || !/^https:\/\//.test(r.url) || !r.fields || !Array.isArray(r.creators)) throw new Error("Pilot satırı eksik.");
    const fields = Object.entries(r.fields).flatMap(([field, value]) => {
      const entry = value as { value: unknown; label: string };
      return typeof entry.value === "string" && entry.label ? [{ field, value: entry.value, path: entry.label }] : [];
    });
    const creators = (r.creators as Attribution[]).filter(c => c.path && creatorFull(c.creator));
    yield { id: r.id, url: r.url, raw: line, fields, creators } satisfies RecordInput;
  }
}

export function itemRecord(item: Item, raw: string, id: string, url: string): RecordInput {
  const lifted = liftExtraRoles(item);
  const medium = parseExtra(lifted.fields.extra).csl.medium;
  const fields = Object.entries(lifted.fields).filter(([field, value]) => field !== "extra" && textValue(value))
    .map(([field, value]) => ({ field, value, path: `fields.${field}` }));
  if (medium) fields.push({ field: "format", value: medium, path: "fields.extra / Medium" });
  return {
    id, url, raw, fields,
    creators: lifted.creators.map((creator, position) => ({ creator, path: `creators[${position}]` })),
  };
}

export async function* exchange(text: string, file: string, hash: string) {
  const result = await parseFile(text, file);
  for (const [index, item] of result.items.entries()) {
    if (item.itemType !== "book") continue;
    yield itemRecord(item, JSON.stringify(item), `${hash}:${index + 1}`, `urn:sha256:${hash}#item-${index + 1}`);
  }
}

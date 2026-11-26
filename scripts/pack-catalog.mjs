// Packs the reviewed catalog into the add-in: node scripts/pack-catalog.mjs <catalog.json>
// Only the entries the review left unmarked go in (marked ones wait for their check);
// empty fields are dropped and the file is gzipped (data/catalog/catalog.json.gz).
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, strToU8 } from "fflate";

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/pack-catalog.mjs <catalog.json>");
const data = JSON.parse(await readFile(src, "utf8"));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)));
const entries = data.entries
  .filter((e) => !e.review?.length)
  .map(({ source, category, review, ...e }) => ({ ...clean(e), authors: e.authors.map(clean) }));
const counts = {};
for (const e of entries) counts[e.catalog || data.name] = (counts[e.catalog || data.name] || 0) + 1;
const out = { name: data.name, source: `Derkenar ile gelen katalog: ${Object.entries(counts).map(([k, n]) => `${k} ${n.toLocaleString("tr-TR")}`).join(", ")} eser`, entries };
const gz = gzipSync(strToU8(JSON.stringify(out)), { level: 9 });
await writeFile(new URL("../data/catalog/catalog.json.gz", import.meta.url), gz);
console.log(`${entries.length} eser (${JSON.stringify(counts)}), ${(gz.length / 1024).toFixed(0)} KB`);

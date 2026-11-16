// Trims Zotero's data schema (https://github.com/zotero/zotero-schema, served at
// https://api.zotero.org/schema) to what Derkenar needs: item types, fields,
// creator types, CSL mappings, Turkish and English labels.
// Update:  curl -o data/zotero/schema.json https://api.zotero.org/schema && node scripts/schema.mjs
import { readFile, writeFile } from "node:fs/promises";

const s = JSON.parse(await readFile(new URL("../data/zotero/schema.json", import.meta.url), "utf8"));
const SKIP = new Set(["annotation", "attachment", "note"]);
const labels = (l) => ({ itemTypes: s.locales[l].itemTypes, fields: s.locales[l].fields, creatorTypes: s.locales[l].creatorTypes });
const out = {
  version: s.version,
  itemTypes: s.itemTypes
    .filter((t) => !SKIP.has(t.itemType))
    .map((t) => ({
      itemType: t.itemType,
      fields: t.fields.map((f) => (f.baseField ? [f.field, f.baseField] : [f.field])),
      creatorTypes: t.creatorTypes.map((c) => c.creatorType),
    })),
  dateFields: Object.entries(s.meta.fields).filter(([, v]) => v.type === "date").map(([k]) => k),
  csl: s.csl,
  labels: { tr: labels("tr-TR"), en: labels("en-US") },
};
await writeFile(new URL("../src/core/zschema.json", import.meta.url), JSON.stringify(out));
console.log(`schema ${s.version}: ${out.itemTypes.length} item types`);

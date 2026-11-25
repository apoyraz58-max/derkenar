import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cslJson, formatAs } from "../core/exporters.js";
import { renderEdition } from "./citation.js";
import { zoteroRdf } from "../core/zoteroexport.js";
import { loadAuthority } from "./authority.js";
import { Catalog } from "./store.js";
import { serve } from "./panel.js";
import { ingestFile } from "./ingest.js";
import { collectDoab, collectK10plus, collectOzgur, collectOzgurKbart } from "./sources/collect.js";
import { SOURCES, type SourceId } from "./model.js";

const HELP = `Derkenar bibliyografik katalog • Node.js 22.13+
  npm run catalog -- pilot     --db DB [--vefeyat CSV]
  npm run catalog -- ingest    --db DB --source ttk|asbu|k10plus|doab|ozgur|ozgur-kbart|exchange --file DOSYA [--vefeyat CSV] [--limit N]
  npm run catalog -- collect   --source doab|k10plus|ozgur|ozgur-kbart --file DOSYA [--isbn ISBN]
  npm run catalog -- stats     --db DB
  npm run catalog -- show      --db DB --id N
  npm run catalog -- cite      --db DB --id N [--first SAYFA] [--later SAYFA] [--volume CİLT]
  npm run catalog -- export    --db DB --format csl-json|bibtex|ris|zotero-rdf --file DOSYA [--limit N] [--after N]
  npm run catalog -- serve     --db DB [--port PORT]
`;

async function main() {
  const { positionals: [command], values: o } = parseArgs({
    allowPositionals: true,
    options: {
      db: { type: "string" }, source: { type: "string" }, file: { type: "string" }, vefeyat: { type: "string" },
      limit: { type: "string" }, after: { type: "string" }, format: { type: "string" }, id: { type: "string" },
      isbn: { type: "string" }, first: { type: "string" }, later: { type: "string" }, volume: { type: "string" },
      port: { type: "string" }, help: { type: "boolean" },
    },
  });
  if (o.help || !command) { console.log(HELP); return; }
  const required = (name: "file" | "db" | "isbn") => {
    if (!o[name]) throw new Error(`--${name} gerekli.`);
    return o[name]!;
  };
  const integer = (value: string, min = 1, max = Number.MAX_SAFE_INTEGER) => {
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Geçersiz tamsayı: ${value}`);
    return n;
  };
  const output = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === "collect") {
    if (o.source === "doab") await collectDoab(required("file"));
    else if (o.source === "ozgur") await collectOzgur(required("file"));
    else if (o.source === "ozgur-kbart") await collectOzgurKbart(required("file"));
    else if (o.source === "k10plus") await collectK10plus(required("isbn"), required("file"));
    else throw new Error("Toplama kaynağı doab, k10plus, ozgur veya ozgur-kbart olmalı.");
    return;
  }
  if (command === "serve") {
    const db = new Catalog(required("db"), true);
    serve(db, integer(o.port ?? "4179", 1, 65535));
    return;
  }
  const db = new Catalog(required("db"), !["ingest", "pilot"].includes(command));
  try {
    switch (command) {
      case "pilot": {
        const authority = o.vefeyat ? loadAuthority(o.vefeyat) : undefined;
        const sources = [
          ["ttk", "data/catalog/pilot/ttk.jsonl"],
          ["asbu", "data/catalog/pilot/asbu.jsonl"],
          ["k10plus", "test/fixtures/k10plus-9786054791712.xml"],
        ] as const;
        for (const [source, file] of sources) {
          const path = fileURLToPath(new URL(`../${file}`, import.meta.url));
          await ingestFile(db, source, path, { authority });
        }
        output(db.stats());
        break;
      }
      case "ingest": {
        if (!o.source || !Object.prototype.hasOwnProperty.call(SOURCES, o.source) || o.source === "openlibrary") throw new Error("Arşivlemeye açık kaynak seçin.");
        const authority = o.vefeyat ? loadAuthority(o.vefeyat) : undefined;
        const result = await ingestFile(db, o.source as SourceId, required("file"), {
          limit: o.limit ? integer(o.limit) : undefined, authority,
        });
        output(result);
        break;
      }
      case "stats":
        output(db.stats());
        break;
      case "show": {
        const detail = db.details(integer(o.id ?? ""));
        if (!detail) throw new Error("Baskı bulunamadı.");
        output(detail);
        break;
      }
      case "cite": {
        const item = db.item(integer(o.id ?? ""));
        if (!item) throw new Error("Baskı bulunamadı.");
        const readStyle = (file: string) => readFileSync(new URL(`../data/styles/${file}`, import.meta.url), "utf8");
        output(renderEdition(item, readStyle, o));
        break;
      }
      case "export": {
        const rows = db.ids(integer(o.after ?? "0", 0), integer(o.limit ?? "1000", 1, 10000));
        const items = rows.map(r => db.item(r.id)!);
        let data: string;
        if (o.format === "csl-json") data = cslJson(items);
        else if (o.format === "zotero-rdf") data = zoteroRdf(items, []);
        else if (o.format === "ris" || o.format === "bibtex") data = await formatAs(items, o.format);
        else throw new Error("Geçersiz dışa aktarma biçimi.");
        await writeFile(required("file"), data, { flag: "wx" });
        output({ count: rows.length, after: rows.at(-1)?.id ?? null });
        break;
      }
      default:
        throw new Error(`Komut tanınmadı: ${command}\n${HELP}`);
    }
  } finally { db.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

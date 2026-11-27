// Not a test: how well "Serbest künye" reads İSNAD text back.
// The guide's records are rendered by Künye (dipnot and kaynakça), parsed back, and compared field by field.
//   REPORT=path npx vitest run --config vitest.report.config.ts test/report.freetext.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { parseReference } from "../src/core/freetext.js";
import { htmlToText } from "../src/core/html.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
import { type Item, typeField } from "../src/core/zotero.js";

const dir = new URL("../data/styles/", import.meta.url);
const loc = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8");
  } catch {
    return undefined;
  }
};
const TYPES = new Set(["book", "bookSection", "journalArticle", "encyclopediaArticle", "thesis"]);
const norm = (s?: string) => (s ?? "").normalize("NFC").replace(/[’'ʼ]/g, "'").replace(/^["“](.*)["”]$/, "$1").replace(/\s+/g, " ").trim().replace(/^(y\.y\.|b\.y\.)$/, "");

function fieldsOf(it: Item): Record<string, string> {
  const f = it.fields;
  const pick = (base: string) => norm(f[typeField(it.itemType, base) ?? base]);
  const first = it.creators.find((c) => c.creatorType === "author");
  return {
    title: norm(f.title),
    author: norm(first?.lastName ?? first?.name),
    // Years only ("Haziran 2015" and "2015-06" are the same year); hicrî/milâdî and ranges as written.
    date: /\//.test(norm(f.date)) || /^\d{4}-\d{4}$/.test(norm(f.date)) ? norm(f.date) : (/\d{4}/.exec(norm(f.date))?.[0] ?? ""),
    place: pick("place"),
    publisher: pick("publisher"),
    container: pick("publicationTitle"),
    // A record's Cilt is often the number of volumes ("4 Cilt" in the bibliography): either field counts.
    volume: /\d/.test(f.volume ?? "") ? norm(f.volume) : norm(f.numberOfVolumes),
    issue: norm(f.issue),
  };
}

it("report freetext", () => {
  const items = parseZoteroRdf(readFileSync(new URL("./fixtures/isnad/isnad2-eserler.rdf", import.meta.url), "utf8").normalize("NFC"), "g").items.filter((i) => TYPES.has(i.itemType) && i.fields.title);
  const score: Record<string, [number, number]> = {};
  const out: string[] = [];
  let parsed = 0;
  let total = 0;
  for (const form of ["dipnot", "kaynakça"] as const) {
    for (const it of items) {
      const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", dir), "utf8"), loc);
      const st = emptyState();
      putCitation(st, "a", [{ id: it.key }], { [it.key]: it });
      const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], r);
      const text = form === "dipnot" ? htmlToText(p.updates.get("a")!) : htmlToText(p.bibliography!.entries[0]!.html);
      total++;
      const got = parseReference(text);
      if (!got) {
        out.push(`✗ okunamadı (${form}, ${it.itemType}): ${text}`);
        continue;
      }
      parsed++;
      const want = fieldsOf(it);
      const have = fieldsOf(got.item);
      const wrong: string[] = [];
      for (const [k, v] of Object.entries(want)) {
        if (!v || (form === "dipnot" && (k === "volume" || k === "issue") && it.itemType !== "journalArticle")) continue;
        const ok = norm(have[k]) === v || (k === "volume" && norm(got.item.fields.numberOfVolumes) === v);
        score[k] = [(score[k]?.[0] ?? 0) + (ok ? 1 : 0), (score[k]?.[1] ?? 0) + 1];
        if (!ok) wrong.push(`${k}: "${have[k]}" ≠ "${v}"`);
      }
      if (got.item.itemType !== it.itemType) wrong.push(`tür: ${got.item.itemType} ≠ ${it.itemType}`);
      if (wrong.length) out.push(`✗ ${form}, ${it.itemType}: ${text}\n     ${wrong.join("\n     ")}`);
    }
  }
  const head = `Serbest künye: ${total} metinden ${parsed} tanesi okundu.\n` + Object.entries(score).map(([k, [a, b]]) => `  ${k}: ${a}/${b}`).join("\n") + "\n\n";
  writeFileSync(process.env.REPORT ?? "freetext-report.txt", head + out.join("\n"));
  console.log(head);
});

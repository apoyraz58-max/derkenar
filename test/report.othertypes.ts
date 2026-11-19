// Not a test: how well "Serbest künye" reads back the guide's other kinds of work (software, patents, art works …).
// Each record is rendered (dipnot, kaynakça), parsed back, rendered again and compared.
//   REPORT=path npx vitest run --config vitest.report.config.ts test/report.othertypes.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { parseReference } from "../src/core/freetext.js";
import { htmlToText } from "../src/core/html.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
const dir = new URL("../data/styles/", import.meta.url);
const loc = (l: string) => { try { return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8"); } catch { return undefined; } };
const SKIP = new Set(["book", "bookSection", "journalArticle", "encyclopediaArticle", "thesis"]);
it("other", () => {
  const items = parseZoteroRdf(readFileSync(new URL("./fixtures/isnad/isnad2-eserler.rdf", import.meta.url), "utf8").normalize("NFC"), "g").items.filter((i) => !SKIP.has(i.itemType) && i.fields.title);
  const out: string[] = [];
  const tally: Record<string, [number, number]> = {};
  for (const form of ["dipnot", "kaynakça"]) for (const it of items) {
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", dir), "utf8"), loc);
    const st = emptyState();
    putCitation(st, "a", [{ id: it.key }], { [it.key]: it });
    const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], r);
    const text = form === "dipnot" ? htmlToText(p.updates.get("a")!) : htmlToText(p.bibliography!.entries[0]!.html);
    const got = parseReference(text);
    let same = false;
    if (got) {
      const g = { ...got.item, key: "B" } as typeof it;
      const st2 = emptyState();
      putCitation(st2, "a", [{ id: "B" }], { B: g });
      const p2 = planRefresh(st2, [{ id: "a", noteIndex: 1, text: "" }], new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", dir), "utf8"), loc));
      const back = form === "dipnot" ? htmlToText(p2.updates.get("a")!) : htmlToText(p2.bibliography!.entries[0]!.html);
      same = back === text;
      if (!same && got.item.itemType === it.itemType) out.push(`≠ ${form} ${it.itemType}\n   kaynak: ${text}\n   tekrar: ${back}`);
    }
    if (same) (tally["=same"] ??= [0, 0])[0]++;
    (tally["=same"] ??= [0, 0])[1]++;
    const ok = got && got.item.itemType === it.itemType && (got.item.fields.title ?? "").replace(/[’']/g,"'") === it.fields.title!.replace(/[’']/g,"'");
    const t = (tally[it.itemType] ??= [0, 0]); t[1]++; if (ok) t[0]++;
    if (!ok) out.push(`✗ ${form} ${it.itemType}: ${text}\n   → ${got ? got.item.itemType + " | " + got.item.fields.title : "null"}`);
  }
  writeFileSync(process.env.REPORT!, Object.entries(tally).map(([k, [a, b]]) => `${k}: ${a}/${b}`).join("\n") + "\n\n" + out.join("\n"));
});

// Not a test: how well "Seçili kaynakçayı oku" reads the guide's own bibliography entries.
// Each entry is read as a typed bibliography line would be, rendered back by Derkenar and compared with the guide.
//   REPORT=path npx vitest run --config vitest.report.config.ts test/report.bibliography.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { parseReference } from "../src/core/freetext.js";
import { htmlToText } from "../src/core/html.js";

const styles = new URL("../data/styles/", import.meta.url);
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, styles), "utf8");
  } catch {
    return undefined;
  }
};
// Addresses broken across lines in the PDF ("yemen _raporu") and quote marks are not counted.
const norm = (s: string) => s.normalize("NFC").replace(/[’'ʼ]/g, "'").replace(/\s+/g, " ").replace(/https?:\/\/.*$/, (u) => u.replace(/\s+/g, "")).trim();

it("bibliography report", () => {
  const ex = JSON.parse(readFileSync(new URL("./fixtures/isnad/guide-examples.json", import.meta.url), "utf8")) as { no: string; title: string; bib?: string[] }[];
  const renderer = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
  let total = 0, read = 0, same = 0;
  const out: string[] = [];
  for (const e of ex) {
    for (const line of e.bib ?? []) {
      total++;
      const r = parseReference(line);
      if (!r?.item.fields.title && !r?.item.fields.docketNumber) {
        out.push(`✗ ${e.no} ${e.title}\n   kılavuz:  ${line}  [okunamadı]`);
        continue;
      }
      read++;
      const st = emptyState();
      const it = { ...r.item, key: "B" };
      putCitation(st, "a", [{ id: "B" }], { B: it });
      const back = htmlToText(planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], renderer).bibliography!.entries[0]!.html);
      if (norm(back) === norm(line)) same++;
      else out.push(`≠ ${e.no} ${e.title} (${r.item.itemType})\n   kılavuz:  ${line}\n   derkenar: ${back}`);
    }
  }
  writeFileSync(process.env.REPORT!, `Kılavuz kaynakçası okundu: ${total} satırdan ${read} tanesi okundu; ${same} tanesi Derkenar'da basılınca kılavuzdakinin aynısı.\n\n${out.join("\n")}\n`);
});

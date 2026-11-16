// Not a test: writes Derkenar's İSNAD output for every example of the İSNAD 2 guide.
//   npx vitest run test/report.isnad.ts --config vitest.report.config.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
import { creatorLine, titleOf } from "../src/core/zotero.js";
const dir = new URL("../data/styles/", import.meta.url);
const loc = (l: string) => { try { return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8"); } catch { return undefined; } };
it("report", () => {
  const { items } = parseZoteroRdf(readFileSync(new URL("fixtures/isnad/isnad2-eserler.rdf", import.meta.url), "utf8"), "file:isnad");
  const out: string[] = [];
  items.sort((a, b) => a.itemType.localeCompare(b.itemType));
  for (const item of items) {
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", dir), "utf8"), loc);
    const st = emptyState();
    putCitation(st, "a", [{ id: item.key, locator: "12" }], { [item.key]: item });
    putCitation(st, "b", [{ id: item.key, locator: "13" }], {});
    const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
    out.push(`## ${item.itemType} | ${creatorLine(item)} | ${titleOf(item)}\n  fields: ${JSON.stringify(item.fields)}\n  creators: ${JSON.stringify(item.creators)}\n  1: ${htmlToText(p.updates.get("a")!)}\n  2: ${htmlToText(p.updates.get("b")!)}\n  K: ${htmlToText(p.bibliography!.entries[0]!.html)}`);
  }
  writeFileSync(process.env.REPORT ?? "isnad-report.txt", out.join("\n"));
});

// Not a test: Derkenar in English against the ISNAD Citation Style 2nd Edition (English manual).
//   REPORT=path npx vitest run --config vitest.report.config.ts test/report.en.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
import { titleOf } from "../src/core/zotero.js";
import { loose } from "./report.isnad.js";

const dir = new URL("../data/styles/", import.meta.url);
const loc = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8");
  } catch {
    return undefined;
  }
};

it("report en", () => {
  const manual = loose(readFileSync(new URL("./fixtures/isnad/isnad-en-2.txt", import.meta.url), "utf8").normalize("NFC").replace(/-\n\s*/g, "-").replace(/\s+/g, " "));
  const items = parseZoteroRdf(readFileSync(new URL("./fixtures/isnad/isnad2-eserler.rdf", import.meta.url), "utf8").normalize("NFC"), "g").items.filter((i) => titleOf(i));
  let found = 0;
  let same = 0;
  const out: string[] = [];
  for (const item of items) {
    const r = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", dir), "utf8"), loc, "en-US");
    const st = emptyState();
    putCitation(st, "a", [{ id: item.key }], { [item.key]: item });
    const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], r);
    const first = loose(htmlToText(p.updates.get("a")!)).replace(/\.$/, "");
    const t = loose(titleOf(item)).slice(0, 25);
    const at = manual.indexOf(t);
    if (at < 0) continue;
    found++;
    if (manual.includes(first)) {
      same++;
      continue;
    }
    // The manual's text around the title, for comparison.
    const start = Math.max(0, manual.lastIndexOf("Example", at));
    out.push(`✗ ${item.itemType}\n   derkenar: ${first}\n   kılavuz:  ${manual.slice(start, at + 180)}`);
  }
  const head = `İngilizce kılavuz: başlığı kılavuzda geçen ${found} eserden ${same} tanesinin ilk atıfı kılavuzda aynen var.\n\n`;
  writeFileSync(process.env.REPORT ?? "isnad-en.txt", head + out.join("\n"));
  console.log(head);
});

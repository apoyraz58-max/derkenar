// Not a test: compares Künye's İSNAD metin içi output with the guide (s. 141-).
//   REPORT=path npx vitest run --config vitest.report.config.ts test/report.metinici.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
import { fold } from "../src/core/search.js";
import { type Item, titleOf } from "../src/core/zotero.js";
import { loose } from "./report.isnad.js";

const dir = new URL("../data/styles/", import.meta.url);
const loc = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8");
  } catch {
    return undefined;
  }
};
const style = readFileSync(new URL("isnad-metinici.csl", dir), "utf8");
interface Section { no: string; title: string; page: number; first: string[]; later: string[]; direct: string[]; bib: string[] }
const strip = (s: string) => loose(s.replace(/^(\.\.\.|…)\s*/, "").replace(/\)\.$/, ")"));

function render(item: Item, locator: string) {
  const r = new Renderer(style, loc);
  const st = emptyState("isnad-metinici");
  putCitation(st, "a", [{ id: item.key, ...(locator ? { locator } : {}) }], { [item.key]: item });
  const p = planRefresh(st, [{ id: "a", noteIndex: 0, text: "" }], r);
  return { cite: htmlToText(p.updates.get("a")!), bib: htmlToText(p.bibliography!.entries[0]!.html) };
}

it("report metinici", () => {
  const { items } = parseZoteroRdf(readFileSync(new URL("fixtures/isnad/isnad2-eserler.rdf", import.meta.url), "utf8"), "file:isnad");
  const sections = JSON.parse(readFileSync(new URL("fixtures/isnad/guide-metinici.json", import.meta.url), "utf8")) as Section[];
  const out: string[] = [];
  const summary: string[] = [];
  let total = 0;
  let ok = 0;
  for (const sec of sections) {
    let n = 0;
    let good = 0;
    const lines: string[] = [];
    for (const bibEx of sec.bib) {
      const fx = fold(bibEx);
      const cands = items.map((i) => ({ i, t: [titleOf(i), i.fields.dictionaryTitle, i.fields.shortTitle].filter((t): t is string => Boolean(t && t.length > 3 && fx.includes(fold(t)))).sort((a, b) => b.length - a.length)[0] })).filter((c) => c.t);
      cands.sort((a, b) => b.t!.length - a.t!.length);
      const item = cands[0]?.i;
      if (!item) {
        lines.push(`  ? eşleşmedi: ${bibEx}`);
        continue;
      }
      const bare = render(item, "");
      const cite = strip(bare.cite);
      const firstEx = sec.first.find((x) => strip(x) === cite) ?? sec.first.find((x) => strip(x).startsWith(cite.replace(/\)$/, "").split(",")[0]!)) ?? "";
      const marked = strip(render(item, "@@").cite);
      const [pre, post] = marked.split("@@") as [string, string];
      const directEx = sec.direct.find((x) => strip(x).startsWith(pre ?? "") && strip(x).endsWith(post ?? "")) ?? "";
      const locator = directEx ? strip(directEx).slice((pre ?? "").length, strip(directEx).length - (post ?? "").length) : "";
      const direct = locator ? strip(render(item, locator).cite) : "";
      for (const [kind, want, got] of [["ilk", firstEx ? strip(firstEx) : "", cite], ["doğrudan", directEx ? strip(directEx) : "", direct], ["kaynakça", bibEx, bare.bib]] as const) {
        n++;
        total++;
        if (want && (want === got || loose(want) === loose(got))) {
          good++;
          ok++;
        } else lines.push(`  ✗ ${kind}\n     kılavuz: ${want || "(bulunamadı)"}\n     derkenar: ${got}`);
      }
    }
    summary.push(`${sec.no} ${sec.title} (s. ${sec.page}): ${good}/${n}`);
    if (lines.length) out.push(`## ${sec.no} ${sec.title} (s. ${sec.page})`, ...lines);
  }
  const head = `Metin içi: ${total} karşılaştırmadan ${ok} uyuşuyor.\n`;
  writeFileSync(process.env.REPORT ?? "isnad-metinici.txt", head + summary.join("\n") + "\n\n" + out.join("\n"));
  console.log(head);
});

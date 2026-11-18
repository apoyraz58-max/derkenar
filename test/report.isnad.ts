// Not a test: compares Derkenar with every example of the İSNAD 2 guide (dipnotlu, s. 68-137).
//   npm run report:isnad   (REPORT=path for the detailed list)
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { parseZoteroRdf } from "../src/core/rdf.js";
import { citeMode } from "../src/core/isnadmodes.js";
import { fold } from "../src/core/search.js";
import { type Item, titleOf } from "../src/core/zotero.js";

const dir = new URL("../data/styles/", import.meta.url);
const loc = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, dir), "utf8");
  } catch {
    return undefined;
  }
};
const style = readFileSync(new URL("isnad-dipnotlu.csl", dir), "utf8");
interface Section { no: string; title: string; page: number; first: string[]; later: string[]; bib: string[] }

/** Typography the guide itself is not consistent about. */
export function loose(s: string): string {
  return s.replace(/(https?:\/\/\S+)\s+(?=\S)/g, "$1").replace(/[’‘ʼ`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
}

function render(item: Item, l1: string, l2: string) {
  const r = new Renderer(style, loc);
  const st = emptyState();
  const mode = citeMode(item);
  const label = mode === "kuran" || mode === "incil" ? "verse" : mode === "hadis-bab" || mode === "hadis-no" ? "book" : undefined;
  putCitation(st, "a", [{ id: item.key, ...(l1 ? { locator: l1, ...(label ? { label } : {}) } : {}) }], { [item.key]: item });
  putCitation(st, "b", [{ id: item.key, ...(l2 ? { locator: l2, ...(label ? { label } : {}) } : {}) }], {});
  const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }, { id: "b", noteIndex: 2, text: "" }], r);
  return { first: htmlToText(p.updates.get("a")!), later: htmlToText(p.updates.get("b")!), bib: htmlToText(p.bibliography!.entries[0]!.html) };
}

/** Locator the guide used: what follows our locator-less rendering. */
function locatorOf(example: string, without: string): string | null {
  const base = loose(without).replace(/\.$/, "");
  const ex = loose(example);
  if (!ex.startsWith(base)) return null;
  const rest = ex.slice(base.length).replace(/^,\s*/, "").replace(/\.$/, "");
  return rest;
}

const label = (i: Item) => {
  const m = citeMode(i);
  return m === "kuran" || m === "incil" ? "verse" : m === "hadis-bab" || m === "hadis-no" ? "book" : undefined;
};

const titles = (i: Item) => [titleOf(i), i.fields.dictionaryTitle, i.fields.bookTitle, i.fields.encyclopediaTitle, i.fields.shortTitle, i.fields.docketNumber ? `K. ${i.fields.docketNumber}` : ""].filter((t): t is string => Boolean(t && t.length > 3));

it("report", () => {
  const { items } = parseZoteroRdf(readFileSync(new URL("fixtures/isnad/isnad2-eserler.rdf", import.meta.url), "utf8"), "file:isnad");
  const sections = JSON.parse(readFileSync(new URL("fixtures/isnad/guide-examples.json", import.meta.url), "utf8")) as Section[];
  const lines: string[] = [];
  const summary: string[] = [];
  let total = 0;
  let exact = 0;
  let near = 0;
  for (const sec of sections) {
    let ok = 0;
    let n = 0;
    const out: string[] = [];
    for (const ex of sec.first) {
      const fx = fold(ex);
      const cands = items
        .map((i) => ({ i, t: titles(i).filter((t) => fx.includes(fold(t))).sort((a, b) => b.length - a.length)[0], who: i.creators.some((c) => (c.lastName ?? c.name) && fx.includes(fold(c.lastName ?? c.name ?? ""))) }))
        .filter((c) => c.t);
      cands.sort((a, b) => Number(b.who) - Number(a.who) || b.t!.length - a.t!.length);
      const item = cands[0]?.i;
      if (!item) {
        out.push(`  ? eşleşmedi: ${ex}`);
        continue;
      }
      const bare = render(item, "", "");
      // Where the locator goes: render with a marker and take what precedes it.
      const mark = render(item, "@@", "@@");
      const cut = (example: string, marked: string): string | null => {
        const i = marked.indexOf("@@");
        if (i < 0) return null;
        const before = loose(marked.slice(0, i));
        const after = loose(marked.slice(i + 2));
        const e = loose(example);
        if (!e.startsWith(before) || !e.endsWith(after)) return null;
        return e.slice(before.length, e.length - after.length);
      };
      const vol = item.fields.volume?.trim();
      const strip = (l: string) => (vol && l.startsWith(`${vol}/`) ? l.slice(vol.length + 1) : l);
      const l1 = strip(cut(ex, mark.first) ?? locatorOf(ex, bare.first) ?? "");
      const laterEx = sec.later.find((x) => cut(x, mark.later) !== null) ?? sec.later.find((x) => loose(x).startsWith(loose(bare.later).replace(/\.$/, ""))) ?? (label(item) ? (sec.later[sec.first.indexOf(ex)] ?? "") : "");
      const l2 = strip(laterEx ? (cut(laterEx, mark.later) ?? locatorOf(laterEx, bare.later) ?? (label(item) === "verse" ? laterEx.replace(/\.$/, "") : "")) : "");
      const r = render(item, l1, l2);
      const bibEx = sec.bib.find((x) => loose(x) === loose(r.bib)) ?? sec.bib.find((x) => fold(x).includes(fold(titleOf(item)).slice(0, 25))) ?? "";
      for (const [kind, want, got] of [["ilk", ex, r.first], ["sonraki", laterEx, r.later], ["kaynakça", bibEx, r.bib]] as const) {
        n++;
        total++;
        if (want === got) {
          ok++;
          exact++;
        } else if (want && (loose(want) === loose(got) || (kind === "kaynakça" && loose(want).includes(loose(got))))) {
          ok++;
          near++;
        } else out.push(`  ✗ ${kind}\n     kılavuz: ${want || "(bulunamadı)"}\n     derkenar: ${got}`);
      }
    }
    summary.push(`${sec.no} ${sec.title} (s. ${sec.page}): ${ok}/${n}`);
    if (out.length) lines.push(`## ${sec.no} ${sec.title} (s. ${sec.page})`, ...out);
  }
  const head = `Toplam ${total} karşılaştırma: ${exact} birebir, ${near} yalnız dizgi farkıyla, ${total - exact - near} farklı.\n`;
  writeFileSync(process.env.REPORT ?? "isnad-report.txt", head + summary.join("\n") + "\n\n" + lines.join("\n"));
  console.log(head);
});

// Not a test: how well "Elle yazılmış dipnotlar" reads the guide's own footnotes.
// Each example's first and later footnotes are read in order, as a thesis written by hand would have them;
// a later note should find the work of its first note (one record, not two).
//   REPORT=path npx vitest run --config vitest.report.config.ts test/report.handnotes.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { readHandNotes } from "../src/core/handnotes.js";
import { htmlToText } from "../src/core/html.js";

const styles = new URL("../data/styles/", import.meta.url);
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, styles), "utf8");
  } catch {
    return undefined;
  }
};
const norm = (s: string) => s.normalize("NFC").replace(/[’'ʼ]/g, "'").replace(/\s+/g, " ").trim();

interface Example {
  no: string;
  title: string;
  first: string[];
  later: string[];
}

it("handnotes report", () => {
  const ex = JSON.parse(readFileSync(new URL("./fixtures/isnad/guide-examples.json", import.meta.url), "utf8")) as Example[];
  let firsts = 0, firstOk = 0, laters = 0, laterOk = 0, same = 0;
  const renderer = new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales);
  const back: string[] = [];
  const out: string[] = [];
  for (const e of ex) {
    const notes: string[] = [];
    const pairs: [number, number][] = [];
    e.first.forEach((f, i) => {
      notes.push(f);
      const later = e.later[i];
      if (later) {
        notes.push(later);
        pairs.push([notes.length - 2, notes.length - 1]);
      }
    });
    const read = readHandNotes(notes, []);
    // Rendered back by Künye: the same footnote as the guide's, when the fields were read right.
    const st = emptyState();
    const order = read.flatMap((n, i) => {
      if (!n.refs) return [];
      putCitation(st, `c${i}`, n.refs.map((x) => ({ id: x.item.key, ...(x.volume ? { volume: x.volume } : {}), ...(x.locator ? { locator: x.locator } : {}), ...(x.label ? { label: x.label } : {}), ...(x.kitap ? { kitap: x.kitap, bab: x.bab, cumle: x.cumle } : {}), ...(x.kitab ? { kitab: x.kitab, ...(x.bab ? { bab: x.bab } : {}), ...(x.hadisNo ? { hadisNo: x.hadisNo } : {}) } : {}), ...(x.sure ? { sure: x.sure, ayet: x.ayet } : {}), ...(x.madde ? { madde: x.madde } : {}), ...(x.prefix ? { prefix: x.prefix } : {}) })), Object.fromEntries(n.refs.map((x) => [x.item.key, x.item])));
      return [{ id: `c${i}`, noteIndex: i + 1, text: "" }];
    });
    const plan = order.length ? planRefresh(st, order, renderer) : null;
    for (const [a] of pairs) {
      const got = plan?.updates.get(`c${a}`);
      if (!got) continue;
      if (norm(htmlToText(got)) === norm(notes[a]!)) same++;
      else back.push(`≠ ${e.no}\n   kılavuz:  ${notes[a]}\n   derkenar: ${htmlToText(got)}`);
    }
    for (const [a, b] of pairs) {
      firsts++;
      laters++;
      const fa = read[a]!;
      const fb = read[b]!;
      if (fa.refs) firstOk++;
      const same = fa.refs && fb.refs && fa.refs[0]!.item === fb.refs[0]!.item;
      if (same) laterOk++;
      if (!fa.refs || !same) out.push(`✗ ${e.no} ${e.title}\n   ilk:     ${fa.text}${fa.refs ? "" : `  [${fa.reason}]`}\n   sonraki: ${fb.text}${fb.refs ? (same ? "" : `  [başka esere gitti: ${fb.refs[0]!.item.fields.title}]`) : `  [${fb.reason}]`}`);
    }
  }
  const head = `Kılavuz dipnotları elle yazılmış gibi okundu: ${firsts} ilk atıftan ${firstOk} tanesi okundu; ${laters} sonraki atıftan ${laterOk} tanesi ilk atıftaki esere bağlandı. Okunan ilk atıflardan ${same} tanesi Künye'de basılınca kılavuzdakinin aynısı.\n\n`;
  writeFileSync(process.env.REPORT ?? "isnad-handnotes.txt", head + out.join("\n") + "\n\n— Geri basınca farklı çıkanlar —\n" + back.join("\n"));
  console.log(head);
});

// Not a test: how well "Elle yazılmış dipnotlar" reads the guide's own footnotes.
// Each example's first and later footnotes are read in order, as a thesis written by hand would have them;
// a later note should find the work of its first note (one record, not two).
//   REPORT=path npx vitest run --config vitest.report.config.ts test/report.handnotes.ts
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { readHandNotes } from "../src/core/handnotes.js";

interface Example {
  no: string;
  title: string;
  first: string[];
  later: string[];
}

it("handnotes report", () => {
  const ex = JSON.parse(readFileSync(new URL("./fixtures/isnad/guide-examples.json", import.meta.url), "utf8")) as Example[];
  let firsts = 0, firstOk = 0, laters = 0, laterOk = 0;
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
  const head = `Kılavuz dipnotları elle yazılmış gibi okundu: ${firsts} ilk atıftan ${firstOk} tanesi okundu; ${laters} sonraki atıftan ${laterOk} tanesi ilk atıftaki esere bağlandı.\n\n`;
  writeFileSync(process.env.REPORT ?? "isnad-handnotes.txt", head + out.join("\n"));
  console.log(head);
});

/**
 * Belge → Elle yazılmış dipnotlar: footnotes typed by hand become Derkenar
 * citations in place (the note, its number and its place stay). First a
 * look at what would change; then the change, which Word's Undo takes back.
 */
import { type HandNote, readHandNotes } from "../../core/handnotes.js";
import { newCitationId, putCitation } from "../../core/docstate.js";
import type { CiteRef } from "../../core/types.js";
import { type Item, creatorLine, titleOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { $, S, doc, h, putItems, run, serial, setMessage } from "./core.js";
import { refresh } from "./document.js";
import { isnadFix } from "./io.js";

let plan: HandNote[] = [];

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

function describe(n: HandNote): string {
  return n.refs!.map((r) => `${r.prefix ? `${r.prefix} ` : ""}${creatorLine(r.item) || "—"}, ${short(titleOf(r.item), 50)}${r.volume ? `, c. ${r.volume}` : ""}${r.locator ? `, s. ${r.locator}` : ""}${r.isNew ? " (yeni)" : ""}`).join("; ");
}

async function scan(): Promise<void> {
  if (!word.footnotesSupported()) throw new Error("Bu Word sürümü dipnotları okumaya izin vermiyor (WordApi 1.5 gerekir).");
  const notes = await serial(() => word.handNotes());
  if (!notes.length) {
    $("hand-result").replaceChildren(h("p", { class: "muted small" }, "Elle yazılmış dipnot yok; bütün dipnotlar zaten Derkenar atıfı ya da belge dipnotsuz."));
    return;
  }
  // The notes are read in order, so "a.g.e." and short forms find the work cited before them.
  const read = readHandNotes(notes.map((n) => n.text), S.items);
  plan = read.map((r, i) => ({ ...r, index: notes[i]!.index }));
  const ok = plan.filter((p) => p.refs);
  const kept = plan.filter((p) => !p.refs && p.text);
  const fresh = new Set(ok.flatMap((p) => p.refs!.filter((r) => r.isNew).map((r) => r.item)));
  $("hand-result").replaceChildren(
    h("p", { class: "small" }, `${notes.length} dipnottan ${ok.length} tanesi atıfa çevrilebilir${fresh.size ? `; ${fresh.size} eser kütüphanede yok, eklenecek` : ""}. ${kept.length ? `${kept.length} dipnot (açıklama ya da okunamayan) olduğu gibi kalır.` : ""}`),
    h(
      "ol",
      { class: "hand-list small" },
      ...plan.filter((p) => p.text).slice(0, 200).map((p) =>
        h("li", { value: String(p.index + 1), class: p.refs ? "" : "muted" }, h("div", { class: "hand-src" }, short(p.text, 140)), h("div", { class: p.refs ? "hand-to" : "hand-keep" }, p.refs ? `→ ${describe(p)}` : `kalır: ${p.reason}`)),
      ),
    ),
    ok.length ? h("button", { type: "button", class: "primary", onclick: () => void run("Dipnotlar çevriliyor", convert) }, `${ok.length} dipnotu atıfa çevir`) : h("p", { class: "muted small" }, "Çevrilecek dipnot yok."),
  );
}

async function convert(): Promise<void> {
  const ok = plan.filter((p) => p.refs);
  if (!ok.length) return;
  const d = doc();
  // New works: İSNAD fixes as for any added record, then into the library.
  const fresh = [...new Set(ok.flatMap((p) => p.refs!.filter((r) => r.isNew).map((r) => r.item)))];
  const fixed = [...fresh];
  const fixedNote = isnadFix(fixed);
  const byKey = new Map<string, Item>(fixed.map((i) => [i.key, i]));
  if (fixed.length) await putItems(fixed);
  const writes: { index: number; id: string; segments: { text: string }[] }[] = [];
  for (const p of ok) {
    const refs: CiteRef[] = p.refs!.map((r) => ({ id: r.item.key, ...(r.volume ? { volume: r.volume } : {}), ...(r.locator ? { locator: r.locator } : {}), ...(r.prefix ? { prefix: r.prefix } : {}) }));
    const works = Object.fromEntries(refs.map((r) => [r.id, byKey.get(r.id) ?? S.byKey.get(r.id) ?? d.items[r.id]!]));
    const id = newCitationId();
    putCitation(d, id, refs, works);
    writes.push({ index: p.index, id, segments: [{ text: p.text }] });
  }
  const done = await serial(() => word.replaceNotes(writes));
  await word.saveState(d);
  // İSNAD's first full, then short references, a.g.e. … are written by the refresh.
  await refresh(false, true);
  plan = [];
  $("hand-result").replaceChildren();
  setMessage(`${done} dipnot Derkenar atıfına çevrildi; ilk geçişler tam, sonrakiler kısa künye oldu.${fresh.length ? ` ${fresh.length} eser kütüphaneye eklendi.` : ""}${fixedNote} Eski elle yazılmış kaynakçayı silip Kaynakça ekle ile Derkenar'ınkini koyabilirsiniz.`, "success");
}

export function wireHandNotes(): void {
  $("hand-scan").onclick = () => void run("Dipnotlar okunuyor", scan);
}

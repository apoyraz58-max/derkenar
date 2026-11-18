/**
 * Belge → Elle yazılmış dipnotlar: footnotes typed by hand become Derkenar
 * citations in place (the note, its number and its place stay). First a
 * look at what would change; then the change, which Word's Undo takes back.
 */
import { type HandInText, type HandNote, readHandNotes, readInText } from "../../core/handnotes.js";
import { newCitationId, putCitation } from "../../core/docstate.js";
import type { CiteRef } from "../../core/types.js";
import { type Item, creatorLine, titleOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { $, S, doc, getRenderer, h, putItems, run, serial, setMessage } from "./core.js";
import { refresh } from "./document.js";
import { isnadFix } from "./io.js";
import { existingCopy } from "../../core/library.js";
import { expandSameAuthor, parseReference, splitReferences } from "../../core/freetext.js";

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
  // İSNAD's first full, then short references (never a.g.e.) are written by the refresh.
  await refresh(false, true);
  plan = [];
  $("hand-result").replaceChildren();
  setMessage(`${done} dipnot Derkenar atıfına çevrildi; ilk geçişler tam, sonrakiler kısa künye oldu (İSNAD gereği a.g.e. kullanılmaz).${fresh.length ? ` ${fresh.length} eser kütüphaneye eklendi.` : ""}${fixedNote} Eski elle yazılmış kaynakçayı silip Kaynakça ekle ile Derkenar'ınkini koyabilirsiniz.`, "success");
}

// ---------------------------------------------------------------- a bibliography typed by hand

interface BibLine {
  text: string;
  item: Item | null;
  isNew: boolean;
}
let bib: { text: string; lines: BibLine[] } | null = null;

/** A heading inside the list ("KAYNAKÇA", "Makaleler", "B. Arşiv Belgeleri"): no year, no punctuation of a reference. */
const isHeading = (l: string) => l.length < 60 && !/\d{3,4}|[“”"]|:\s/.test(l);

function readBibliography(text: string): BibLine[] {
  const created: Item[] = [];
  // Headings out first (a heading has no full stop and would be joined to the next reference).
  const raw = text.split("\n").map((l) => l.trim());
  const kept = raw.filter((l, i) => l && !(isHeading(l) && !/[.)]$/.test(l) && (i === 0 || !raw[i - 1] || /[.)\]]$/.test(raw[i - 1]!))));
  return expandSameAuthor(splitReferences(kept.join("\n")))
    .map((l) => {
      const r = parseReference(l);
      if (!r || !r.item.fields.title) return { text: l, item: null, isNew: false };
      const old = existingCopy(r.item, [...S.items, ...created]);
      if (old) return { text: l, item: old, isNew: created.includes(old) };
      const item = { ...r.item, source: "kaynakca" };
      created.push(item);
      return { text: l, item, isNew: true };
    });
}

async function scanBibliography(): Promise<void> {
  const text = (await serial(() => word.selectionText())).trim();
  if (text.length < 20) throw new Error("Önce Word'de elle yazılmış kaynakçanın tamamını seçin (başlığıyla ya da başlıksız), sonra yeniden basın.");
  const lines = readBibliography(text);
  bib = { text, lines };
  const read = lines.filter((l) => l.item);
  const unread = lines.filter((l) => !l.item);
  const fresh = read.filter((l) => l.isNew).length;
  $("hand-bib-result").replaceChildren(
    h("p", { class: "small" }, `${lines.length} künyeden ${read.length} tanesi okundu${fresh ? ` (${fresh} eser kütüphanede yok, eklenecek)` : ""}.${unread.length ? ` ${unread.length} satır okunamadı; seçili metin bu yüzden yerinde bırakılacak, eserler yine de kütüphaneye ve kaynakçaya girer.` : " Seçili metnin yerine Derkenar kaynakçası gelecek."}`),
    h(
      "ol",
      { class: "hand-list small" },
      ...lines.slice(0, 300).map((l) => h("li", { class: l.item ? "" : "muted" }, h("div", { class: "hand-src" }, short(l.text, 140)), h("div", { class: l.item ? "hand-to" : "hand-keep" }, l.item ? `→ ${creatorLine(l.item) || "—"}, ${short(titleOf(l.item), 60)}${l.isNew ? " (yeni)" : ""}` : "okunamadı"))),
    ),
    read.length ? h("button", { type: "button", class: "primary", onclick: () => void run("Kaynakça çevriliyor", convertBibliography) }, unread.length ? `${read.length} eseri kütüphaneye ve kaynakçaya al` : "Derkenar kaynakçasına çevir") : h("p", { class: "muted small" }, "Okunan künye yok."),
  );
}

async function convertBibliography(): Promise<void> {
  if (!bib) return;
  const now = (await serial(() => word.selectionText())).trim();
  if (now !== bib.text) {
    bib = null;
    $("hand-bib-result").replaceChildren();
    throw new Error("Seçim değişti. Kaynakçayı yeniden seçip Seçili kaynakçayı oku'ya basın.");
  }
  const d = doc();
  const read = bib.lines.filter((l) => l.item);
  const fresh = [...new Set(read.filter((l) => l.isNew).map((l) => l.item!))];
  const fixedNote = isnadFix(fresh);
  if (fresh.length) await putItems(fresh);
  const fixed = new Map(fresh.map((i) => [i.key, i]));
  // Works listed though not cited stay in the bibliography.
  const cited = new Set(Object.values(d.citations).flatMap((c) => c.items.map((r) => r.id)));
  const uncited = new Set(d.bibUncited ?? []);
  for (const l of read) {
    const it = fixed.get(l.item!.key) ?? S.byKey.get(l.item!.key) ?? l.item!;
    if (!cited.has(it.key)) {
      uncited.add(it.key);
      d.items[it.key] = it;
    }
  }
  d.bibUncited = [...uncited];
  const unread = bib.lines.length - read.length;
  const replaced = unread ? false : await serial(() => word.selectionToBibliography());
  await word.saveState(d);
  await refresh(false, true);
  bib = null;
  $("hand-bib-result").replaceChildren();
  setMessage(
    `${read.length} eser kaynakçaya alındı${fresh.length ? `, ${fresh.length} tanesi kütüphaneye eklendi` : ""}.${fixedNote} ${replaced ? "Elle yazılmış kaynakçanın yerinde artık Derkenar kaynakçası var." : unread ? `Okunamayan ${unread} satır yüzünden elle yazılmış kaynakça yerinde bırakıldı; Kaynakça ekle ile Derkenar'ınkini koyup eskisini silin.` : "Belgede zaten bir Derkenar kaynakçası var; elle yazılmış olanı silebilirsiniz."}`,
    unread ? "warning" : "success",
  );
}

// ---------------------------------------------------------------- in-text citations typed by hand

let inText: { found: HandInText[]; counts: Record<string, number> } | null = null;

async function scanInText(): Promise<void> {
  const r = await getRenderer();
  if (r.meta.note) throw new Error("Belgenin stili dipnotlu. Metin içi atıfları çevirmek için önce Belge → Atıf stili'ni metin içi bir stile (İSNAD metin içi, APA …) çevirin.");
  const text = await serial(() => word.documentText());
  const found = readInText(text, S.items);
  if (!found.length) {
    $("hand-intext-result").replaceChildren(h("p", { class: "muted small" }, "Kütüphanedeki bir eserle eşleşen elle yazılmış metin içi atıf bulunamadı. Eserler kütüphanede değilse önce kaynakçayı okutun (yukarıda)."));
    return;
  }
  const counts = await serial(() => word.countInBody(found.map((f) => f.match)));
  const usable = found.filter((f) => counts[f.match]);
  inText = { found: usable, counts };
  const total = usable.reduce((n, f) => n + counts[f.match]!, 0);
  $("hand-intext-result").replaceChildren(
    h("p", { class: "small" }, `${total} metin içi atıf kütüphanedeki eserlerle eşleşti.`),
    h("ol", { class: "hand-list small" }, ...usable.slice(0, 200).map((f) => h("li", {}, h("div", { class: "hand-src" }, `${f.match}${counts[f.match]! > 1 ? ` (${counts[f.match]} yerde)` : ""}`), h("div", { class: "hand-to" }, `→ ${f.refs.map((x) => `${x.prefix ? `${x.prefix} ` : ""}${creatorLine(x.item) || "—"}, ${short(titleOf(x.item), 50)}${x.locator ? `, s. ${x.locator}` : ""}`).join("; ")}`)))),
    total ? h("button", { type: "button", class: "primary", onclick: () => void run("Atıflar çevriliyor", convertInText) }, `${total} atıfı çevir`) : h("p", { class: "muted small" }, "Çevrilecek atıf yok."),
  );
}

async function convertInText(): Promise<void> {
  if (!inText) return;
  const d = doc();
  const writes = inText.found.map((f) => {
    const refs: CiteRef[] = f.refs.map((r) => ({ id: r.item.key, ...(r.volume ? { volume: r.volume } : {}), ...(r.locator ? { locator: r.locator } : {}), ...(r.prefix ? { prefix: r.prefix } : {}) }));
    const works = Object.fromEntries(refs.map((r) => [r.id, S.byKey.get(r.id) ?? d.items[r.id]!]));
    const ids = Array.from({ length: inText!.counts[f.match]! }, () => {
      const id = newCitationId();
      putCitation(d, id, refs, works);
      return id;
    });
    return { text: f.match, ids, segments: [{ text: f.match }] };
  });
  const done = await serial(() => word.replaceInBody(writes));
  // Citations Word did not find again (the text changed meanwhile) are dropped from the state.
  await word.saveState(d);
  await refresh(false, true);
  inText = null;
  $("hand-intext-result").replaceChildren();
  setMessage(`${done} metin içi atıf Derkenar atıfına çevrildi.`, "success");
}

export function wireHandNotes(): void {
  $("hand-intext-scan").onclick = () => void run("Metin okunuyor", scanInText);
  $("hand-bib-scan").onclick = () => void run("Kaynakça okunuyor", scanBibliography);
  $("hand-scan").onclick = () => void run("Dipnotlar okunuyor", scan);
}

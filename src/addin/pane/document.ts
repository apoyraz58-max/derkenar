/**
 * The document side: refreshing citations and the bibliography, the
 * automatic-update watcher, document preferences, unlinking.
 *
 * Automatic updates: while the pane is open (Derkenar asks Word to open it
 * with the document), the order of citations is read every 1.5 s and after
 * every cursor move. Reading the order costs two round trips and no text.
 * When a footnote with a citation is added before another, deleted, cut and
 * pasted, or moved, the order changes and the citations are re-rendered: the
 * first citation of a work becomes the full form, later ones the short form.
 */
import { type FoundCitation, commitPlan, newCitationId, planRefresh, signature, syncWorks } from "../../core/docstate.js";
import { htmlToSegments, htmlToText } from "../../core/html.js";
import { BUILTIN_STYLES } from "../../core/styles.js";
import { type Item, now } from "../../core/zotero.js";
import * as word from "../word.js";
import { $, S, doc, getRenderer, h, putItems, renderSummary, run, saveLibraryCopy, serial, setMessage, styleTitle } from "./core.js";

let order: FoundCitation[] = [];
let orphans = new Set<string>();
let lastSignature: string | null = null;

/**
 * Re-renders every citation in document order; writes only those whose text
 * changed (and the bibliography when it changed). `force` rewrites everything.
 */
export function refresh(force = false, quiet = false): Promise<void> {
  return serial(async () => {
    const r = await getRenderer();
    const d = doc();
    syncWorks(d, (k) => S.byKey.get(k));
    const started = performance.now();
    const result = await word.refreshDocument((found) => {
      const retag = new Map<number, string>();
      const seen = new Set<string>();
      const list = found.map((f, i) => {
        if (!seen.has(f.id)) {
          seen.add(f.id);
          return f;
        }
        // A citation copied within the document gets its own id.
        const fresh = newCitationId();
        const c = d.citations[f.id];
        if (c) d.citations[fresh] = JSON.parse(JSON.stringify(c)) as typeof c;
        retag.set(i, fresh);
        return { ...f, id: fresh };
      });
      const plan = planRefresh(d, list, r, force);
      commitPlan(d, plan);
      order = list;
      orphans = new Set(plan.orphans);
      lastSignature = signature(list);
      const citations = new Map([...plan.updates].map(([id, html]) => [id, htmlToSegments(html)]));
      const entries = plan.bibliographyChanged && plan.bibliography ? plan.bibliography.entries : null;
      const bib = entries ? entries.map((e) => (e.heading ? [{ text: e.html, bold: true }] : htmlToSegments(e.html))) : null;
      const bibliographyHeadings = new Set((entries ?? []).flatMap((e, i) => (e.heading ? [i] : [])));
      return { citations, bibliography: bib, hangingIndent: plan.bibliography?.hangingIndent ?? true, bibliographyHeadings, retag };
    });
    await word.saveState(d);
    const secs = ((performance.now() - started) / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
    $("refresh-stat").textContent = `${result.citations} atıf ${secs} sn'de denetlendi; ${result.written} tanesi yeniden yazıldı. ${watcherInfo()}`.trim();
    renderDocList();
    const edited = Object.keys(d.edited ?? {}).length;
    if (edited && !quiet) $("refresh-stat").textContent += ` ${edited} atıf Word'de elle değiştirildiği için güncellenmedi (Denetim'de seçin).`;
    if (!quiet) {
      const warn = (orphans.size ? ` ${orphans.size} atıfın verisi bu belgede yok (başka belgeden kopyalanmış olabilir).` : "") + (edited ? ` ${edited} atıf Word'de elle değiştirilmiş; korunuyor (Denetim → Bu belgede atıf yapılan kaynaklar).` : "");
      setMessage(`Belge güncellendi.${warn}`, warn ? "warning" : "success");
    }
  });
}

// ---------------------------------------------------------------- watcher

let watching = false;
let ticking = false;
let tickTimer = 0;
let quietTicks = 0;
/** Last time a read of the citation order took (ms); the pace follows it. */
let lastCost = 0;

/**
 * The pace of the watcher: every 1.5 s in a small document; in a long thesis
 * where one read takes long, so many times that read's length that Word stays
 * free for typing (at most 8 s); slower again after half a minute without a
 * change. Adding, deleting or moving a footnote moves the cursor, and a
 * cursor move asks for a read at once (nudge), so changes are still caught
 * straight away.
 */
function nextDelay(): number {
  const byCost = Math.min(8000, Math.max(1500, lastCost * 8));
  return quietTicks > 20 ? Math.max(byCost, 4000) : byCost;
}

function schedule(ms = nextDelay()): void {
  window.clearTimeout(tickTimer);
  tickTimer = window.setTimeout(() => void tick(), ms);
}

async function tick(): Promise<void> {
  if (ticking || document.hidden || doc().auto === false) return schedule();
  ticking = true;
  try {
    const started = performance.now();
    const found = await serial(() => word.readOrder());
    lastCost = performance.now() - started;
    const sig = signature(found);
    if (lastSignature === null || sig !== lastSignature) {
      const first = lastSignature === null;
      quietTicks = 0;
      await refresh(false, true);
      if (!first && found.length) $("refresh-stat").textContent += " (otomatik)";
    } else quietTicks++;
  } catch {
    /* the document may be busy (typing, dialog): try again on the next tick */
  } finally {
    ticking = false;
    schedule();
  }
}

export function nudge(): void {
  quietTicks = 0;
  schedule(300);
}

/** How the watcher is doing, for the Belge tab. */
export function watcherInfo(): string {
  return lastCost ? `Otomatik denetim ${Math.round(nextDelay() / 100) / 10} sn'de bir (bir okuma ${Math.round(lastCost)} ms).` : "";
}

export function startWatcher(): void {
  if (watching) return;
  watching = true;
  document.addEventListener("visibilitychange", nudge);
  void tick();
}

// ---------------------------------------------------------------- list and prefs

export function renderDocList(): void {
  const d = doc();
  const ol = $("doc-citations");
  ol.replaceChildren();
  order.forEach((f, i) => {
    const orphan = orphans.has(f.id);
    const text = orphan ? `${f.text || "(metin yok)"} — verisi yok` : htmlToText(d.rendered[f.id] ?? "") || f.text;
    ol.append(h("li", { class: orphan ? "orphan" : "", onclick: () => void run("Atıf seçiliyor", () => serial(() => word.selectCitation(f.id))) }, h("span", { class: "n" }, f.noteIndex ? `dn. ${f.noteIndex}` : `${i + 1}.`), text));
  });
  if (!order.length) ol.append(h("li", { class: "muted" }, "Henüz atıf yok."));
}

/** Citations in document order, as last read. */
export function currentOrder(): readonly FoundCitation[] {
  return order;
}

export function citedKeys(): Set<string> {
  const d = doc();
  const ids = order.length ? order.map((o) => o.id) : Object.keys(d.citations);
  return new Set(ids.flatMap((id) => d.citations[id]?.items.map((r) => r.id) ?? []));
}

function renderPrefs(): void {
  const d = doc();
  const sel = $<HTMLSelectElement>("style");
  sel.replaceChildren(...BUILTIN_STYLES.map((s) => h("option", { value: s.id, selected: s.id === d.style }, s.title)));
  $<HTMLSelectElement>("locale").value = d.locale;
  $<HTMLSelectElement>("notes-kind").value = d.notes ?? "footnote";
  $<HTMLInputElement>("auto").checked = d.auto !== false;
  $<HTMLInputElement>("keep-library").checked = d.keepLibrary !== false;
  $<HTMLInputElement>("bib-title").value = d.bibTitle ?? "Kaynakça";
  $<HTMLInputElement>("bib-sections").checked = d.bibSections === true;
}

async function changeStyle(id: string): Promise<void> {
  const d = doc();
  const before = await getRenderer();
  d.style = id;
  d.rendered = {};
  const after = await getRenderer();
  renderSummary();
  // Dipnotlu ↔ metin içi: the citations move with the style.
  let note = "";
  if (before.meta.note !== after.meta.note) {
    const r = await serial(() => word.convertPlacement(after.meta.note));
    if (r.moved) note += after.meta.note ? ` ${r.moved} atıf dipnota taşındı.` : ` ${r.moved} atıf dipnottan metne taşındı.`;
    if (r.kept) note += ` İçinde açıklama da olan ${r.kept} dipnot yerinde bırakıldı; onları elle düzenleyin.`;
  }
  await refresh(true, true);
  setMessage(`Stil: ${styleTitle(id)}.${note}${note ? " Geri almak için Word'de Geri Al." : ""}`, note.includes("yerinde bırakıldı") ? "warning" : "success");
}

export async function bibliography(): Promise<void> {
  const r = await getRenderer();
  if (!r.meta.hasBibliography) throw new Error("Bu stilin kaynakçası yok.");
  const made = await serial(() => word.ensureBibliography(doc().bibTitle ?? "Kaynakça"));
  doc().bibliographyHtml = undefined;
  await refresh(false, true);
  setMessage(made === "created" ? "Kaynakça eklendi; atıflarla birlikte kendiliğinden güncellenir." : "Kaynakça güncellendi.", "success");
}

let unlinkArmed = false;
function unlink(): void {
  const b = $("unlink");
  if (!unlinkArmed) {
    unlinkArmed = true;
    b.textContent = "Emin misiniz? Tekrar tıklayın";
    window.setTimeout(() => {
      unlinkArmed = false;
      b.textContent = "Düz metne çevir";
    }, 4000);
    return;
  }
  unlinkArmed = false;
  b.textContent = "Düz metne çevir";
  void run("Düz metne çevriliyor", async () => {
    const n = await serial(() => word.unlinkAll());
    doc().auto = false;
    await word.saveState(doc());
    order = [];
    renderDocList();
    renderPrefs();
    setMessage(`${n} atıf ve kaynakça düz metne çevrildi; otomatik güncelleme kapatıldı. Geri almak için Word'de Geri Al.`, "success");
  });
}

export function wireDocument(): void {
  renderPrefs();
  $<HTMLSelectElement>("style").onchange = () => void run("Stil uygulanıyor", () => changeStyle($<HTMLSelectElement>("style").value));
  $<HTMLSelectElement>("locale").onchange = () =>
    void run("Dil uygulanıyor", async () => {
      doc().locale = $<HTMLSelectElement>("locale").value;
      await refresh(true);
    });
  $<HTMLSelectElement>("notes-kind").onchange = () =>
    void run("Kaydediliyor", async () => {
      doc().notes = $<HTMLSelectElement>("notes-kind").value as "footnote" | "endnote";
      await word.saveState(doc());
      setMessage(doc().notes === "endnote" ? "Yeni atıflar sonnota eklenecek." : "Yeni atıflar dipnota eklenecek.", "success");
    });
  $<HTMLInputElement>("keep-library").onchange = () =>
    void run("Kaydediliyor", async () => {
      doc().keepLibrary = $<HTMLInputElement>("keep-library").checked;
      await word.saveState(doc());
      if (doc().keepLibrary) await saveLibraryCopy();
      setMessage(doc().keepLibrary ? "Kütüphanenin kopyası bu belgede saklanıyor." : "Kütüphane kopyası artık bu belgeye yazılmayacak (var olan kopya duruyor).", "success");
    });
  $<HTMLInputElement>("auto").onchange = () =>
    void run("Kaydediliyor", async () => {
      doc().auto = $<HTMLInputElement>("auto").checked;
      await word.saveState(doc());
      if (doc().auto) nudge();
    });
  $<HTMLInputElement>("bib-title").onchange = () =>
    void run("Kaydediliyor", async () => {
      doc().bibTitle = $<HTMLInputElement>("bib-title").value.trim();
      await word.saveState(doc());
    });
  $<HTMLInputElement>("bib-sections").onchange = () =>
    void run("Kaynakça yenileniyor", async () => {
      doc().bibSections = $<HTMLInputElement>("bib-sections").checked;
      await refresh(false, true);
      setMessage(doc().bibSections ? "Kaynakça türlere ayrıldı (Yazma Eserler, Kitaplar, Makaleler …)." : "Kaynakça tek liste oldu.", "success");
    });
  $("refresh").onclick = () => void run("Belge güncelleniyor", () => refresh(true));
  $("bibliography").onclick = () => void run("Kaynakça hazırlanıyor", bibliography);
  $("unlink").onclick = unlink;
  $("import-doc").onclick = () =>
    void run("Aktarılıyor", async () => {
      const add: Item[] = Object.entries(doc().items)
        .filter(([k]) => !S.byKey.has(k))
        .map(([key, it]) => ({ ...it, key, source: "belge", dateModified: now() }));
      await putItems(add);
      setMessage(add.length ? `${add.length} kaynak kütüphaneye alındı.` : "Belgedeki kaynakların hepsi zaten kütüphanede.", "success");
    });
}

export { changeStyle };

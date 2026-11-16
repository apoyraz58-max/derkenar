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
      const bib = plan.bibliographyChanged && plan.bibliography ? plan.bibliography.entries.map((e) => htmlToSegments(e.html)) : null;
      return { citations, bibliography: bib, hangingIndent: plan.bibliography?.hangingIndent ?? true, retag };
    });
    await word.saveState(d);
    const secs = ((performance.now() - started) / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
    $("refresh-stat").textContent = `${result.citations} atıf ${secs} sn'de denetlendi; ${result.written} tanesi yeniden yazıldı.`;
    renderDocList();
    if (!quiet) {
      const warn = orphans.size ? ` ${orphans.size} atıfın verisi bu belgede yok (başka belgeden kopyalanmış olabilir).` : "";
      setMessage(`Belge güncellendi.${warn}`, warn ? "warning" : "success");
    }
  });
}

// ---------------------------------------------------------------- watcher

let watching = false;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking || document.hidden || doc().auto === false) return;
  ticking = true;
  try {
    const found = await serial(() => word.readOrder());
    const sig = signature(found);
    if (lastSignature === null || sig !== lastSignature) {
      const first = lastSignature === null;
      await refresh(false, true);
      if (!first && found.length) $("refresh-stat").textContent += " (otomatik)";
    }
  } catch {
    /* the document may be busy (typing, dialog): try again on the next tick */
  } finally {
    ticking = false;
  }
}

let tickTimer = 0;
export function nudge(): void {
  window.clearTimeout(tickTimer);
  tickTimer = window.setTimeout(() => void tick(), 300);
}

export function startWatcher(): void {
  if (watching) return;
  watching = true;
  window.setInterval(() => void tick(), 1500);
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
}

async function changeStyle(id: string): Promise<void> {
  const d = doc();
  const before = await getRenderer();
  d.style = id;
  d.rendered = {};
  const after = await getRenderer();
  renderSummary();
  await refresh(true, true);
  const moved = before.meta.note !== after.meta.note && order.length;
  setMessage(
    `Stil: ${styleTitle(id)}.${moved ? (after.meta.note ? " Metindeki atıflar metinde kaldı; yeni atıflar dipnota girer." : " Dipnottaki atıflar dipnotta kaldı; yeni atıflar metne girer.") : ""}`,
    moved ? "warning" : "success",
  );
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

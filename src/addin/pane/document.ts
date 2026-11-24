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
import { type FoundCitation, commitPlan, newCitationId, planRefresh, putCitation, signature, syncWorks } from "../../core/docstate.js";
import type { CiteRef, CslItem } from "../../core/types.js";
import { htmlToSegments, htmlToText } from "../../core/html.js";
import { BUILTIN_STYLES } from "../../core/styles.js";
import { abbreviationList, usedAbbreviations } from "../../core/abbreviations.js";
import { type Item, creatorLine, now, titleOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { $, type CustomStyle, S, customStyles, doc, getRenderer, h, putItems, renderSummary, run, saveCustomStyles, saveLibraryCopy, serial, setMessage, styleTitle } from "./core.js";

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
      // Kısaltmalar listesi: from the citations, the bibliography and the last scan of the text.
      const citeText = [...list.map((f) => htmlToText(d.rendered[f.id] ?? "")), ...(plan.bibliography?.entries ?? []).filter((e) => !e.heading).map((e) => htmlToText(e.html))].join("\n");
      const abbr = abbreviationList(citeText, d.abbrDoc ?? [], d.locale);
      const abbrSig = abbr.map((x) => x.join("=")).join("|");
      const abbreviations = abbrSig !== d.abbrSig ? abbr.map(([a, m]) => [{ text: a }, { text: `\t${m}` }]) : null;
      d.abbrSig = abbrSig;
      return { citations, bibliography: bib, hangingIndent: plan.bibliography?.hangingIndent ?? true, bibliographyHeadings, abbreviations, retag };
    });
    await word.saveState(d);
    const secs = ((performance.now() - started) / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
    $("refresh-stat").textContent = `${result.citations} atıf ${secs} sn'de denetlendi; ${result.written} tanesi yeniden yazıldı. ${watcherInfo()}`.trim();
    renderDocList();
    if (($("bib-edit") as HTMLDetailsElement).open) renderBibEdit();
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

// ---------------------------------------------------------------- documents of another citation program

/** Shows the conversion box when the document has citation fields of another program. */
export async function checkForeign(): Promise<void> {
  if (!word.fieldsSupported()) return;
  try {
    const { isZoteroFieldCode } = await import("../../core/zoterodoc.js");
    const codes = (await serial(() => word.fieldCodes())).filter((f) => isZoteroFieldCode(f.code));
    const cites = codes.filter((f) => /ZOTERO_ITEM/.test(f.code)).length;
    $("foreign-box").hidden = !codes.length;
    if (!codes.length) return;
    $("foreign-info").textContent = `Bu belgede başka bir atıf programıyla eklenmiş ${cites} atıf${codes.length > cites ? " ve bir kaynakça" : ""} var. Derkenar onları güncelleyemez.`;
  } catch {
    /* fields cannot be read here */
  }
}

async function convertForeign(): Promise<void> {
  const { parseZoteroField } = await import("../../core/zoterodoc.js");
  const { copyFinder } = await import("../../core/library.js");
  const { fromCsl } = await import("../../core/zotero.js");
  const d = doc();
  const fresh = new Map<string, Item>();
  const copies = copyFinder(S.items);
  let inNotes = 0;
  let inText = 0;
  const keyFor = (w: { key?: string; data: CslItem }): string => {
    if (w.key && (S.byKey.has(w.key) || d.items[w.key] || fresh.has(w.key))) return w.key;
    const candidate = fromCsl({ ...w.data }, "belge", w.key);
    const old = copies.find(candidate);
    if (old) return old.key;
    fresh.set(candidate.key, candidate);
    copies.add(candidate);
    return candidate.key;
  };
  const result = await serial(() =>
    word.convertFields((code, inNote) => {
      const f = parseZoteroField(code);
      if (!f) return null;
      if (f.kind === "bibliography") return { kind: "bibliography" };
      const refs: CiteRef[] = f.works.map((w) => ({ ...w.ref, id: keyFor(w) }));
      const works = Object.fromEntries(refs.map((r) => [r.id, S.byKey.get(r.id) ?? fresh.get(r.id) ?? d.items[r.id]!]));
      const id = newCitationId();
      putCitation(d, id, refs, works);
      if (inNote) inNotes++;
      else inText++;
      return { kind: "citation", id, segments: [{ text: f.text || "…" }] };
    }),
  );
  if (fresh.size) await putItems([...fresh.values()]);
  await word.saveState(d);
  await refresh(false, true);
  $("foreign-box").hidden = true;
  const r = await getRenderer();
  const styleNote = r.meta.note && inText && !inNotes ? " Atıflar metin içindeydi; stili metin içi bir stile (İSNAD metin içi ya da APA) çevirmek isteyebilirsiniz." : !r.meta.note && inNotes ? " Atıflar dipnottaydı; dipnotlu bir stil seçmek isteyebilirsiniz." : "";
  setMessage(`${result.converted} alan Derkenar'a çevrildi${result.bibliography ? " (kaynakça dahil)" : ""}; ${fresh.size} eser kütüphaneye eklendi.${result.failed ? ` ${result.failed} alan çevrilemedi, yerinde bırakıldı.` : ""}${styleNote}`, result.failed ? "warning" : "success");
}

// ---------------------------------------------------------------- Kaynakçayı düzenle

function renderBibEdit(): void {
  const d = doc();
  const excluded = new Set(d.bibExcluded ?? []);
  const uncited = new Set(d.bibUncited ?? []);
  const cited = [...new Set(order.flatMap((o) => d.citations[o.id]?.items.map((r) => r.id) ?? []))];
  const keys = [...cited, ...[...uncited].filter((k) => !cited.includes(k))].filter((k) => d.items[k]);
  const name = (k: string) => {
    const it = S.byKey.get(k) ?? d.items[k]!;
    return `${creatorLine(it) || "—"}, ${titleOf(it) || "(başlıksız)"}`;
  };
  $("bib-works").replaceChildren(
    ...keys
      .sort((a, b) => name(a).localeCompare(name(b), "tr"))
      .map((k) => {
        const box = h("input", { type: "checkbox", checked: !excluded.has(k), "aria-label": "Kaynakçada" });
        box.onchange = () =>
          void run("Kaynakça yenileniyor", async () => {
            const set = new Set(doc().bibExcluded ?? []);
            if (box.checked) set.delete(k);
            else set.add(k);
            doc().bibExcluded = [...set];
            await refresh(false, true);
          });
        return h(
          "li",
          { class: excluded.has(k) ? "out" : "" },
          box,
          h("span", {}, name(k)),
          uncited.has(k)
            ? h("button", {
                type: "button",
                class: "link",
                title: "Kaynakçadan çıkar",
                onclick: () =>
                  void run("Kaynakça yenileniyor", async () => {
                    doc().bibUncited = (doc().bibUncited ?? []).filter((x) => x !== k);
                    await refresh(false, true);
                  }),
              }, "(atıfsız) ✕")
            : null,
        );
      }),
  );
  if (!keys.length) $("bib-works").append(h("li", { class: "muted" }, "Henüz atıf yok."));
}

function searchUncited(): void {
  const q = $<HTMLInputElement>("bib-add-q").value.trim();
  const d = doc();
  const have = new Set([...Object.keys(d.citations).flatMap((id) => d.citations[id]!.items.map((r) => r.id)), ...(d.bibUncited ?? [])]);
  const hits = q ? S.index.search(q, 8, (i) => !have.has(i.key)) : [];
  $("bib-add-hits").replaceChildren(
    ...hits.map(({ item }) =>
      h("li", {}, h("button", {
        type: "button",
        class: "link",
        onclick: () =>
          void run("Kaynakçaya ekleniyor", async () => {
            const dd = doc();
            dd.items[item.key] = JSON.parse(JSON.stringify(item)) as Item;
            dd.bibUncited = [...(dd.bibUncited ?? []), item.key];
            $<HTMLInputElement>("bib-add-q").value = "";
            $("bib-add-hits").replaceChildren();
            await refresh(false, true);
            setMessage(dd.bibliographyHtml ? "Eser kaynakçaya eklendi (atıf yapılmadan)." : "Eser eklendi; kaynakçayı Kaynakça Ekle/Düzenle ile belgeye koyun.", "success");
          }),
      }, `+ ${creatorLine(item) || "—"}, ${titleOf(item)}`)),
    ),
  );
}

function renderPrefs(): void {
  const d = doc();
  const sel = $<HTMLSelectElement>("style");
  const custom = [...customListed];
  if (d.customStyle && !custom.some((c) => c.id === d.customStyle!.id)) custom.push(d.customStyle);
  sel.replaceChildren(
    ...BUILTIN_STYLES.map((s) => h("option", { value: s.id, selected: s.id === d.style }, s.title)),
    ...(custom.length ? [h("optgroup", { label: "Yüklenen stiller" }, ...custom.map((c) => h("option", { value: c.id, selected: c.id === d.style }, c.title)))] : []),
  );
  $("csl-remove").hidden = !d.style.startsWith("custom:");
  $<HTMLSelectElement>("locale").value = d.locale;
  $<HTMLSelectElement>("notes-kind").value = d.notes ?? "footnote";
  $<HTMLInputElement>("auto").checked = d.auto !== false;
  $<HTMLInputElement>("keep-library").checked = d.keepLibrary !== false;
  $<HTMLInputElement>("bib-title").value = d.bibTitle ?? "Kaynakça";
  $<HTMLInputElement>("bib-sections").checked = d.bibSections === true;
}

let customListed: CustomStyle[] = [];

/** A .csl file: an independent style is added to the list and chosen. */
async function loadCsl(file: File): Promise<void> {
  const xml = await file.text();
  if (/rel="independent-parent"/.test(xml) && !/<citation\b/.test(xml)) {
    const parent = /<link\s+href="([^"]+)"\s+rel="independent-parent"/.exec(xml)?.[1] ?? "";
    throw new Error(`Bu, başka bir stile bağlı (bağımlı) bir stil; kendi biçim kuralları yok. Asıl stili yükleyin${parent ? ` ("${parent.replace(/^.*\//, "")}" adlı stil)` : ""}.`);
  }
  if (!/<style\b[^>]*xmlns="http:\/\/purl\.org\/net\/xbiblio\/csl"/.test(xml) || !/<citation\b/.test(xml)) throw new Error("Bu bir CSL stil dosyası değil.");
  const { styleMeta } = await import("../../core/engine.js");
  const meta = styleMeta(xml);
  const slug = (/<id>([^<]+)<\/id>/.exec(xml)?.[1] ?? meta.title).replace(/^.*\//, "").replace(/[^A-Za-z0-9-]+/g, "-").toLowerCase();
  const style: CustomStyle = { id: `custom:${slug}`, title: `${meta.title}${meta.note ? " (dipnotlu)" : ""}`, xml };
  // A style Derkenar's own build cannot read is caught before it is chosen.
  try {
    const loc = await (await fetch("styles/locales-tr-TR.xml")).text();
    new (await import("../../core/engine.js")).Renderer(xml, () => loc, "tr-TR");
  } catch (e) {
    throw new Error(`Stil dosyası okunamadı: ${e instanceof Error ? e.message : String(e)}`);
  }
  const list = (await customStyles()).filter((c) => c.id !== style.id);
  list.push(style);
  await saveCustomStyles(list);
  customListed = list;
  await changeStyle(style.id);
  renderPrefs();
}

async function changeStyle(id: string): Promise<void> {
  const d = doc();
  const before = await getRenderer();
  if (id.startsWith("custom:")) {
    const c = (await customStyles()).find((x) => x.id === id) ?? (d.customStyle?.id === id ? d.customStyle : undefined);
    if (c) d.customStyle = c;
  } else delete d.customStyle;
  d.style = id;
  d.rendered = {};
  const after = await getRenderer();
  renderSummary();
  // Dipnotlu ↔ metin içi: the citations move with the style.
  let note = "";
  if (before.meta.note !== after.meta.note) {
    // Several citations alone in one footnote become one citation in the text: their works are put together.
    const merge = (ids: string[]): string | null => {
      const [first, ...others] = ids;
      if (!first || !d.citations[first] || others.some((x) => !d.citations[x])) return null;
      d.citations[first] = { items: ids.flatMap((x) => d.citations[x]!.items) };
      for (const x of others) {
        delete d.citations[x];
        delete d.rendered[x];
      }
      delete d.rendered[first];
      return first;
    };
    const r = await serial(() => word.convertPlacement(after.meta.note, merge));
    if (r.moved) note += after.meta.note ? ` ${r.moved} atıf dipnota taşındı.` : ` ${r.moved} atıf dipnottan metne taşındı.`;
    // İSNAD metin içi keeps explanatory notes; the citations in them are written the in-text way.
    if (r.kept) note += ` İçinde açıklama da olan ${r.kept} dipnot açıklama dipnotu olarak kaldı; içindeki atıflar metin içi biçimiyle yazılır.`;
  }
  await refresh(true, true);
  setMessage(`Stil: ${styleTitle(id)}.${note}${note ? " Geri almak için Word'de Geri Al." : ""}`, "success");
}

/** Kısaltmalar listesi: scans the whole text (abbreviations typed by hand, "Hz.", "s.a.v."), puts the list in, keeps it updated. */
export async function abbreviationsList(): Promise<void> {
  const d = doc();
  const text = await serial(() => word.documentText());
  d.abbrDoc = usedAbbreviations(text, d.locale).map(([a]) => a);
  const made = await serial(() => word.ensureAbbreviations(/^en/.test(d.locale) ? "Abbreviations" : "Kısaltmalar"));
  d.abbrSig = undefined;
  await refresh(false, true);
  setMessage(`${made === "created" ? "Kısaltmalar listesi eklendi" : "Kısaltmalar listesi güncellendi"} (${(d.abbrSig ?? "").split("|").filter(Boolean).length} kısaltma); atıflar değiştikçe kendiliğinden güncellenir. Metne elle yeni kısaltma yazarsanız düğmeye yeniden basın.`, "success");
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
  $<HTMLSelectElement>("style").onchange = () => void run("Stil uygulanıyor", async () => {
    await changeStyle($<HTMLSelectElement>("style").value);
    renderPrefs();
  });
  void customStyles().then((l) => ((customListed = l), renderPrefs()));
  $<HTMLInputElement>("csl-file").onchange = () =>
    void run("Stil yükleniyor", async () => {
      const f = $<HTMLInputElement>("csl-file").files?.[0];
      $<HTMLInputElement>("csl-file").value = "";
      if (f) await loadCsl(f);
    });
  $("csl-remove").onclick = () =>
    void run("Kaldırılıyor", async () => {
      const id = doc().style;
      customListed = (await customStyles()).filter((c) => c.id !== id);
      await saveCustomStyles(customListed);
      await changeStyle("isnad-dipnotlu");
      renderPrefs();
      setMessage("Yüklenen stil listeden kaldırıldı; belge İSNAD 2 (dipnotlu) stiline döndü.", "success");
    });
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
  $<HTMLInputElement>("bib-add-q").oninput = searchUncited;
  $("foreign-convert").onclick = () => void run("Atıflar çevriliyor", convertForeign);
  $("bib-edit").addEventListener("toggle", renderBibEdit);
  $("bibliography").onclick = () => void run("Kaynakça hazırlanıyor", bibliography);
  $("abbreviations").onclick = () => void run("Kısaltmalar hazırlanıyor", abbreviationsList);
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

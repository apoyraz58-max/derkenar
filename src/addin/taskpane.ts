/**
 * Derkenar pane: search the library, build a citation, insert or edit it, keep
 * the document's citations and bibliography in step with the chosen style.
 */
import { DEFAULT_STYLE, commitPlan, newCitationId, planRefresh, putCitation, type FoundCitation } from "../core/docstate.js";
import { LOCATOR_LABELS, Renderer, styleMeta } from "../core/engine.js";
import { htmlToSegments, htmlToText } from "../core/html.js";
import { cleanDoi, cleanIsbn, lookupDoi, lookupIsbn, parseFile, splitName, syncZotero, contentKey, type ZoteroConfig } from "../core/importers.js";
import { SearchIndex, authorLine, year } from "../core/search.js";
import { BUILTIN_STYLES } from "../core/styles.js";
import type { CiteRef, CslItem, DocState, LibraryItem } from "../core/types.js";
import { getMeta, loadItems, saveItems, setMeta } from "./library.js";
import * as word from "./word.js";

declare const __VERSION__: string;

// ---------------------------------------------------------------- state

const S = {
  items: [] as LibraryItem[],
  byKey: new Map<string, LibraryItem>(),
  index: new SearchIndex(),
  doc: null as DocState | null,
  basket: [] as CiteRef[],
  editing: null as string | null,
  basketDirty: false,
  results: [] as LibraryItem[],
  cursor: 0,
  order: [] as FoundCitation[],
  orphans: new Set<string>(),
  unlinkArmed: false,
};

interface CustomStyle {
  id: string;
  title: string;
  note: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function setMessage(text: string, kind: "info" | "success" | "warning" | "error" = "info"): void {
  const m = $("message");
  m.textContent = text;
  m.className = `message ${kind}`;
  m.hidden = !text;
}

async function run<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
  $("busy-text").textContent = `${label}…`;
  $("busy").hidden = false;
  try {
    return await task();
  } catch (e) {
    console.error(e);
    setMessage(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  } finally {
    $("busy").hidden = true;
  }
}

function doc(): DocState {
  if (!S.doc) S.doc = word.loadState();
  return S.doc;
}

// ---------------------------------------------------------------- styles and renderer

const textCache = new Map<string, Promise<string>>();
function fetchText(path: string): Promise<string> {
  let p = textCache.get(path);
  if (!p) {
    p = fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path} yüklenemedi (${r.status}).`);
      return r.text();
    });
    p.catch(() => textCache.delete(path));
    textCache.set(path, p);
  }
  return p;
}

async function styleXml(id: string): Promise<string> {
  if (id.startsWith("custom:")) {
    const xml = await getMeta<string>(`style:${id}`);
    if (!xml) throw new Error("Bu belgenin stili bu bilgisayarda yok. Belge sekmesinden .csl dosyasını yeniden seçin veya başka bir stil seçin.");
    return xml;
  }
  return fetchText(`styles/${id}.csl`);
}

const locales: Record<string, string> = {};
async function loadLocales(): Promise<void> {
  await Promise.all(
    ["tr-TR", "en-US"].map(async (l) => {
      locales[l] = await fetchText(`styles/locales-${l}.xml`);
    }),
  );
}

let rendererKey = "";
let renderer: Renderer | null = null;
async function getRenderer(): Promise<Renderer> {
  const d = doc();
  const key = `${d.style}|${d.locale}`;
  if (renderer && rendererKey === key) return renderer;
  const [xml] = await Promise.all([styleXml(d.style), loadLocales()]);
  renderer = new Renderer(xml, (l) => locales[l], d.locale);
  rendererKey = key;
  return renderer;
}

// ---------------------------------------------------------------- library

function setLibrary(items: LibraryItem[]): void {
  S.items = items;
  S.byKey = new Map(items.map((i) => [i.key, i]));
  S.index.reset(items);
  renderSummary();
  renderSources();
  search();
}

async function addToLibrary(items: LibraryItem[], removeKeys: string[] = []): Promise<void> {
  await saveItems(items, removeKeys);
  const map = new Map(S.items.map((i) => [i.key, i]));
  for (const k of removeKeys) map.delete(k);
  for (const i of items) map.set(i.key, i);
  setLibrary([...map.values()]);
}

function work(id: string): CslItem | undefined {
  return S.byKey.get(id)?.csl ?? doc().items[id];
}

function renderSummary(): void {
  const d = doc();
  const style = styleTitle(d.style);
  $("summary").textContent = `${style} · ${S.items.length} kaynak`;
  $("lib-count").textContent = `${S.items.length} kaynak bu bilgisayarda kayıtlı.`;
  $("empty-library").hidden = S.items.length > 0;
}

let customStyles: CustomStyle[] = [];
function styleTitle(id: string): string {
  return BUILTIN_STYLES.find((s) => s.id === id)?.title ?? customStyles.find((s) => s.id === id)?.title ?? id;
}

function renderSources(): void {
  const counts = new Map<string, number>();
  for (const i of S.items) counts.set(i.source, (counts.get(i.source) ?? 0) + 1);
  const ul = $("sources");
  ul.replaceChildren();
  for (const [source, n] of [...counts].sort()) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${sourceName(source)} — ${n}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "link";
    del.textContent = "Kaldır";
    del.onclick = () =>
      run("Kaldırılıyor", async () => {
        await addToLibrary([], S.items.filter((i) => i.source === source).map((i) => i.key));
        if (source.startsWith("zotero:")) await setMeta("zoteroVersion", undefined);
        setMessage(`${sourceName(source)} kütüphaneden kaldırıldı.`, "success");
      });
    li.append(label, del);
    ul.append(li);
  }
}

function sourceName(source: string): string {
  if (source.startsWith("zotero:")) return `Zotero (${source.slice(7)})`;
  if (source.startsWith("file:")) return `Dosya: ${source.slice(5)}`;
  return { doi: "DOI ile eklenenler", isbn: "ISBN ile eklenenler", manual: "Elle eklenenler", belge: "Belgelerden alınanlar" }[source] ?? source;
}

// ---------------------------------------------------------------- search and basket

function search(): void {
  const q = $<HTMLInputElement>("q").value;
  S.results = q.trim() ? S.index.search(q, 60).map((h) => h.item) : recent();
  S.cursor = 0;
  renderResults();
}

/** Without a query: works cited in this document first, then the newest additions. */
function recent(): LibraryItem[] {
  const cited = Object.keys(doc().items).map((k) => S.byKey.get(k)).filter((x): x is LibraryItem => Boolean(x));
  const seen = new Set(cited.map((c) => c.key));
  return [...cited, ...S.items.slice(-30).reverse().filter((i) => !seen.has(i.key))].slice(0, 40);
}

function renderResults(): void {
  const ol = $("results");
  ol.replaceChildren();
  const inBasket = new Set(S.basket.map((b) => b.id));
  S.results.forEach((item, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === S.cursor));
    if (inBasket.has(item.key)) li.classList.add("in-basket");
    const c = item.csl;
    li.innerHTML = `<div class="r-author"></div><div class="r-title"></div><div class="r-more"></div>`;
    (li.children[0] as HTMLElement).textContent = [authorLine(c), year(c)].filter(Boolean).join(" · ") || "—";
    (li.children[1] as HTMLElement).textContent = c.title ?? "(başlıksız)";
    (li.children[2] as HTMLElement).textContent = [c["container-title"], c.publisher].filter(Boolean).join(" · ");
    li.onclick = (e) => {
      S.cursor = i;
      addToBasket(item);
      if (e.detail === 2) void insert();
    };
    ol.append(li);
  });
}

function moveCursor(by: number): void {
  if (!S.results.length) return;
  S.cursor = (S.cursor + by + S.results.length) % S.results.length;
  const items = $("results").children;
  for (let i = 0; i < items.length; i++) items[i]!.setAttribute("aria-selected", String(i === S.cursor));
  items[S.cursor]?.scrollIntoView({ block: "nearest" });
}

function addToBasket(item: LibraryItem): void {
  if (!S.basket.some((b) => b.id === item.key)) S.basket.push({ id: item.key });
  S.basketDirty = true;
  renderBasket();
  renderResults();
}

function renderBasket(): void {
  $("basket-section").hidden = S.basket.length === 0;
  $("insert").textContent = S.editing ? "Atıfı güncelle" : "Atıf ekle";
  $("edit-bar").hidden = !S.editing;
  const ol = $("basket");
  ol.replaceChildren();
  S.basket.forEach((ref, i) => {
    const c = work(ref.id);
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="b-head"><span class="b-title"></span>
        <span><button type="button" class="icon" data-a="up" title="Yukarı">↑</button><button type="button" class="icon" data-a="del" title="Çıkar">✕</button></span></div>
      <div class="b-loc"><select data-f="label"></select><input data-f="locator" placeholder="sayfa, ör. 12-14" /></div>
      <details><summary class="muted">Ön ek, arka ek, yazar</summary>
        <div class="b-extra"><input data-f="prefix" placeholder="Ön ek (ör. bk.)" /><input data-f="suffix" placeholder="Arka ek" /></div>
        <div class="b-flags"><label><input type="checkbox" data-f="suppress-author" /> Yazarı gizle</label></div>
      </details>`;
    (li.querySelector(".b-title") as HTMLElement).textContent = c ? `${authorLine(c) || "—"}, ${c.title ?? ""} (${year(c) || "t.y."})` : `${ref.id} (kütüphanede yok)`;
    const label = li.querySelector('[data-f="label"]') as HTMLSelectElement;
    for (const [v, t] of LOCATOR_LABELS) label.add(new Option(t, v, false, (ref.label ?? "page") === v));
    for (const el of li.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]")) {
      const f = el.dataset.f as keyof CiteRef;
      if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(ref[f]);
      else if (f !== "label") el.value = String(ref[f] ?? "");
      el.oninput = el.onchange = () => {
        const r = ref as unknown as Record<string, unknown>;
        const v = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value.trim();
        if (v) r[f] = v;
        else delete r[f];
        S.basketDirty = true;
        schedulePreview();
      };
      if (el instanceof HTMLInputElement && el.type !== "checkbox") {
        el.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void insert();
          }
        };
      }
    }
    li.querySelector('[data-a="del"]')!.addEventListener("click", () => {
      S.basket.splice(i, 1);
      S.basketDirty = true;
      renderBasket();
      renderResults();
    });
    li.querySelector('[data-a="up"]')!.addEventListener("click", () => {
      if (i === 0) return;
      [S.basket[i - 1], S.basket[i]] = [S.basket[i]!, S.basket[i - 1]!];
      renderBasket();
    });
    ol.append(li);
  });
  schedulePreview();
}

let previewTimer = 0;
function schedulePreview(): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void preview(), 60);
}

async function preview(): Promise<void> {
  if (!S.basket.length) return;
  try {
    const r = await getRenderer();
    r.setItems(worksFor(S.basket));
    const html = r.preview(S.basket);
    const p = $("preview");
    p.replaceChildren();
    for (const seg of htmlToSegments(html)) {
      const span = document.createElement(seg.italic ? "i" : "span");
      if (seg.bold) span.style.fontWeight = "bold";
      if (seg.superscript) span.style.verticalAlign = "super";
      span.textContent = seg.text;
      p.append(span);
    }
  } catch (e) {
    $("preview").textContent = e instanceof Error ? e.message : String(e);
  }
}

/** Works the given refs need, plus every work the document already has (for the processor). */
function worksFor(refs: readonly CiteRef[]): Record<string, CslItem> {
  const out: Record<string, CslItem> = { ...doc().items };
  for (const r of refs) {
    const w = work(r.id);
    if (w) out[r.id] = w;
  }
  return out;
}

function clearBasket(): void {
  S.basket = [];
  S.editing = null;
  S.basketDirty = false;
  renderBasket();
  renderResults();
}

// ---------------------------------------------------------------- document

async function insert(): Promise<void> {
  if (!S.basket.length) {
    const top = S.results[S.cursor];
    if (!top) return;
    addToBasket(top);
  }
  await run(S.editing ? "Atıf güncelleniyor" : "Atıf ekleniyor", async () => {
    const r = await getRenderer();
    const d = doc();
    const refs = S.basket.map((b) => ({ ...b }));
    const works = worksFor(refs);
    if (S.editing) {
      putCitation(d, S.editing, refs, works);
      await refresh(false, true);
      setMessage("Atıf güncellendi.", "success");
    } else {
      const id = newCitationId();
      putCitation(d, id, refs, works);
      r.setItems(d.items);
      const where = await word.insertCitation(id, htmlToSegments(r.preview(refs)), r.meta.note);
      await refresh(false, true);
      if (r.meta.note && where === "text") setMessage("Bu Word sürümü dipnot eklemeye izin vermiyor; atıf metne eklendi.", "warning");
      else setMessage("", "info");
    }
    clearBasket();
    $<HTMLInputElement>("q").value = "";
    search();
    $<HTMLInputElement>("q").focus();
  });
}

/** Re-renders every citation; writes only those whose text changed. */
async function refresh(force = false, quiet = false): Promise<void> {
  const r = await getRenderer();
  const d = doc();
  const started = performance.now();
  const result = await word.refreshDocument((found) => {
    const retag = new Map<number, string>();
    const seen = new Set<string>();
    const list = found.map((f, i) => {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        return f;
      }
      const fresh = newCitationId();
      const c = d.citations[f.id];
      if (c) d.citations[fresh] = JSON.parse(JSON.stringify(c)) as typeof c;
      retag.set(i, fresh);
      return { ...f, id: fresh };
    });
    const plan = planRefresh(d, list, r, force);
    commitPlan(d, plan);
    S.order = list;
    S.orphans = new Set(plan.orphans);
    const citations = new Map([...plan.updates].map(([id, html]) => [id, htmlToSegments(html)]));
    const bib = plan.bibliographyChanged && plan.bibliography ? plan.bibliography.entries.map((e) => htmlToSegments(e.html)) : null;
    return { citations, bibliography: bib, hangingIndent: plan.bibliography?.hangingIndent ?? true, retag };
  });
  await word.saveState(d);
  const secs = ((performance.now() - started) / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  $("refresh-stat").textContent = `${result.citations} atıf ${secs} sn'de denetlendi, ${result.written} tanesi yeniden yazıldı.`;
  renderDocList();
  if (!quiet) {
    const warn = S.orphans.size ? ` ${S.orphans.size} atıfın verisi bu belgede yok (başka belgeden kopyalanmış olabilir).` : "";
    setMessage(`Belge güncellendi.${warn}`, warn ? "warning" : "success");
  }
}

function renderDocList(): void {
  const d = doc();
  const ol = $("doc-citations");
  ol.replaceChildren();
  S.order.forEach((f, i) => {
    const li = document.createElement("li");
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = f.noteIndex ? `dn. ${f.noteIndex}` : `${i + 1}.`;
    li.append(n, document.createTextNode(S.orphans.has(f.id) ? `${f.text} — verisi yok` : htmlToText(d.rendered[f.id] ?? "") || f.text));
    if (S.orphans.has(f.id)) li.classList.add("orphan");
    li.onclick = () => void run("Atıf seçiliyor", () => word.selectCitation(f.id));
    ol.append(li);
  });
  if (!S.order.length) ol.innerHTML = `<li class="muted">Henüz atıf yok.</li>`;
}

async function onSelection(): Promise<void> {
  const id = await word.citationAtSelection().catch(() => null);
  const d = doc();
  if (id && d.citations[id]) {
    if (S.editing === id) return;
    S.editing = id;
    S.basket = d.citations[id]!.items.map((r) => ({ ...r }));
    S.basketDirty = false;
    showView("atif");
    renderBasket();
    renderResults();
  } else if (S.editing && !S.basketDirty) {
    clearBasket();
  }
}

async function changeStyle(id: string): Promise<void> {
  const d = doc();
  const before = await getRenderer();
  d.style = id;
  d.rendered = {};
  const after = await getRenderer();
  renderSummary();
  await refresh(true, true);
  let note = "";
  if (before.meta.note !== after.meta.note && S.order.length) {
    note = after.meta.note
      ? " Metindeki atıflar metinde kaldı; dipnotlu stilde yeni atıflar dipnota eklenir."
      : " Dipnottaki atıflar dipnotta kaldı; metin içi stilde yeni atıflar metne eklenir.";
  }
  setMessage(`Stil: ${styleTitle(id)}.${note}`, note ? "warning" : "success");
}

// ---------------------------------------------------------------- views

function showView(name: string): void {
  for (const v of ["atif", "kutuphane", "belge"]) {
    $(`view-${v}`).hidden = v !== name;
    $(`tab-${v}`).setAttribute("aria-selected", String(v === name));
  }
  if (name === "atif") $<HTMLInputElement>("q").focus();
  if (name === "belge") renderDocList();
}

function renderStyleSelect(): void {
  const sel = $<HTMLSelectElement>("style");
  sel.replaceChildren();
  const d = doc();
  for (const s of [...BUILTIN_STYLES, ...customStyles]) sel.add(new Option(s.title, s.id, false, s.id === d.style));
  if (![...BUILTIN_STYLES, ...customStyles].some((s) => s.id === d.style)) sel.add(new Option(`${d.style} (bu bilgisayarda yok)`, d.style, false, true));
  $<HTMLSelectElement>("locale").value = d.locale;
}

// ---------------------------------------------------------------- wiring

function wire(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button")) b.onclick = () => showView(b.dataset.view!);
  $("go-library").onclick = () => showView("kutuphane");

  const q = $<HTMLInputElement>("q");
  q.oninput = search;
  q.onkeydown = (e) => {
    if (e.key === "ArrowDown") (e.preventDefault(), moveCursor(1));
    else if (e.key === "ArrowUp") (e.preventDefault(), moveCursor(-1));
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.preventDefault(), void insert());
    else if (e.key === "Enter") {
      e.preventDefault();
      const item = S.results[S.cursor];
      if (item) addToBasket(item);
      q.select();
    } else if (e.key === "Escape") {
      q.value = "";
      search();
    }
  };
  $("insert").onclick = () => void insert();
  $("clear-basket").onclick = clearBasket;
  $("edit-new").onclick = clearBasket;

  // Library
  const mode = $<HTMLSelectElement>("z-mode");
  const syncMode = () => {
    for (const el of document.querySelectorAll<HTMLElement>(".web-only")) el.hidden = mode.value === "local";
    for (const el of document.querySelectorAll<HTMLElement>(".local-only")) el.hidden = mode.value !== "local";
  };
  mode.onchange = syncMode;
  $<HTMLFormElement>("zotero-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Zotero eşitleniyor", syncFromZotero);
  };
  $<HTMLInputElement>("file").onchange = () =>
    void run("İçe aktarılıyor", async () => {
      const files = [...($<HTMLInputElement>("file").files ?? [])];
      let n = 0;
      for (const f of files) {
        const items = await parseFile(await f.text(), f.name);
        await addToLibrary(items);
        n += items.length;
      }
      $<HTMLInputElement>("file").value = "";
      setMessage(`${n} kaynak içe aktarıldı.`, "success");
    });
  $<HTMLFormElement>("lookup-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Aranıyor", async () => {
      const text = $<HTMLInputElement>("lookup").value;
      const doi = cleanDoi(text);
      const isbn = doi ? null : cleanIsbn(text);
      if (!doi && !isbn) throw new Error("Geçerli bir DOI (10.xxxx/…) veya ISBN yazın.");
      const item = doi ? await lookupDoi(doi) : await lookupIsbn(isbn!);
      await addToLibrary([item]);
      $<HTMLInputElement>("lookup").value = "";
      setMessage(`Eklendi: ${authorLine(item.csl)}, ${item.csl.title ?? ""}`, "success");
    });
  };
  $<HTMLFormElement>("manual-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Kaydediliyor", saveManual);
  };
  $("import-doc").onclick = () =>
    void run("Aktarılıyor", async () => {
      const items = Object.entries(doc().items).map(([key, csl]) => ({ key, csl, source: "belge" }));
      await addToLibrary(items.filter((i) => !S.byKey.has(i.key)));
      setMessage(`${items.length} kaynak kütüphanede.`, "success");
    });

  // Document
  $<HTMLSelectElement>("style").onchange = () => void run("Stil uygulanıyor", () => changeStyle($<HTMLSelectElement>("style").value));
  $<HTMLSelectElement>("locale").onchange = () =>
    void run("Dil uygulanıyor", async () => {
      doc().locale = $<HTMLSelectElement>("locale").value;
      await refresh(true);
    });
  $<HTMLInputElement>("style-file").onchange = () =>
    void run("Stil yükleniyor", async () => {
      const f = $<HTMLInputElement>("style-file").files?.[0];
      if (!f) return;
      const xml = await f.text();
      if (!/<style\b/.test(xml)) throw new Error("Bu bir CSL stil dosyası değil.");
      const meta = styleMeta(xml);
      const id = `custom:${f.name.replace(/\.(csl|xml)$/i, "")}`;
      await setMeta(`style:${id}`, xml);
      customStyles = [...customStyles.filter((s) => s.id !== id), { id, title: meta.title, note: meta.note }];
      await setMeta("customStyles", customStyles);
      $<HTMLInputElement>("style-file").value = "";
      await changeStyle(id);
      renderStyleSelect();
    });
  $("refresh").onclick = () => void run("Belge güncelleniyor", () => refresh(true));
  $("bibliography").onclick = () => void run("Kaynakça hazırlanıyor", bibliography);
  $("unlink").onclick = () => {
    if (!S.unlinkArmed) {
      S.unlinkArmed = true;
      $("unlink").textContent = "Emin misiniz? Tekrar tıklayın";
      window.setTimeout(() => {
        S.unlinkArmed = false;
        $("unlink").textContent = "Düz metne çevir";
      }, 4000);
      return;
    }
    S.unlinkArmed = false;
    $("unlink").textContent = "Düz metne çevir";
    void run("Düz metne çevriliyor", async () => {
      const n = await word.unlinkAll();
      setMessage(`${n} atıf ve kaynakça düz metne çevrildi. Geri almak için Word'de Geri Al'ı kullanın.`, "success");
      S.order = [];
      renderDocList();
    });
  };
}

async function bibliography(): Promise<void> {
  const r = await getRenderer();
  if (!r.meta.hasBibliography) throw new Error("Bu stilin kaynakçası yok.");
  const made = await word.ensureBibliography();
  doc().bibliographyHtml = undefined;
  await refresh(false, true);
  setMessage(made === "created" ? "Kaynakça eklendi; yeni atıflarla birlikte güncellenir." : "Kaynakça güncellendi.", "success");
}

async function syncFromZotero(): Promise<void> {
  const local = $<HTMLSelectElement>("z-mode").value === "local";
  const id = $<HTMLInputElement>("z-id").value.trim();
  const apiKey = $<HTMLInputElement>("z-key").value.trim();
  if (!local && !/^\d+$/.test(id)) throw new Error("Zotero kullanıcı veya grup numarasını yazın (yalnız rakam).");
  const cfg: ZoteroConfig = local ? { library: "users/0", base: "http://localhost:23119/api" } : { library: `${$<HTMLSelectElement>("z-kind").value}/${id}`, apiKey: apiKey || undefined };
  const saved = await getMeta<{ library: string; base?: string; version: number }>("zoteroVersion");
  const same = saved && saved.library === cfg.library && saved.base === cfg.base;
  const since = same ? saved.version : 0;
  const status = $("z-status");
  const page = await syncZotero(cfg, since, fetch, (done, total) => (status.textContent = `${done} / ${total}`)).catch((e: unknown) => {
    if (local && e instanceof TypeError) throw new Error("Yerel Zotero'ya ulaşılamadı: Zotero açık mı, yerel API izni verildi mi?");
    throw e;
  });
  const source = `zotero:${cfg.library}`;
  const stale = since === 0 ? S.items.filter((i) => i.source === source).map((i) => i.key) : [];
  const keep = new Set(page.items.map((i) => i.key));
  await addToLibrary(page.items, [...stale.filter((k) => !keep.has(k)), ...page.deletedKeys]);
  await setMeta("zoteroVersion", { library: cfg.library, base: cfg.base, version: page.version });
  await setMeta("zotero", { mode: local ? "local" : "web", kind: $<HTMLSelectElement>("z-kind").value, id, apiKey });
  status.textContent = `Son eşitleme: ${new Date().toLocaleString("tr-TR")}`;
  setMessage(since ? `${page.items.length} değişen, ${page.deletedKeys.length} silinen kaynak işlendi.` : `${page.items.length} kaynak Zotero'dan alındı.`, "success");
}

async function saveManual(): Promise<void> {
  const v = (id: string) => $<HTMLInputElement>(id).value.trim();
  const csl: CslItem = { id: "", type: $<HTMLSelectElement>("m-type").value, title: v("m-title") };
  const authors = v("m-authors").split(/\n+/).map((s) => s.trim()).filter(Boolean).map(splitName);
  if (authors.length) csl.author = authors;
  if (/^\d{3,4}$/.test(v("m-year"))) csl.issued = { "date-parts": [[Number(v("m-year"))]] };
  else if (v("m-year")) csl.issued = { literal: v("m-year") };
  const set = (field: string, id: string) => v(id) && (csl[field] = v(id));
  set("container-title", "m-container");
  set("publisher", "m-publisher");
  set("publisher-place", "m-place");
  set("volume", "m-volume");
  set("issue", "m-issue");
  set("page", "m-pages");
  const link = v("m-link");
  if (link) {
    const doi = cleanDoi(link);
    if (doi) csl.DOI = doi;
    else csl.URL = link;
  }
  const key = `m${contentKey(csl)}`;
  csl.id = key;
  await addToLibrary([{ key, csl, source: "manual" }]);
  $<HTMLFormElement>("manual-form").reset();
  setMessage(`Kaydedildi: ${csl.title}`, "success");
}

async function restoreZoteroForm(): Promise<void> {
  const z = await getMeta<{ mode: string; kind: string; id: string; apiKey: string }>("zotero");
  if (!z) return;
  $<HTMLSelectElement>("z-mode").value = z.mode;
  $<HTMLSelectElement>("z-kind").value = z.kind;
  $<HTMLInputElement>("z-id").value = z.id;
  $<HTMLInputElement>("z-key").value = z.apiKey;
  $<HTMLSelectElement>("z-mode").dispatchEvent(new Event("change"));
}

async function launch(action: string): Promise<void> {
  if (action === "library") showView("kutuphane");
  else if (action === "document") showView("belge");
  else if (action === "refresh") (showView("belge"), await run("Belge güncelleniyor", () => refresh(true)));
  else if (action === "bib") (showView("belge"), await run("Kaynakça hazırlanıyor", bibliography));
  else if (action === "unlink") (showView("belge"), $("unlink").focus());
  else if (action.startsWith("style:")) {
    showView("belge");
    await run("Stil uygulanıyor", () => changeStyle(action.slice(6)));
    renderStyleSelect();
  } else showView("atif");
}

Office.onReady(async () => {
  $("version").textContent = `Derkenar ${__VERSION__}`;
  wire();
  customStyles = (await getMeta<CustomStyle[]>("customStyles")) ?? [];
  const d = doc();
  if (!d.style) d.style = DEFAULT_STYLE;
  renderStyleSelect();
  setLibrary(await loadItems());
  void restoreZoteroForm();
  void getRenderer().catch(() => undefined);
  word.onSelectionChanged(() => {
    window.clearTimeout(selTimer);
    selTimer = window.setTimeout(() => void onSelection(), 150);
  });
  await launch(new URLSearchParams(location.search).get("action") ?? "insert");
  void onSelection();
});
let selTimer = 0;

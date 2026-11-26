/**
 * Atıf: search, build the citation (several works, cilt/sayfa, prefixes),
 * insert it or update the citation under the cursor.
 */
import { catalogHits } from "./catalog.js";
import { builtinHits, onBuiltinReady } from "./builtin.js";
import { ARTICLE_CATALOG, DIA_CATALOG, articleAuthors, articleItem, builtinSource, diaItem } from "../../core/builtin.js";
import { catalogSource } from "../../core/shamela.js";
import { newCitationId, putCitation } from "../../core/docstate.js";
import { LOCATOR_LABELS } from "../../core/engine.js";
import { htmlToSegments } from "../../core/html.js";
import type { CiteRef } from "../../core/types.js";
import { type Item, containerOf, creatorLine, isNoteItem, itemTypeLabel, titleOf, yearOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { citedKeys, refresh } from "./document.js";
import { citeMode } from "../../core/isnadmodes.js";
import { BIBLE_BOOKS, SURES } from "../../core/scripture.js";
import { parseQuick } from "../../core/search.js";
import { $, S, doc, getRenderer, h, run, serial, setMessage, showView, work } from "./core.js";
import { getMeta, setMeta } from "../store.js";
import { cleanDoi, cleanIsbn } from "../../core/importers.js";
import { checkItem } from "../../core/isnad.js";
import { openEditor } from "./editor.js";
import { personIssues } from "./persons.js";

let results: Item[] = [];
let cursor = 0;
onBuiltinReady(() => renderResults());

/** Types whose cilt comes from the record (journal, encyclopedia): no Cilt box. */
const OWN_VOLUME = new Set(["journalArticle", "magazineArticle", "newspaperArticle", "encyclopediaArticle", "dictionaryEntry"]);

export function search(): void {
  const q = $<HTMLInputElement>("q").value;
  const words = parseQuick(q).words;
  results = q.trim() ? S.index.search(words, 80).map((x) => x.item).filter((i) => !isNoteItem(i)).slice(0, 60) : recent();
  cursor = 0;
  renderResults();
}

/** Without a query: works cited in this document first, then the newest additions. */
function recent(): Item[] {
  const cited = [...citedKeys()].map((k) => S.byKey.get(k)).filter((x): x is Item => Boolean(x && !x.deleted));
  const seen = new Set(cited.map((c) => c.key));
  const newest = [...S.items].filter((i) => !i.deleted && !isNoteItem(i) && !seen.has(i.key)).sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 30);
  return [...cited, ...newest].slice(0, 40);
}

export function resultRow(item: Item, extra: Record<string, unknown> = {}): HTMLLIElement {
  return h(
    "li",
    extra,
    h("div", { class: "r-author" }, [creatorLine(item), yearOf(item)].filter(Boolean).join(" · ") || "—", h("span", { class: "r-type" }, itemTypeLabel(item.itemType))),
    h("div", { class: "r-title" }, titleOf(item) || "(başlıksız)"),
    h("div", { class: "r-more" }, [containerOf(item), item.fields.publisher].filter(Boolean).join(" · ")),
  );
}

// ---------------------------------------------------------------- not in the library yet

type Freetext = typeof import("../../core/freetext.js");
let freetext: Freetext | null = null;
let freetextLoading = false;

/** A DOI, an ISBN or a whole reference typed or pasted into the search box: it can be added and cited in one go. */
/** Books of the loaded catalog (Şamile) the library does not have yet: one click adds the İSNAD record and cites it. */
function catalogRows(): HTMLElement[] {
  const q = $<HTMLInputElement>("q").value.trim();
  const have = new Set(S.items.filter((i) => !i.deleted).map((i) => catalogSource(i)).filter(Boolean).map((c) => `${c!.catalog}#${c!.id}`));
  return catalogHits(q)
    .filter((hit) => !have.has(`${hit.catalog}#${hit.entry.id}`))
    .map((hit) => {
      const e = hit.entry;
      const who = e.authors.map((a) => a.dia ?? a.name ?? a.shamela).join(", ");
      const b = h("button", { type: "button", class: "outside" }, h("div", { class: "r-title" }, `＋ ${e.title}`), h("div", { class: "r-more" }, `${who || "—"}${e.authors[0]?.death ? ` (ö. ${e.authors[0].death})` : ""} · ${hit.catalog}, no. ${e.id}${e.review?.length ? " · kontrol edilecek" : ""}`));
      b.onclick = () =>
        void run("Ekleniyor", async () => {
          const io = await import("./io.js");
          const [item] = await io.addParsed([hit.item()]);
          if (!item) return;
          addToBasket(item);
          $<HTMLInputElement>("q").value = "";
          search();
          setMessage(`${hit.catalog} kataloğundan eklendi: ${creatorLine(item) || "—"}, ${titleOf(item)}.${e.review?.length ? ` Kontrol edilecek: ${e.review.join("; ")}.` : ""} Basım bilgisini (yer, yayınevi, yıl) künye kartından tamamlayın.`, e.review?.length ? "warning" : "success");
        });
      return b;
    });
}

/** Yerleşik veritabanının (DİA, Derkenar makale kataloğu) kütüphanede olmayan kayıtları: tek tıkla eklenir ve atıfa konur. */
function builtinRows(): HTMLElement[] {
  const q = $<HTMLInputElement>("q").value;
  const hits = builtinHits(q);
  if (!hits.dia.length && !hits.articles.length) return [];
  const have = new Set(S.items.filter((i) => !i.deleted).map((i) => builtinSource(i)).filter(Boolean));
  const row = (title: string, more: string, make: () => Item, warn?: string) => {
    const b = h("button", { type: "button", class: "outside" }, h("div", { class: "r-title" }, `＋ ${title}`), h("div", { class: "r-more" }, more + (warn ? " · kontrol edilecek" : "")));
    b.onclick = () =>
      void run("Ekleniyor", async () => {
        const io = await import("./io.js");
        const [item] = await io.addParsed([make()]);
        if (!item) return;
        addToBasket(item);
        $<HTMLInputElement>("q").value = "";
        search();
        setMessage(`Yerleşik veritabanından eklendi: ${creatorLine(item) || "—"}, ${titleOf(item)}.${warn ? ` Kontrol edilecek: ${warn}.` : ""} Sayfayı yazıp Ekle'ye basın.`, warn ? "warning" : "success");
      });
    return b;
  };
  const out: HTMLElement[] = [];
  for (const e of hits.dia) {
    if (have.has(`${DIA_CATALOG}#${e.n}`)) continue;
    const who = e.a.map((a) => [a[1], a[0]].filter(Boolean).join(" ")).join(", ");
    const where = [e.v && e.pg ? `${e.v}/${e.pg}` : e.v, e.y].filter(Boolean).join(", ");
    out.push(row(e.t, `${who || "—"} · DİA${where ? ` ${where}` : ""}`, () => diaItem(e), e.r?.join("; ")));
  }
  for (const r of hits.articles) {
    if (have.has(`${ARTICLE_CATALOG}#${r[0]}`)) continue;
    const au = articleAuthors(r);
    const who = au.length ? `${au[0]![0]}${au.length > 2 ? " vd." : au.length === 2 ? ` – ${au[1]![0]}` : ""}` : "—";
    const vi = [r[6], r[7]].filter(Boolean).join("/");
    out.push(row(r[2], `${who} · ${r[3]}${vi ? ` ${vi}` : ""}${r[4] ? ` (${r[4]})` : ""}${r[11] ? " · DOI" : ""}`, () => articleItem(r)));
  }
  return out;
}

function outsideOffer(): HTMLElement | null {
  const q = $<HTMLInputElement>("q").value.trim();
  if (!q) return null;
  const doi = cleanDoi(q);
  const isbn = doi ? null : /^[\dXx\s-]{10,17}$/.test(q) ? cleanIsbn(q) : null;
  let label = "";
  let add: (() => Promise<Item[]>) | null = null;
  if (doi || isbn) {
    label = doi ? `DOI ile bul, kütüphaneye ekle ve atıfa koy: ${doi}` : `ISBN ile bul, kütüphaneye ekle ve atıfa koy: ${isbn}`;
    add = async () => {
      const io = await import("./io.js");
      return io.addByIdentifier(doi ?? isbn!);
    };
  } else if (q.length > 35 && /[,.]/.test(q) && /\p{L}{3}/u.test(q)) {
    if (!freetext) {
      if (!freetextLoading) {
        freetextLoading = true;
        void import("../../core/freetext.js").then((m) => {
          freetext = m;
          renderResults();
        });
      }
      return null;
    }
    const r = freetext.parseReference(q);
    if (!r || !r.item.fields.title || (!r.item.creators.length && !r.item.fields.date)) return null;
    label = `Bu künyeyi kütüphaneye ekle ve atıfa koy: ${creatorLine(r.item) || "—"}, ${titleOf(r.item)}${r.item.fields.date ? ` (${r.item.fields.date})` : ""}`;
    add = async () => {
      const io = await import("./io.js");
      const { cut } = await import("../../core/handnotes.js");
      // The page at the end of a footnote reference goes to the citation.
      place = cut(q.replace(/\.$/, ""));
      return io.addParsed([r.item]);
    };
  }
  if (!add) return null;
  const go = add;
  let place: { volume?: string; locator?: string } = {};
  const li = h("button", { type: "button", class: "outside" }, h("div", { class: "r-title" }, `＋ ${label}`), h("div", { class: "r-more" }, "Kütüphanede yoksa eklenir (İSNAD düzeltmeleriyle); varsa var olan kullanılır."));
  li.onclick = () =>
    void run("Ekleniyor", async () => {
      const items = await go();
      for (const it of items) addToBasket(it);
      const last = S.basket[S.basket.length - 1];
      if (last && items.length === 1 && last.id === items[0]!.key && (place.locator || place.volume)) {
        if (place.locator) last.locator = place.locator;
        if (place.volume && !OWN_VOLUME.has(items[0]!.itemType)) last.volume = place.volume;
        renderBasket();
      }
      $<HTMLInputElement>("q").value = "";
      search();
      if (items.length) setMessage(`Atıfa eklendi: ${creatorLine(items[0]!) || "—"}, ${titleOf(items[0]!)}. Sayfayı yazıp Ekle'ye basın.`, "success");
    });
  return li;
}

function renderResults(): void {
  const inBasket = new Set(S.basket.map((b) => b.id));
  const offer = results.length < 3 ? outsideOffer() : null;
  $("outside-offer").replaceChildren(...(offer ? [offer] : []), ...catalogRows(), ...builtinRows());
  $("results").replaceChildren(
    ...results.map((item, i) => {
      const li = resultRow(item, { role: "option", "aria-selected": String(i === cursor), class: inBasket.has(item.key) ? "in-basket" : "" });
      li.onclick = (e) => {
        cursor = i;
        addToBasket(item);
        if (e.detail === 2) void insert();
      };
      return li;
    }),
  );
  $("empty-library").hidden = S.items.some((i) => !i.deleted);
}

function moveCursor(by: number): void {
  if (!results.length) return;
  cursor = (cursor + by + results.length) % results.length;
  const rows = $("results").children;
  for (let i = 0; i < rows.length; i++) rows[i]!.setAttribute("aria-selected", String(i === cursor));
  rows[cursor]?.scrollIntoView({ block: "nearest" });
}

export function addToBasket(item: Item): void {
  if (!S.basket.some((b) => b.id === item.key)) S.basket.push({ id: item.key });
  S.basketDirty = true;
  renderBasket();
  renderResults();
}

export function renderBasket(): void {
  // Editing: the section stays when every work is removed, so the citation can be deleted.
  $("basket-section").hidden = S.basket.length === 0 && !S.editing;
  const deleting = Boolean(S.editing) && S.basket.length === 0;
  $("insert").textContent = deleting ? "Atıfı sil" : S.editing ? "Atıfı güncelle" : "Atıf ekle";
  $("insert").classList.toggle("danger", deleting);
  $("insert").classList.toggle("primary", !deleting);
  $("preview").textContent = deleting ? "Atıf metinden silinecek. Dipnotta başka yazı yoksa dipnot da silinir." : $("preview").textContent;
  $("edit-bar").hidden = !S.editing;
  const ol = $("basket");
  ol.replaceChildren();
  S.basket.forEach((ref, i) => {
    const w = work(ref.id);
    // Journals and encyclopedias: the record's Cilt is the container's, printed by the style ("13/490").
    const recordVolume = w?.fields.volume?.trim();
    const showVolume = !(recordVolume && OWN_VOLUME.has(w!.itemType));
    const set = (field: keyof CiteRef, value: string | boolean) => {
      const r = ref as unknown as Record<string, unknown>;
      if (value) r[field] = value;
      else delete r[field];
      S.basketDirty = true;
      schedulePreview();
    };
    const enter = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void insert();
      }
    };
    const label = h("select", { "aria-label": "Yer türü", onchange: () => set("label", label.value === "page" ? "" : label.value) }, ...LOCATOR_LABELS.map(([v, t]) => h("option", { value: v, selected: (ref.label ?? "page") === v }, t)));
    const vol = h("input", { placeholder: recordVolume ?? "Cilt", value: ref.volume ?? "", class: "vol", "aria-label": "Cilt", oninput: () => set("volume", vol.value.trim()), onkeydown: enter });
    const loc = h("input", { placeholder: "Sayfa, ör. 45 veya 45-47", value: ref.locator ?? "", "aria-label": "Sayfa", "data-f": "locator", oninput: () => set("locator", loc.value.trim()), onkeydown: enter });
    const prefix = h("input", { placeholder: "Ön ek (ör. bk.)", value: ref.prefix ?? "", oninput: () => set("prefix", prefix.value) });
    const suffix = h("input", { placeholder: "Arka ek", value: ref.suffix ?? "", oninput: () => set("suffix", suffix.value) });
    const hide = h("input", { type: "checkbox", checked: Boolean(ref["suppress-author"]), onchange: () => set("suppress-author", hide.checked) });
    ol.append(
      h(
        "li",
        {},
        h(
          "div",
          { class: "b-head" },
          h("span", { class: "b-title" }, w ? `${creatorLine(w) || "—"}, ${titleOf(w)} (${yearOf(w) || "ts."})` : `${ref.id} (kütüphanede yok)`),
          h(
            "span",
            {},
            h("button", { type: "button", class: "icon-btn", title: "Yukarı", onclick: () => (i > 0 && ([S.basket[i - 1], S.basket[i]] = [S.basket[i]!, S.basket[i - 1]!], renderBasket())) }, "↑"),
            h("button", { type: "button", class: "icon-btn", title: "Çıkar", onclick: () => (S.basket.splice(i, 1), (S.basketDirty = true), renderBasket(), renderResults()) }, "✕"),
          ),
        ),
        locatorRow(ref, citeMode(w), { label, vol, loc, showVolume, set, enter }),
        recordIssues(w),
        recordVolume && showVolume && citeMode(w) === "normal" ? h("p", { class: "muted small" }, ref.volume ? `Atıftaki cilt (${ref.volume}) kullanılır; kayıttaki cilt (${recordVolume}) bu eserin atıflarında yazılmaz.` : `Kayıtta Cilt: ${recordVolume}. Cilt kutusu boş kalırsa atıfta "${recordVolume}/sayfa" yazılır.`) : null,
        h(
          "div",
          { class: "chips prefix-chips" },
          ...prefixChoices().map((p) =>
            h("button", {
              type: "button",
              class: (ref.prefix ?? "").trim() === p ? "chip on" : "chip",
              title: `Ön ek: ${p}`,
              onclick: () => {
                const next = (ref.prefix ?? "").trim() === p ? "" : p;
                set("prefix", next);
                prefix.value = next;
                renderBasket();
              },
            }, p),
          ),
        ),
        h("details", { open: Boolean(ref.prefix && !prefixChoices().includes(ref.prefix.trim())) || Boolean(ref.suffix) || Boolean(ref["suppress-author"]) }, h("summary", { class: "muted" }, "Ön ek, arka ek, yazar"), h("div", { class: "b-extra" }, prefix, suffix), h("div", { class: "b-flags" }, h("label", {}, hide, " Yazarı gizle"))),
      ),
    );
  });
  schedulePreview();
}

/** What İSNAD finds wrong in the record being cited (missing publisher, title in capitals …): fix it before it goes into the thesis. */
function recordIssues(w: Item | undefined): HTMLElement | null {
  if (!w || !S.byKey.has(w.key)) return null;
  const issues = [...checkItem(w), ...personIssues(w)].filter((i) => i.level !== "info");
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.level === "error").length;
  const shortMsg = (m: string) => (m.length > 70 ? `${m.slice(0, 70)}…` : m);
  return h(
    "p",
    { class: `small basket-warn${errors ? " error" : ""}` },
    `Künyede ${issues.length} ${errors ? "sorun" : "uyarı"}: ${issues.slice(0, 2).map((i) => shortMsg(i.message)).join(" · ")}${issues.length > 2 ? " …" : ""} `,
    h("button", { type: "button", class: "link", onclick: () => openEditor(w.key) }, "Künyeyi düzelt"),
  );
}

/** One-click prefixes: İSNAD's "bk.", "krş." (in English "see", "cf.", ISNAD Citation Style 2nd ed.). */
function prefixChoices(): string[] {
  return /^en/.test(doc().locale) ? ["see", "cf.", "see also", "for more information see"] : ["bk.", "krş.", "ayrıca bk.", "geniş bilgi için bk."];
}

/** The locator boxes: olağan cilt/sayfa, or İSNAD's hadith and dictionary systems. */
function locatorRow(
  ref: CiteRef,
  mode: ReturnType<typeof citeMode>,
  p: { label: HTMLSelectElement; vol: HTMLInputElement; loc: HTMLInputElement; showVolume: boolean; set: (f: keyof CiteRef, v: string | boolean) => void; enter: (e: KeyboardEvent) => void },
): HTMLElement {
  const box = (field: keyof CiteRef, placeholder: string, cls = "") => {
    const el = h("input", { placeholder, value: String(ref[field] ?? ""), class: cls, "aria-label": placeholder, "data-f": field, onkeydown: p.enter });
    el.oninput = () => p.set(field, el.value.trim());
    return el;
  };
  const hint = (t: string) => h("p", { class: "muted small mode-hint" }, t);
  switch (mode) {
    case "hadis-bab":
      return h("div", {}, h("div", { class: "b-loc three-even" }, box("kitab", "Kitâb (ör. Menâḳıb)"), box("bab", "Bâb no"), box("hadisNo", "Hadis no")), hint("İSNAD: “Kitâb”, Bâb (No. hadis). Sonraki atıflarda eserin adı yazılmaz."));
    case "hadis-no":
      return h("div", {}, h("div", { class: "b-loc three-even" }, box("kitab", "Kitâb (ör. Ticârât)"), box("bab", "Hadis no"), box("paren", "Cilt/sayfa")), hint("İSNAD: “Kitâb”, Hadis no. Cilt/sayfa isteğe bağlı, parantez içinde yazılır."));
    case "hadis-cilt":
      return h("div", {}, h("div", { class: "b-loc three-even" }, p.vol, p.loc, box("hadisNo", "Hadis no")), hint("İSNAD: Cilt/Sayfa (No. hadis)."));
    case "kuran": {
      const sel = h("select", { "aria-label": "Sûre", "data-f": "sure" }, h("option", { value: "" }, "Sûre seçin"), ...SURES.map(([n, , short]) => h("option", { value: String(n), selected: ref.sure === String(n) }, `${n} ${short}`)));
      sel.onchange = () => p.set("sure", sel.value);
      return h("div", {}, h("div", { class: "b-loc" }, sel, box("ayet", "Âyet (ör. 2 veya 2-4)")), hint("İSNAD: Sûre adı sûre no/âyet (el-Enfâl 8/2). Sonraki atıflarda yalnız sûre ve âyet yazılır."));
    }
    case "incil": {
      const sel = h(
        "select",
        { "aria-label": "Kitap", "data-f": "kitap" },
        h("option", { value: "" }, "Kitap seçin"),
        h("optgroup", { label: "Türkçe" }, ...BIBLE_BOOKS.map(([tr, ab]) => h("option", { value: ab, selected: ref.kitap === ab }, `${ab} ${tr}`))),
        h("optgroup", { label: "İngilizce" }, ...BIBLE_BOOKS.map(([, , en, ab]) => h("option", { value: ab, selected: ref.kitap === ab }, `${ab} ${en}`))),
      );
      sel.onchange = () => p.set("kitap", sel.value);
      return h("div", {}, h("div", { class: "b-loc three-even" }, sel, box("bab", "Bab"), box("cumle", "Cümle (ör. 10-12)")), hint("İSNAD: Kitap kısaltması Bab:Cümle (Yar.1:12). Sonraki atıflarda yalnız bu yazılır."));
    }
    case "sozluk":
      return h("div", {}, h("div", { class: "b-loc three-even" }, box("madde", "Madde (ör. delîl)"), p.vol, p.loc), hint("İSNAD: “Madde”, cilt/sayfa. Sonraki atıflarda sözlüğün adı yazılmaz; kaynakçada madde adı yer almaz."));
    default:
      return h("div", { class: p.showVolume ? "b-loc three" : "b-loc" }, p.label, p.showVolume ? p.vol : null, p.loc);
  }
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
    const items = { ...doc().items };
    for (const b of S.basket) {
      const w = work(b.id);
      if (w) items[b.id] = w;
    }
    const { cslMap, volumesCited } = await import("../../core/docstate.js");
    r.setItems(cslMap(items, volumesCited([...S.basket, ...Object.values(doc().citations).flatMap((c) => c.items)]), r.meta.isnad, r.language, doc().plainTitles === true));
    const p = $("preview");
    p.replaceChildren(...htmlToSegments(r.preview(S.basket)).map((seg) => h(seg.italic ? "i" : "span", { style: seg.bold ? "font-weight:bold" : undefined }, seg.text)));
  } catch (e) {
    $("preview").textContent = e instanceof Error ? e.message : String(e);
  }
}

export function clearBasket(): void {
  S.basket = [];
  S.editing = null;
  S.basketDirty = false;
  renderBasket();
  renderResults();
}

/** Removes the citation under edit from the document (its note too when nothing else is in it). */
export async function deleteEditing(): Promise<void> {
  const id = S.editing;
  if (!id) return;
  await run("Atıf siliniyor", async () => {
    const what = await serial(() => word.deleteCitation(id));
    clearBasket();
    await refresh(false, true);
    setMessage(what === "note" ? "Atıf ve dipnotu silindi; sonraki atıflar güncellendi." : what === "citation" ? "Atıf silindi; dipnottaki diğer yazı yerinde." : "Atıf belgede bulunamadı.", what === "none" ? "warning" : "success");
  });
}

export async function insert(): Promise<void> {
  if (S.editing && !S.basket.length) return deleteEditing();
  if (!S.basket.length) {
    const top = results[cursor];
    if (!top) return;
    addToBasket(top);
  }
  await run(S.editing ? "Atıf güncelleniyor" : "Atıf ekleniyor", async () => {
    const r = await getRenderer();
    const d = doc();
    const refs = S.basket.map((b) => ({ ...b }));
    const works: Record<string, Item> = {};
    for (const b of refs) {
      const w = work(b.id);
      if (w) works[b.id] = w;
    }
    if (S.editing) {
      putCitation(d, S.editing, refs, works);
      await refresh(false, true);
      setMessage("Atıf güncellendi.", "success");
    } else {
      // In a footnote next to a citation: the new works join it ("…; …"), as İSNAD separates works in one note.
      const point = await serial(() => word.insertionPoint()).catch(() => ({ inNote: false, joinWith: null }));
      const target = point.joinWith && d.citations[point.joinWith] ? point.joinWith : null;
      if (target) {
        const existing = d.citations[target]!.items;
        putCitation(d, target, [...existing, ...refs.filter((x) => !existing.some((e) => e.id === x.id && !x.locator && !x.kitab && !x.madde))], { ...works });
        await refresh(false, true);
        setMessage("Atıf aynı dipnottaki atıfa eklendi (; ile).", "success");
        clearBasket();
        $<HTMLInputElement>("q").value = "";
        search();
        $<HTMLInputElement>("q").focus();
        return;
      }
      const id = newCitationId();
      putCitation(d, id, refs, works);
      const { cslMap, volumesCited } = await import("../../core/docstate.js");
      r.setItems(cslMap(d.items, volumesCited(Object.values(d.citations).flatMap((c) => c.items)), r.meta.isnad, r.language, d.plainTitles === true));
      // Inside a note Word allows no new note: the citation is written in place.
      const want = r.meta.note && !point.inNote ? (d.notes ?? "footnote") : "text";
      const where = await serial(() => word.insertCitation(id, htmlToSegments(r.preview(refs)), want));
      word.enableAutoOpen();
      await refresh(false, true);
      if (point.inNote) setMessage("Atıf imlecin bulunduğu dipnota eklendi.", "success");
      else if (want !== "text" && where === "text") setMessage("Bu Word sürümü dipnot eklemeye izin vermiyor; atıf metne eklendi.", "warning");
      else setMessage("", "info");
    }
    clearBasket();
    $<HTMLInputElement>("q").value = "";
    search();
    $<HTMLInputElement>("q").focus();
  });
}

/** Cursor moved: inside a Derkenar citation → edit it. */
/**
 * Follows the Word cursor: inside a citation, the Atıf tab edits it. Only
 * while the Atıf tab is showing (or `open`: the ribbon's Atıf Ekle/Düzenle) —
 * the cursor never pulls the user away from another tab they chose.
 */
export async function onSelection(open = false): Promise<void> {
  if (!open && $("view-atif").hidden) return;
  const id = await serial(() => word.citationAtSelection()).catch(() => null);
  if (!open && $("view-atif").hidden) return;
  const d = doc();
  if (id && d.citations[id]) {
    if (S.editing === id) return;
    S.editing = id;
    S.basket = d.citations[id]!.items.map((r) => ({ ...r }));
    S.basketDirty = false;
    if (open) showView("atif");
    renderBasket();
    renderResults();
  } else if (S.editing && !S.basketDirty) {
    clearBasket();
  }
}

// ---------------------------------------------------------------- atıf kalıpları

/** A saved series of works with their places (a hadith's tahrîc, a recurring group of sources). */
interface CiteTemplate {
  name: string;
  refs: CiteRef[];
}

let templates: CiteTemplate[] = [];

async function loadTemplates(): Promise<void> {
  templates = (await getMeta<CiteTemplate[]>("citeTemplates").catch(() => undefined)) ?? [];
  renderTemplates();
}

async function saveTemplates(): Promise<void> {
  await setMeta("citeTemplates", templates);
  renderTemplates();
}

function renderTemplates(): void {
  $("tpl-box").hidden = templates.length === 0;
  $("tpl-count").textContent = `(${templates.length})`;
  $("tpl-list").replaceChildren(
    ...templates.map((t, i) => {
      const names = t.refs.map((r) => {
        const w = work(r.id);
        return w ? creatorLine(w) || titleOf(w) : "?";
      });
      return h(
        "li",
        {},
        h("button", {
          type: "button",
          class: "link",
          title: names.join("; "),
          onclick: () => {
            const missing = t.refs.filter((r) => !work(r.id)).length;
            for (const r of t.refs) if (work(r.id) && !S.basket.some((b) => b.id === r.id && (b.locator ?? "") === (r.locator ?? ""))) S.basket.push({ ...r });
            S.basketDirty = true;
            renderBasket();
            renderResults();
            if (missing) setMessage(`Kalıptaki ${missing} eser kütüphanede yok; diğerleri sepete eklendi.`, "warning");
          },
        }, `${t.name} (${t.refs.length})`),
        " ",
        h("button", {
          type: "button",
          class: "link danger-text",
          title: "Kalıbı sil",
          onclick: () => void run("Siliniyor", async () => {
            templates.splice(i, 1);
            await saveTemplates();
          }),
        }, "✕"),
      );
    }),
  );
}

function wireTemplates(): void {
  $("tpl-save-open").onclick = () => {
    $("tpl-form").hidden = false;
    $<HTMLInputElement>("tpl-name").focus();
  };
  $("tpl-cancel").onclick = () => ($("tpl-form").hidden = true);
  $<HTMLFormElement>("tpl-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Kaydediliyor", async () => {
      const name = $<HTMLInputElement>("tpl-name").value.trim();
      if (!name) throw new Error("Kalıba bir ad verin.");
      if (!S.basket.length) throw new Error("Sepet boş.");
      const refs = S.basket.map((r) => JSON.parse(JSON.stringify(r)) as CiteRef);
      const at = templates.findIndex((t) => t.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"));
      if (at >= 0) templates[at] = { name, refs };
      else templates.push({ name, refs });
      templates.sort((a, b) => a.name.localeCompare(b.name, "tr"));
      await saveTemplates();
      $("tpl-form").hidden = true;
      $<HTMLInputElement>("tpl-name").value = "";
      setMessage(`"${name}" kalıbı kaydedildi; Atıf sekmesindeki "Atıf kalıpları"ndan çağırılır.`, "success");
    });
  };
  void loadTemplates();
}

export function wireCite(): void {
  wireTemplates();
  const q = $<HTMLInputElement>("q");
  q.oninput = search;
  q.onkeydown = (e) => {
    if (e.key === "ArrowDown") (e.preventDefault(), moveCursor(1));
    else if (e.key === "ArrowUp") (e.preventDefault(), moveCursor(-1));
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.preventDefault(), void insert());
    else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[cursor];
      if (item) {
        addToBasket(item);
        const quick = parseQuick(q.value);
        const ref = S.basket.find((b) => b.id === item.key);
        if (ref && quick.locator) {
          ref.locator = quick.locator;
          if (quick.volume) ref.volume = quick.volume;
          if (quick.label) ref.label = quick.label;
          renderBasket();
        }
      }
      q.select();
    } else if (e.key === "Escape") {
      q.value = "";
      search();
    }
  };
  $("insert").onclick = () => void insert();
  $("clear-basket").onclick = clearBasket;
  $("edit-new").onclick = clearBasket;
  $("edit-delete").onclick = () => void deleteEditing();
}

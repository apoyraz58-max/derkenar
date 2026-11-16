/**
 * Atıf: search, build the citation (several works, cilt/sayfa, prefixes),
 * insert it or update the citation under the cursor.
 */
import { newCitationId, putCitation } from "../../core/docstate.js";
import { LOCATOR_LABELS } from "../../core/engine.js";
import { htmlToSegments } from "../../core/html.js";
import type { CiteRef } from "../../core/types.js";
import { type Item, containerOf, creatorLine, isNoteItem, itemTypeLabel, titleOf, yearOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { citedKeys, refresh } from "./document.js";
import { parseQuick } from "../../core/search.js";
import { $, S, doc, getRenderer, h, run, serial, setMessage, showView, work } from "./core.js";

let results: Item[] = [];
let cursor = 0;

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

function renderResults(): void {
  const inBasket = new Set(S.basket.map((b) => b.id));
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
  if (!S.basket.some((b) => b.id === item.key)) S.basket.push(item.itemType === "manuscript" ? { id: item.key, label: "folio" } : { id: item.key });
  S.basketDirty = true;
  renderBasket();
  renderResults();
}

export function renderBasket(): void {
  $("basket-section").hidden = S.basket.length === 0;
  $("insert").textContent = S.editing ? "Atıfı güncelle" : "Atıf ekle";
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
        h("div", { class: showVolume ? "b-loc three" : "b-loc" }, label, showVolume ? vol : null, loc),
        recordVolume && showVolume ? h("p", { class: "muted small" }, ref.volume ? `Atıftaki cilt (${ref.volume}) kullanılır; kayıttaki cilt (${recordVolume}) bu eserin atıflarında yazılmaz.` : `Kayıtta Cilt: ${recordVolume}. Cilt kutusu boş kalırsa atıfta "${recordVolume}/sayfa" yazılır.`) : null,
        h("details", {}, h("summary", { class: "muted" }, "Ön ek, arka ek, yazar"), h("div", { class: "b-extra" }, prefix, suffix), h("div", { class: "b-flags" }, h("label", {}, hide, " Yazarı gizle"))),
      ),
    );
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
    const items = { ...doc().items };
    for (const b of S.basket) {
      const w = work(b.id);
      if (w) items[b.id] = w;
    }
    const { cslMap, volumesCited } = await import("../../core/docstate.js");
    r.setItems(cslMap(items, volumesCited([...S.basket, ...Object.values(doc().citations).flatMap((c) => c.items)])));
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

export async function insert(): Promise<void> {
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
      const id = newCitationId();
      putCitation(d, id, refs, works);
      const { cslMap, volumesCited } = await import("../../core/docstate.js");
      r.setItems(cslMap(d.items, volumesCited(Object.values(d.citations).flatMap((c) => c.items))));
      const want = r.meta.note ? (d.notes ?? "footnote") : "text";
      const where = await serial(() => word.insertCitation(id, htmlToSegments(r.preview(refs)), want));
      word.enableAutoOpen();
      await refresh(false, true);
      if (want !== "text" && where === "text") setMessage("Bu Word sürümü dipnot eklemeye izin vermiyor; atıf metne eklendi.", "warning");
      else setMessage("", "info");
    }
    clearBasket();
    $<HTMLInputElement>("q").value = "";
    search();
    $<HTMLInputElement>("q").focus();
  });
}

/** Cursor moved: inside a Derkenar citation → edit it. */
export async function onSelection(): Promise<void> {
  const id = await serial(() => word.citationAtSelection()).catch(() => null);
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

export function wireCite(): void {
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
}

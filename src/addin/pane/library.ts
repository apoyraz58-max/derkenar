/**
 * Kütüphane: Zotero's left and middle panes in one column. Collection tree
 * (with My Library, Unfiled, Duplicates, Trash, This document), search, tag
 * filter, sorting, multi-select and bulk actions.
 */
import { Renderer } from "../../core/engine.js";
import { htmlToText } from "../../core/html.js";
import { type SortKey, type View, collectionTree, descendants, findDuplicates, inView, mergeItems, sortItems, tagCounts } from "../../core/library.js";
import { fold } from "../../core/search.js";
import { type Condition, type SavedSearch, OPS, SEARCH_FIELDS, describe, matches, opsFor } from "../../core/searchquery.js";
import { report } from "../../core/zoteroexport.js";
import { type Item, emptyItem, itemTypeLabel, itemTypes, newKey, now } from "../../core/zotero.js";
import { addToBasket, resultRow } from "./cite.js";
import { citedKeys } from "./document.js";
import { $, S, copyText, download, getRenderer, h, putCollections, putItems, putSearches, run, setMessage, setTagColors, showView } from "./core.js";
import { openEditor } from "./editor.js";

let sortKey: SortKey = "creator";
let desc = false;
const tagFilter = new Set<string>();
let shown: Item[] = [];

export function currentView(): View {
  const v = S.libView;
  if (v.startsWith("c:")) return { kind: "collection", key: v.slice(2), deep: true };
  if (v === "document") return { kind: "document", keys: citedKeys() };
  if (v.startsWith("s:") || v === "adv") return { kind: "all" };
  return { kind: v as "all" | "unfiled" | "trash" | "duplicates" };
}

/** The search being shown: a saved one ("s:KEY") or the unsaved advanced search ("adv"). */
let advanced: SavedSearch = { key: "", name: "", mode: "all", conditions: [{ field: "any", op: "contains", value: "" }] };
function activeSearch(): SavedSearch | null {
  if (S.libView === "adv") return advanced;
  if (S.libView.startsWith("s:")) return S.searches.find((x) => x.key === S.libView.slice(2)) ?? null;
  return null;
}

/** Is the item in what the library list shows now (collection, special view or search)? */
export function inCurrentView(item: Item): boolean {
  const s = activeSearch();
  if (s) return !item.deleted && matches(item, s, S.collections);
  return inView(item, currentView(), S.collections);
}

/** Tag color of an item: Zotero shows colored tags as dots before the title. */
function tagDots(item: Item): HTMLElement | null {
  const dots = S.tagColors.filter((c) => item.tags.some((t) => t.tag === c.tag));
  return dots.length ? h("span", { class: "dots" }, ...dots.map((d) => h("span", { class: "dot", style: `background:${d.color}`, title: d.tag }))) : null;
}

function renderViewSelect(): void {
  const sel = $<HTMLSelectElement>("lib-view");
  const live = S.items.filter((i) => !i.deleted);
  const count = (fn: (i: Item) => boolean) => S.items.filter(fn).length;
  const opts = [
    h("option", { value: "all" }, `Kütüphanem (${live.length})`),
    h("option", { value: "document" }, `Bu belgede atıf yapılanlar (${citedKeys().size})`),
    h("option", { value: "unfiled" }, `Koleksiyonsuz (${count((i) => !i.deleted && !i.collections.length)})`),
    h("option", { value: "duplicates" }, "Yinelenen kaynaklar"),
    h("option", { value: "trash" }, `Çöp kutusu (${count((i) => Boolean(i.deleted))})`),
  ];
  const tree = collectionTree(S.collections);
  if (tree.length) opts.push(h("option", { disabled: true }, "── Koleksiyonlar ──"));
  for (const { c, depth } of tree) {
    const n = S.items.filter((i) => !i.deleted && i.collections.includes(c.key)).length;
    opts.push(h("option", { value: `c:${c.key}` }, `${"  ".repeat(depth)}${depth ? "└ " : ""}${c.name} (${n})`));
  }
  if (S.searches.length || S.libView === "adv") opts.push(h("option", { disabled: true }, "── Kayıtlı aramalar ──"));
  if (S.libView === "adv") opts.push(h("option", { value: "adv" }, "Gelişmiş arama (kaydedilmedi)"));
  for (const x of [...S.searches].sort((a, b) => a.name.localeCompare(b.name, "tr"))) opts.push(h("option", { value: `s:${x.key}`, title: describe(x) }, `🔍 ${x.name}`));
  sel.replaceChildren(...opts);
  if (![...sel.options].some((o) => o.value === S.libView)) S.libView = "all";
  sel.value = S.libView;
  const bulkColl = document.querySelector<HTMLSelectElement>('[data-bulk="addto"]')!;
  bulkColl.replaceChildren(h("option", { value: "" }, "Koleksiyona ekle…"), ...tree.map(({ c, depth }) => h("option", { value: c.key }, `${"  ".repeat(depth)}${c.name}`)));
}

function renderTags(): void {
  const base = S.items.filter(inCurrentView);
  const tags = tagCounts(base);
  const color = new Map(S.tagColors.map((c) => [c.tag, c.color]));
  if (manageTags) return renderTagManager(tagCounts(S.items));
  $("tag-count").textContent = tagFilter.size ? `(${tagFilter.size} seçili)` : `(${tags.length})`;
  $("tags").replaceChildren(
    ...tags.map((t) =>
      h(
        "button",
        {
          type: "button",
          class: `chip${tagFilter.has(t.tag) ? " on" : ""}${t.automatic ? " auto" : ""}`,
          style: color.has(t.tag) ? `border-color:${color.get(t.tag)};box-shadow:inset 3px 0 0 ${color.get(t.tag)}` : undefined,
          onclick: () => {
            if (tagFilter.has(t.tag)) tagFilter.delete(t.tag);
            else tagFilter.add(t.tag);
            renderList();
          },
        },
        `${t.tag} ${t.count}`,
      ),
    ),
    ...(tagFilter.size ? [h("button", { type: "button", class: "link", onclick: () => (tagFilter.clear(), renderList()) }, "Süzgeci temizle")] : []),
  );
}

let manageTags = false;
const COLORS = ["#ff6666", "#ff8c19", "#999999", "#5fb236", "#009980", "#2ea8e5", "#576dd9", "#a28ae5", "#a6507b"];

function renderTagManager(tags: { tag: string; count: number }[]): void {
  $("tag-count").textContent = `(${tags.length})`;
  const color = new Map(S.tagColors.map((c) => [c.tag, c.color]));
  $("tags").replaceChildren(
    h("p", { class: "muted small" }, "Etiketi yeniden adlandırın (aynı ada çevirirseniz birleşir), renk verin (en çok 9; renkli etiketler listede nokta olarak görünür) ya da silin."),
    ...tags.map((t) => {
      const name = h("input", { value: t.tag, "aria-label": "Etiket adı" });
      const col = h("select", { "aria-label": "Renk" }, h("option", { value: "" }, "Renk yok"), ...COLORS.map((c, i) => h("option", { value: c, selected: color.get(t.tag) === c, style: `color:${c}` }, `● Renk ${i + 1}`)));
      name.onchange = () => void run("Etiket yeniden adlandırılıyor", () => renameTag(t.tag, name.value.trim()));
      col.onchange = () =>
        void run("Renk", async () => {
          const rest = S.tagColors.filter((c) => c.tag !== t.tag);
          if (col.value) {
            if (rest.length >= 9) throw new Error("En çok 9 renkli etiket olabilir.");
            rest.push({ tag: t.tag, color: col.value });
          }
          await setTagColors(rest);
        });
      return h("div", { class: "tag-row" }, name, h("span", { class: "muted small" }, String(t.count)), col, h("button", { type: "button", class: "icon-btn danger-text", title: "Etiketi sil", onclick: () => void run("Etiket siliniyor", () => renameTag(t.tag, "")) }, "✕"));
    }),
  );
}

/** Renames a tag across the library (empty name: deletes it). */
async function renameTag(from: string, to: string): Promise<void> {
  const t = now();
  const changed = S.items
    .filter((i) => i.tags.some((x) => x.tag === from))
    .map((i) => {
      const tags = i.tags.filter((x) => x.tag !== from);
      if (to && !tags.some((x) => x.tag === to)) tags.push({ tag: to });
      return { ...i, tags, dateModified: t };
    });
  await putItems(changed, [], true);
  const colors = S.tagColors.map((c) => (c.tag === from ? { ...c, tag: to } : c)).filter((c) => c.tag);
  await setTagColors(colors);
  tagFilter.delete(from);
  setMessage(to ? `"${from}" → "${to}" (${changed.length} kaynak).` : `"${from}" etiketi ${changed.length} kaynaktan silindi.`, "success");
}

function renderAdvanced(): void {
  const box = $("adv-conds");
  box.replaceChildren(
    ...advanced.conditions.map((c, i) => {
      const field = h("select", { "aria-label": "Alan" }, ...SEARCH_FIELDS.map(([v, l]) => h("option", { value: v, selected: v === c.field }, l)));
      const op = h("select", { "aria-label": "Koşul" }, ...opsFor(c.field).map((o) => h("option", { value: o, selected: o === c.op }, OPS[o])));
      let value: HTMLInputElement | HTMLSelectElement;
      if (c.field === "itemType") value = h("select", {}, ...itemTypes().map((t) => h("option", { value: t, selected: t === c.value }, itemTypeLabel(t))));
      else if (c.field === "collection") value = h("select", {}, ...collectionTree(S.collections).map(({ c: col, depth }) => h("option", { value: col.key, selected: col.key === c.value }, `${"\u00a0\u00a0".repeat(depth)}${col.name}`)));
      else value = h("input", { value: c.value, placeholder: c.field === "dateAdded" || c.field === "dateModified" ? (c.op === "isInTheLast" ? "gün sayısı" : "2025-01-31") : "değer" });
      if (value instanceof HTMLSelectElement && !c.value) c.value = value.value;
      field.onchange = () => {
        advanced.conditions[i] = { field: field.value, op: opsFor(field.value)[0]!, value: "" };
        renderAdvanced();
      };
      op.onchange = () => (advanced.conditions[i]!.op = op.value as Condition["op"]);
      value.oninput = value.onchange = () => (advanced.conditions[i]!.value = value.value);
      if (value instanceof HTMLInputElement) value.onkeydown = (e) => e.key === "Enter" && (e.preventDefault(), runAdvanced());
      const del = h("button", { type: "button", class: "icon-btn", title: "Koşulu kaldır", onclick: () => (advanced.conditions.splice(i, 1), advanced.conditions.length || advanced.conditions.push({ field: "any", op: "contains", value: "" }), renderAdvanced()) }, "✕");
      return h("div", { class: "cond" }, field, op, value, del);
    }),
  );
  $<HTMLSelectElement>("adv-mode").value = advanced.mode;
}

function runAdvanced(): void {
  S.libView = "adv";
  S.selected.clear();
  renderViewSelect();
  renderList();
}

export function renderList(): void {
  renderTags();
  const view = currentView();
  const q = $<HTMLInputElement>("lib-q").value.trim();
  const list = $("lib-list");
  list.replaceChildren();
  const trash = view.kind === "trash";
  for (const b of document.querySelectorAll<HTMLElement>("[data-bulk]")) {
    const k = b.dataset.bulk!;
    b.hidden = (trash && !["restore", "purge", "export"].includes(k)) || (!trash && (k === "restore" || k === "purge")) || (k === "remove-from" && view.kind !== "collection");
  }
  $("trash-empty").hidden = !trash;
  if (view.kind === "duplicates") return renderDuplicates();

  let items = S.items.filter(inCurrentView);
  if (tagFilter.size) items = items.filter((i) => [...tagFilter].every((t) => i.tags.some((x) => x.tag === t)));
  if (q) {
    const hits = new Set(S.index.search(q, 100000).map((x) => x.item.key));
    items = trash ? items.filter((i) => fold(JSON.stringify(i.fields)).includes(fold(q))) : items.filter((i) => hits.has(i.key));
  }
  shown = sortItems(items, sortKey, desc);
  $("lib-count").textContent = `${shown.length} kaynak`;
  const frag = document.createDocumentFragment();
  for (const item of shown.slice(0, 500)) frag.append(row(item));
  if (shown.length > 500) frag.append(h("li", { class: "muted" }, `İlk 500 kaynak gösteriliyor; aramayı daraltın.`));
  list.append(frag);
  if (!shown.length) list.append(h("li", { class: "muted" }, trash ? "Çöp kutusu boş." : "Bu görünümde kaynak yok."));
  renderBulk();
}

function row(item: Item): HTMLLIElement {
  const cb = h("input", { type: "checkbox", checked: S.selected.has(item.key), "aria-label": "Seç" });
  cb.onclick = (e) => {
    e.stopPropagation();
    if (cb.checked) S.selected.add(item.key);
    else S.selected.delete(item.key);
    renderBulk();
  };
  const li = resultRow(item, { class: "item-row" });
  const dots = tagDots(item);
  if (dots) li.querySelector(".r-title")?.prepend(dots);
  if (item.dirty) li.querySelector(".r-author")?.append(h("span", { class: "r-dirty", title: "Çevrimiçi kütüphaneye gönderilmedi" }, " ●"));
  li.prepend(cb);
  li.onclick = (e) => (e.detail === 2 ? (addToBasket(item), showView("atif")) : openEditor(item.key));
  return li;
}


function renderBulk(): void {
  for (const k of [...S.selected]) if (!S.byKey.has(k)) S.selected.delete(k);
  $("bulk").hidden = S.selected.size === 0;
  $("bulk-count").textContent = `${S.selected.size} seçili:`;
  $<HTMLInputElement>("lib-all").checked = shown.length > 0 && shown.every((i) => S.selected.has(i.key));
}

function renderDuplicates(): void {
  const groups = findDuplicates(S.items);
  $("lib-count").textContent = `${groups.length} grup`;
  const list = $("lib-list");
  if (!groups.length) list.append(h("li", { class: "muted" }, "Yinelenen kaynak bulunmadı."));
  for (const g of groups) {
    const name = `dup-${g[0]!.key}`;
    const radios = g.map((item, i) => {
      const r = h("input", { type: "radio", name, value: item.key, checked: i === 0 });
      const li = resultRow(item, { class: "item-row" });
      li.prepend(r);
      li.onclick = () => (r.checked = true);
      return li;
    });
    list.append(
      h(
        "li",
        { class: "dup-group" },
        h("ol", { class: "items" }, ...radios),
        h(
          "button",
          {
            type: "button",
            onclick: () =>
              void run("Birleştiriliyor", async () => {
                const masterKey = (list.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? g[0]!.key) as string;
                await merge(g.find((x) => x.key === masterKey)!, g.filter((x) => x.key !== masterKey));
              }),
          },
          `${g.length} kaydı birleştir (seçili olan kalır)`,
        ),
      ),
    );
  }
}

async function merge(master: Item, others: Item[]): Promise<void> {
  const merged = mergeItems(master, others);
  await putItems([merged, ...others.map((o) => ({ ...o, deleted: true, dateModified: now(), fields: { ...o.fields, extra: [o.fields.extra, `Derkenar: ${master.key} ile birleştirildi`].filter(Boolean).join("\n") } }))], [], true);
  // Citations in this document that point at a merged-away item keep working (the document has its copy).
  setMessage(`${others.length + 1} kayıt birleştirildi; diğerleri çöp kutusunda.`, "success");
}

// ---------------------------------------------------------------- bulk actions

function selectedItems(): Item[] {
  return [...S.selected].map((k) => S.byKey.get(k)).filter((x): x is Item => Boolean(x));
}

async function bulk(action: string, value?: string): Promise<void> {
  const items = selectedItems();
  if (!items.length) return;
  const t = now();
  switch (action) {
    case "cite":
      for (const i of items) addToBasket(i);
      showView("atif");
      return;
    case "addto":
      if (!value) return;
      await putItems(items.map((i) => (i.collections.includes(value) ? i : { ...i, collections: [...i.collections, value], dateModified: t })), [], true);
      setMessage(`${items.length} kaynak koleksiyona eklendi.`, "success");
      return;
    case "remove-from": {
      const v = currentView();
      if (v.kind !== "collection") return;
      const drop = new Set([v.key, ...descendants(v.key, S.collections)]);
      await putItems(items.map((i) => ({ ...i, collections: i.collections.filter((c) => !drop.has(c)), dateModified: t })), [], true);
      setMessage(`${items.length} kaynak koleksiyondan çıkarıldı.`, "success");
      return;
    }
    case "tag": {
      const tag = await ask("Eklenecek etiket");
      if (!tag) return;
      await putItems(items.map((i) => (i.tags.some((x) => x.tag === tag) ? i : { ...i, tags: [...i.tags, { tag }], dateModified: t })), [], true);
      setMessage(`"${tag}" etiketi ${items.length} kaynağa eklendi.`, "success");
      return;
    }
    case "check": {
      $<HTMLSelectElement>("chk-scope").value = "selected";
      showView("denetim");
      $("chk-run").click();
      return;
    }
    case "bib": {
      const r = await getRenderer();
      const text = await bibliographyOf(r, items);
      await copyText(text.text, text.html);
      setMessage(`${items.length} kaynağın kaynakçası panoya kopyalandı.`, "success");
      return;
    }
    case "report":
      download(`derkenar-rapor-${new Date().toISOString().slice(0, 10)}.html`, report(items, S.collections), "text/html");
      setMessage(`${items.length} kaynağın raporu hazırlandı.`, "success");
      return;
    case "export":
      $<HTMLSelectElement>("ex-scope").value = "selected";
      showView("aktar");
      $("ex-format").focus();
      return;
    case "merge":
      if (items.length < 2) throw new Error("Birleştirmek için en az iki kaynak seçin.");
      if (new Set(items.map((i) => i.itemType)).size > 1) throw new Error("Yalnız aynı türdeki kaynaklar birleştirilebilir.");
      await merge(items[0]!, items.slice(1));
      S.selected.clear();
      return;
    case "trash":
      await putItems(items.map((i) => ({ ...i, deleted: true, dateModified: t })), [], true);
      S.selected.clear();
      setMessage(`${items.length} kaynak çöp kutusuna taşındı.`, "success");
      return;
    case "restore":
      await putItems(items.map((i) => {
        const { deleted: _d, ...rest } = i;
        return { ...rest, dateModified: t };
      }), [], true);
      S.selected.clear();
      setMessage(`${items.length} kaynak geri yüklendi.`, "success");
      return;
    case "purge":
      await putItems([], items.map((i) => i.key));
      S.selected.clear();
      setMessage(`${items.length} kaynak kalıcı olarak silindi.`, "success");
      return;
  }
}

/** Bibliography of arbitrary items (copy to clipboard), with the document's style. */
async function bibliographyOf(r: Renderer, items: Item[]): Promise<{ text: string; html: string }> {
  const { cslMap } = await import("../../core/docstate.js");
  const map = cslMap(Object.fromEntries(items.map((i) => [i.key, i])));
  r.setItems(map);
  r.renderCitations(items.map((i, n) => ({ id: `__bib${n}`, items: [{ id: i.key }], noteIndex: n + 1 })));
  const bib = r.bibliography();
  const entries = bib?.entries ?? [];
  return { text: entries.map((e) => htmlToText(e.html)).join("\n"), html: entries.map((e) => `<p>${e.html.replace(/<\/?div[^>]*>/g, "")}</p>`).join("") };
}

/** Inline prompt (window.prompt does not work inside Office). */
function ask(label: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const form = $<HTMLFormElement>("coll-form");
    const input = $<HTMLInputElement>("coll-name");
    input.placeholder = label;
    input.value = initial;
    form.hidden = false;
    input.focus();
    form.onsubmit = (e) => {
      e.preventDefault();
      form.hidden = true;
      resolve(input.value.trim() || null);
    };
    $("coll-cancel").onclick = () => {
      form.hidden = true;
      resolve(null);
    };
  });
}

// ---------------------------------------------------------------- collections

async function collectionAction(kind: "new" | "sub" | "rename" | "delete"): Promise<void> {
  (document.querySelector("#view-kutuphane details.menu") as HTMLDetailsElement).open = false;
  const v = currentView();
  const current = v.kind === "collection" ? S.collections.find((c) => c.key === v.key) : undefined;
  if ((kind === "sub" || kind === "rename" || kind === "delete") && !current) throw new Error("Önce listeden bir koleksiyon seçin.");
  if (kind === "new" || kind === "sub") {
    const name = await ask(kind === "sub" ? `"${current!.name}" içinde yeni koleksiyon` : "Yeni koleksiyon adı");
    if (!name) return;
    const c = { key: newKey(), name, ...(kind === "sub" ? { parentKey: current!.key } : {}) };
    await putCollections([c]);
    S.libView = `c:${c.key}`;
  } else if (kind === "rename") {
    const name = await ask("Yeni ad", current!.name);
    if (!name) return;
    await putCollections([{ ...current!, name }]);
  } else {
    const drop = [current!.key, ...descendants(current!.key, S.collections)];
    const t = now();
    const touched = S.items.filter((i) => i.collections.some((c) => drop.includes(c))).map((i) => ({ ...i, collections: i.collections.filter((c) => !drop.includes(c)), dateModified: t }));
    await putItems(touched, [], true);
    await putCollections([], drop);
    S.libView = "all";
    setMessage(`"${current!.name}" silindi; içindeki kaynaklar kütüphanede duruyor.`, "success");
  }
}

export function newItem(itemType: string): void {
  void run("Oluşturuluyor", async () => {
    const item = emptyItem(itemType, "manual");
    if (itemType === "note") item.notes = [{ key: newKey(), note: "", dateModified: now() }];
    const v = currentView();
    if (v.kind === "collection") item.collections = [v.key];
    await putItems([item]);
    openEditor(item.key, true);
  });
}

export function wireLibrary(): void {
  const types = itemTypes().map((t) => [t, itemTypeLabel(t)] as const).sort((a, b) => a[1].localeCompare(b[1], "tr"));
  const common = ["book", "bookSection", "journalArticle", "encyclopediaArticle", "thesis", "manuscript", "conferencePaper", "webpage"];
  $<HTMLSelectElement>("lib-new").append(
    h("option", { value: "note" }, "📝 Bağımsız not"),
    h("optgroup", { label: "Sık kullanılan" }, ...common.map((t) => h("option", { value: t }, itemTypeLabel(t)))),
    h("optgroup", { label: "Bütün türler" }, ...types.map(([t, l]) => h("option", { value: t }, l))),
  );
  $<HTMLSelectElement>("lib-new").onchange = () => {
    const t = $<HTMLSelectElement>("lib-new").value;
    $<HTMLSelectElement>("lib-new").value = "";
    if (t) newItem(t);
  };
  $<HTMLSelectElement>("lib-view").onchange = () => {
    S.libView = $<HTMLSelectElement>("lib-view").value;
    const saved = S.libView.startsWith("s:") ? activeSearch() : null;
    if (saved) {
      advanced = JSON.parse(JSON.stringify(saved)) as SavedSearch;
      renderAdvanced();
    }
    S.selected.clear();
    tagFilter.clear();
    renderList();
  };
  $<HTMLInputElement>("lib-q").oninput = renderList;
  $<HTMLSelectElement>("lib-sort").onchange = () => {
    sortKey = $<HTMLSelectElement>("lib-sort").value as SortKey;
    renderList();
  };
  $("lib-desc").onclick = () => {
    desc = !desc;
    $("lib-desc").textContent = desc ? "↓" : "↑";
    renderList();
  };
  $<HTMLInputElement>("lib-all").onchange = () => {
    if ($<HTMLInputElement>("lib-all").checked) for (const i of shown) S.selected.add(i.key);
    else S.selected.clear();
    renderList();
  };
  for (const el of document.querySelectorAll<HTMLElement>("[data-bulk]")) {
    const k = el.dataset.bulk!;
    if (el instanceof HTMLSelectElement) el.onchange = () => void run("Uygulanıyor", async () => (await bulk(k, el.value), (el.value = "")));
    else el.onclick = () => void run("Uygulanıyor", () => bulk(k));
  }
  $("tag-manage").onchange = () => {
    manageTags = $<HTMLInputElement>("tag-manage").checked;
    renderList();
  };
  renderAdvanced();
  $<HTMLSelectElement>("adv-mode").onchange = () => (advanced.mode = $<HTMLSelectElement>("adv-mode").value as "all" | "any");
  $("adv-add").onclick = () => (advanced.conditions.push({ field: "title", op: "contains", value: "" }), renderAdvanced());
  $("adv-run").onclick = runAdvanced;
  $("adv-clear").onclick = () => {
    advanced = { key: "", name: "", mode: "all", conditions: [{ field: "any", op: "contains", value: "" }] };
    renderAdvanced();
    if (S.libView === "adv") S.libView = "all";
    renderViewSelect();
    renderList();
  };
  $("adv-save").onclick = () =>
    void run("Arama kaydediliyor", async () => {
      const name = await ask("Kayıtlı aramanın adı", S.libView.startsWith("s:") ? (activeSearch()?.name ?? "") : "");
      if (!name) return;
      const key = S.libView.startsWith("s:") ? S.libView.slice(2) : newKey();
      await putSearches([{ ...JSON.parse(JSON.stringify(advanced)), key, name }]);
      S.libView = `s:${key}`;
      renderViewSelect();
      renderList();
      setMessage(`"${name}" kayıtlı aramalara eklendi.`, "success");
    });
  $("search-delete").onclick = () =>
    void run("Arama siliniyor", async () => {
      (document.querySelector("#view-kutuphane details.menu") as HTMLDetailsElement).open = false;
      const s = S.libView.startsWith("s:") ? activeSearch() : null;
      if (!s) throw new Error("Önce listeden bir kayıtlı arama seçin.");
      await putSearches([], [s.key]);
      S.libView = "all";
      renderViewSelect();
      renderList();
      setMessage(`"${s.name}" silindi.`, "success");
    });
  $("coll-new").onclick = () => void run("Koleksiyon", () => collectionAction("new"));
  $("coll-sub").onclick = () => void run("Koleksiyon", () => collectionAction("sub"));
  $("coll-rename").onclick = () => void run("Koleksiyon", () => collectionAction("rename"));
  $("coll-delete").onclick = () => void run("Koleksiyon", () => collectionAction("delete"));
  $("trash-empty").onclick = () =>
    void run("Çöp boşaltılıyor", async () => {
      const keys = S.items.filter((i) => i.deleted).map((i) => i.key);
      await putItems([], keys);
      setMessage(`${keys.length} kaynak kalıcı olarak silindi.`, "success");
    });
}

export function refreshLibraryView(): void {
  renderViewSelect();
  if (!$("view-kutuphane").hidden) renderList();
}

export { renderViewSelect };

/**
 * Kütüphane: Zotero's left and middle panes in one column. Collection tree
 * (with My Library, Unfiled, Duplicates, Trash, This document), search, tag
 * filter, sorting, multi-select and bulk actions.
 */
import { Renderer } from "../../core/engine.js";
import { htmlToText } from "../../core/html.js";
import { type SortKey, type View, collectionTree, descendants, findDuplicates, inView, mergeItems, sortItems, tagCounts } from "../../core/library.js";
import { fold } from "../../core/search.js";
import { type Item, emptyItem, itemTypeLabel, itemTypes, newKey, now } from "../../core/zotero.js";
import { addToBasket, resultRow } from "./cite.js";
import { citedKeys } from "./document.js";
import { $, S, copyText, getRenderer, h, putCollections, putItems, run, setMessage, showView } from "./core.js";
import { openEditor } from "./editor.js";

let sortKey: SortKey = "creator";
let desc = false;
const tagFilter = new Set<string>();
let shown: Item[] = [];

export function currentView(): View {
  const v = S.libView;
  if (v.startsWith("c:")) return { kind: "collection", key: v.slice(2), deep: true };
  if (v === "document") return { kind: "document", keys: citedKeys() };
  return { kind: v as "all" | "unfiled" | "trash" | "duplicates" };
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
  sel.replaceChildren(...opts);
  if (![...sel.options].some((o) => o.value === S.libView)) S.libView = "all";
  sel.value = S.libView;
  const bulkColl = document.querySelector<HTMLSelectElement>('[data-bulk="addto"]')!;
  bulkColl.replaceChildren(h("option", { value: "" }, "Koleksiyona ekle…"), ...tree.map(({ c, depth }) => h("option", { value: c.key }, `${"  ".repeat(depth)}${c.name}`)));
}

function renderTags(): void {
  const base = S.items.filter((i) => inView(i, currentView(), S.collections));
  const tags = tagCounts(base);
  $("tag-count").textContent = tagFilter.size ? `(${tagFilter.size} seçili)` : `(${tags.length})`;
  $("tags").replaceChildren(
    ...tags.map((t) =>
      h(
        "button",
        {
          type: "button",
          class: `chip${tagFilter.has(t.tag) ? " on" : ""}${t.automatic ? " auto" : ""}`,
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

  let items = S.items.filter((i) => inView(i, view, S.collections));
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
  await putItems([merged, ...others.map((o) => ({ ...o, deleted: true, dateModified: now(), fields: { ...o.fields, extra: [o.fields.extra, `Derkenar: ${master.key} ile birleştirildi`].filter(Boolean).join("\n") } }))]);
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
      await putItems(items.map((i) => (i.collections.includes(value) ? i : { ...i, collections: [...i.collections, value], dateModified: t })));
      setMessage(`${items.length} kaynak koleksiyona eklendi.`, "success");
      return;
    case "remove-from": {
      const v = currentView();
      if (v.kind !== "collection") return;
      const drop = new Set([v.key, ...descendants(v.key, S.collections)]);
      await putItems(items.map((i) => ({ ...i, collections: i.collections.filter((c) => !drop.has(c)), dateModified: t })));
      setMessage(`${items.length} kaynak koleksiyondan çıkarıldı.`, "success");
      return;
    }
    case "tag": {
      const tag = await ask("Eklenecek etiket");
      if (!tag) return;
      await putItems(items.map((i) => (i.tags.some((x) => x.tag === tag) ? i : { ...i, tags: [...i.tags, { tag }], dateModified: t })));
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
      await putItems(items.map((i) => ({ ...i, deleted: true, dateModified: t })));
      S.selected.clear();
      setMessage(`${items.length} kaynak çöp kutusuna taşındı.`, "success");
      return;
    case "restore":
      await putItems(items.map((i) => {
        const { deleted: _d, ...rest } = i;
        return { ...rest, dateModified: t };
      }));
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
    await putItems(touched);
    await putCollections([], drop);
    S.libView = "all";
    setMessage(`"${current!.name}" silindi; içindeki kaynaklar kütüphanede duruyor.`, "success");
  }
}

export function newItem(itemType: string): void {
  void run("Oluşturuluyor", async () => {
    const item = emptyItem(itemType, "manual");
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

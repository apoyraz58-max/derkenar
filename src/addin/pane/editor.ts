/**
 * Kaynak düzenleyici: Zotero's item pane. Every field of the item type in
 * Zotero's order, creators with roles (İSNAD roles included), tags, notes,
 * related items, collections. Saves as you type, like Zotero; a cited work's
 * citations in the document follow at once.
 */
import { LEVEL_LABEL, applyFix, checkItem } from "../../core/isnad.js";
import { collectionTree, tagCounts } from "../../core/library.js";
import {
  type Creator,
  type Item,
  changeItemType,
  creatorTypeLabel,
  creatorTypesOf,
  fieldLabel,
  fieldsOf,
  isDateField,
  itemTypeLabel,
  itemTypes,
  newKey,
  noteText,
  now,
  parseDate,
  textToNoteHtml,
  titleOf,
} from "../../core/zotero.js";
import { addToBasket } from "./cite.js";
import { citedKeys, refresh } from "./document.js";
import { $, S, h, putItems, run, setMessage, showView } from "./core.js";

let current: Item | null = null;
let saveTimer = 0;
let docTimer = 0;

const LONG = new Set(["title", "abstractNote", "extra", "bookTitle", "publicationTitle", "encyclopediaTitle"]);
/** Hints for fields İSNAD users fill differently. */
const HINTS: Record<string, string> = {
  date: "Yıl, gün.ay.yıl veya hicrî/milâdî: 1413/1993",
  place: "Bilinmiyorsa y.y.",
  publisher: "Bilinmiyorsa y.y.y.",
  pages: "45-78",
  volume: "Yalnız numara",
  edition: "Yalnız sayı (2)",
  archive: "Yazma: kütüphane (ör. Süleymaniye Ktp.)",
  archiveLocation: "Yazma: koleksiyon ve no (ör. Fatih, 1234)",
  accessDate: "Web: erişim tarihi",
  extra: "Zotero'daki Ekstra alanı; \"original-date: 1323\" gibi CSL satırları okunur",
};

export function openEditor(key: string, focusTitle = false): void {
  const item = S.byKey.get(key);
  if (!item) return;
  current = item;
  showView("kaynak");
  render();
  if (focusTitle) ($("ed-fields").querySelector("textarea,input") as HTMLElement | null)?.focus();
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 350);
}

async function save(): Promise<void> {
  if (!current) return;
  window.clearTimeout(saveTimer);
  current = { ...current, dateModified: now() };
  await putItems([current]);
  renderIssues();
  renderMeta();
  // Cited in this document: citations and bibliography follow the edit.
  if (citedKeys().has(current.key)) {
    window.clearTimeout(docTimer);
    docTimer = window.setTimeout(() => void run("Belgedeki atıflar güncelleniyor", () => refresh(false, true)), 600);
  }
}

function update(fn: (item: Item) => Item, rerender = false): void {
  if (!current) return;
  current = fn(current);
  scheduleSave();
  if (rerender) render();
  else renderIssues();
}

function render(): void {
  if (!current) return;
  const item = current;
  $("ed-deleted").hidden = !item.deleted;
  $("ed-trash").hidden = Boolean(item.deleted);
  $("ed-restore").hidden = !item.deleted;
  const typeSel = $<HTMLSelectElement>("ed-type");
  typeSel.replaceChildren(...itemTypes().map((t) => [t, itemTypeLabel(t)] as const).sort((a, b) => a[1].localeCompare(b[1], "tr")).map(([t, l]) => h("option", { value: t, selected: t === item.itemType }, l)));
  typeSel.onchange = () => update((i) => changeItemType(i, typeSel.value), true);
  renderFields();
  renderTags();
  renderNotes();
  renderRelated();
  renderCollections();
  renderIssues();
  renderMeta();
}

function fieldInput(field: string): HTMLElement {
  const item = current!;
  const value = item.fields[field] ?? "";
  const onInput = (el: HTMLInputElement | HTMLTextAreaElement) => () => {
    const v = el.value;
    update((i) => {
      const fields = { ...i.fields };
      if (v.trim()) fields[field] = v;
      else delete fields[field];
      return { ...i, fields };
    });
    if (isDateField(item.itemType, field)) dateHint.textContent = describeDate(v);
  };
  const dateHint = h("small", { class: "muted" }, isDateField(item.itemType, field) ? describeDate(value) : "");
  let el: HTMLInputElement | HTMLTextAreaElement;
  if (LONG.has(field)) {
    el = h("textarea", { rows: field === "abstractNote" || field === "extra" ? 3 : 2, "data-field": field });
    el.value = value;
  } else {
    el = h("input", { value, "data-field": field, placeholder: HINTS[field] ?? "" });
  }
  el.oninput = onInput(el);
  return h("label", { class: "field" }, fieldLabel(field), el, field === "extra" || field === "abstractNote" ? h("small", { class: "muted" }, HINTS[field] ?? "") : null, dateHint.textContent ? dateHint : isDateField(item.itemType, field) ? dateHint : null);
}

function describeDate(v: string): string {
  const d = parseDate(v);
  if (!v.trim()) return "";
  if (!d) return "ts.";
  const p = d["date-parts"]?.[0];
  if (p) return ["y", "a", "g"].slice(0, p.length).map((k, i) => `${k}: ${p[i]}`).join("  ");
  return /^\d{3,4}\/\d{3,4}$/.test(v.trim()) ? "hicrî / milâdî" : "olduğu gibi yazılır";
}

function renderFields(): void {
  const item = current!;
  const box = $("ed-fields");
  box.replaceChildren();
  const fields = fieldsOf(item.itemType);
  box.append(fieldInput("title"));
  box.append(renderCreators());
  for (const f of fields) if (f !== "title" && f !== "extra" && f !== "abstractNote") box.append(fieldInput(f));
  // Values from another type (kept after a type change) stay visible.
  for (const f of Object.keys(item.fields)) if (!fields.includes(f) && f !== "extra") box.append(fieldInput(f));
  if (fields.includes("abstractNote")) box.append(fieldInput("abstractNote"));
  box.append(fieldInput("extra"));
}

function renderCreators(): HTMLElement {
  const item = current!;
  const types = creatorTypesOf(item.itemType);
  const wrap = h("div", { class: "creators" }, h("div", { class: "field-label" }, "Kişiler"));
  item.creators.forEach((c, i) => {
    const set = (patch: Partial<Creator> | null, rerender = false) =>
      update((it) => {
        const creators = [...it.creators];
        if (patch === null) creators.splice(i, 1);
        else creators[i] = { ...creators[i]!, ...patch } as Creator;
        return { ...it, creators };
      }, rerender);
    const type = h("select", { "aria-label": "Rol", onchange: () => set({ creatorType: type.value }) }, ...[...new Set([...types, c.creatorType])].map((t) => h("option", { value: t, selected: t === c.creatorType }, creatorTypeLabel(t))));
    const single = c.name !== undefined;
    const last = h("input", { value: single ? c.name : (c.lastName ?? ""), placeholder: single ? "Tam ad / kurum" : "Soyad / şöhret", "aria-label": "Soyad" });
    last.oninput = () => set(single ? { name: last.value } : { lastName: last.value });
    const first = h("input", { value: c.firstName ?? "", placeholder: "Ad (ör. Ebû Hâmid Muhammed b. Muhammed)", "aria-label": "Ad" });
    first.oninput = () => set({ firstName: first.value });
    const toggle = h("button", {
      type: "button",
      class: "icon-btn",
      title: single ? "İki alana ayır" : "Tek alan (kurum, bölünmeyecek ad)",
      onclick: () =>
        set(single ? { name: undefined, lastName: c.name, firstName: "" } : { name: [c.firstName, c.lastName].filter(Boolean).join(" "), lastName: undefined, firstName: undefined }, true),
    }, single ? "⇆" : "⇥");
    const up = h("button", { type: "button", class: "icon-btn", title: "Yukarı", onclick: () => i > 0 && update((it) => { const cs = [...it.creators]; [cs[i - 1], cs[i]] = [cs[i]!, cs[i - 1]!]; return { ...it, creators: cs }; }, true) }, "↑");
    const del = h("button", { type: "button", class: "icon-btn", title: "Sil", onclick: () => set(null, true) }, "✕");
    wrap.append(h("div", { class: single ? "creator single" : "creator" }, type, last, single ? null : first, h("span", { class: "creator-btns" }, toggle, up, del)));
  });
  wrap.append(
    h("button", {
      type: "button",
      class: "link",
      onclick: () => update((it) => ({ ...it, creators: [...it.creators, { creatorType: it.creators.length ? (it.creators[it.creators.length - 1]!.creatorType) : types[0]!, lastName: "", firstName: "" }] }), true),
    }, "+ Kişi ekle"),
  );
  return wrap;
}

function renderTags(): void {
  const item = current!;
  $("ed-tags").replaceChildren(
    ...item.tags.map((t, i) => h("span", { class: `chip${t.type === 1 ? " auto" : ""}` }, t.tag, h("button", { type: "button", class: "chip-x", title: "Kaldır", onclick: () => update((it) => ({ ...it, tags: it.tags.filter((_, j) => j !== i) }), true) }, "×"))),
  );
  $("all-tags").replaceChildren(...tagCounts(S.items).map((t) => h("option", { value: t.tag })));
  const input = $<HTMLInputElement>("ed-tag");
  input.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const tag = input.value.trim();
    input.value = "";
    if (tag && !current!.tags.some((t) => t.tag === tag)) update((it) => ({ ...it, tags: [...it.tags, { tag }] }), true);
  };
}

function renderNotes(): void {
  const item = current!;
  $("ed-notes").replaceChildren(
    ...item.notes.map((n, i) => {
      const ta = h("textarea", { rows: 3 });
      ta.value = noteText(n.note);
      ta.oninput = () => update((it) => ({ ...it, notes: it.notes.map((x, j) => (j === i ? { ...x, note: textToNoteHtml(ta.value), dateModified: now() } : x)) }));
      return h("div", { class: "note" }, ta, h("button", { type: "button", class: "link danger-text", onclick: () => update((it) => ({ ...it, notes: it.notes.filter((_, j) => j !== i) }), true) }, "Notu sil"));
    }),
  );
}

function renderRelated(): void {
  const item = current!;
  $("ed-related").replaceChildren(
    ...item.relations.map((k) => {
      const r = S.byKey.get(k);
      return h("li", {}, h("button", { type: "button", class: "link", onclick: () => r && openEditor(r.key) }, r ? titleOf(r) || r.key : `${k} (yok)`), " ", h("button", { type: "button", class: "chip-x", title: "Kaldır", onclick: () => unrelate(k) }, "×"));
    }),
  );
  const q = $<HTMLInputElement>("ed-related-q");
  const hits = $("ed-related-hits");
  q.value = "";
  hits.replaceChildren();
  q.oninput = () => {
    hits.replaceChildren(
      ...(q.value.trim() ? S.index.search(q.value, 6) : [])
        .filter((x) => x.item.key !== item.key && !item.relations.includes(x.item.key))
        .map((x) => h("li", {}, h("button", { type: "button", class: "link", onclick: () => relate(x.item.key) }, `+ ${titleOf(x.item)}`))),
    );
  };
}

/** Relations are two-way, as in Zotero. */
function relate(key: string): void {
  const other = S.byKey.get(key);
  update((it) => ({ ...it, relations: [...it.relations, key] }), true);
  if (other && !other.relations.includes(current!.key)) void putItems([{ ...other, relations: [...other.relations, current!.key], dateModified: now() }]);
}

function unrelate(key: string): void {
  const other = S.byKey.get(key);
  update((it) => ({ ...it, relations: it.relations.filter((k) => k !== key) }), true);
  if (other) void putItems([{ ...other, relations: other.relations.filter((k) => k !== current!.key), dateModified: now() }]);
}

function renderCollections(): void {
  const item = current!;
  const tree = collectionTree(S.collections);
  $("ed-collections").replaceChildren(
    ...(tree.length
      ? tree.map(({ c, depth }) => {
          const cb = h("input", { type: "checkbox", checked: item.collections.includes(c.key) });
          cb.onchange = () => update((it) => ({ ...it, collections: cb.checked ? [...it.collections, c.key] : it.collections.filter((x) => x !== c.key) }));
          return h("label", { class: "inline", style: `padding-left:${depth * 14}px` }, cb, ` ${c.name}`);
        })
      : [h("p", { class: "muted" }, "Koleksiyon yok. Kütüphane → ⋯ → Yeni koleksiyon.")]),
  );
}

function renderIssues(): void {
  const item = current;
  const box = $("ed-issues");
  box.replaceChildren();
  if (!item) return;
  const issues = checkItem(item).filter((i) => i.level !== "info");
  if (!issues.length) return;
  box.append(
    h(
      "section",
      { class: "issues" },
      h("h2", {}, `İSNAD denetimi (${issues.length})`),
      ...issues.map((i) =>
        h(
          "div",
          { class: `issue ${i.level}` },
          h("span", { class: "lvl" }, LEVEL_LABEL[i.level]),
          ` ${i.message} `,
          i.fix ? h("button", { type: "button", class: "link", onclick: () => update((it) => applyFix(it, i.fix!), true) }, i.fixLabel ?? "Düzelt") : null,
        ),
      ),
    ),
  );
}

function renderMeta(): void {
  const item = current;
  if (!item) return;
  const d = (s: string) => new Date(s).toLocaleString("tr-TR");
  $("ed-meta").textContent = `Eklendi: ${d(item.dateAdded)} · Değişti: ${d(item.dateModified)} · Anahtar: ${item.key} · ${item.source}`;
}

export function wireEditor(): void {
  $("ed-back").onclick = () => {
    void save();
    showView("kutuphane");
  };
  $("ed-cite").onclick = () => {
    if (!current) return;
    void save();
    addToBasket(current);
    showView("atif");
  };
  $("ed-duplicate").onclick = () =>
    void run("Çoğaltılıyor", async () => {
      if (!current) return;
      const copy: Item = { ...JSON.parse(JSON.stringify(current)), key: newKey(), dateAdded: now(), dateModified: now(), source: "manual", relations: [] };
      await putItems([copy]);
      openEditor(copy.key);
      setMessage("Kaynak çoğaltıldı; şimdi kopyayı düzenliyorsunuz.", "success");
    });
  $("ed-trash").onclick = () =>
    void run("Çöpe atılıyor", async () => {
      if (!current) return;
      await putItems([{ ...current, deleted: true, dateModified: now() }]);
      setMessage("Kaynak çöp kutusuna taşındı.", "success");
      showView("kutuphane");
    });
  $("ed-restore").onclick = () =>
    void run("Geri yükleniyor", async () => {
      if (!current) return;
      const { deleted: _d, ...rest } = current;
      current = { ...rest, dateModified: now() };
      await putItems([current]);
      render();
    });
}


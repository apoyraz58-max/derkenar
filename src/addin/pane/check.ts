/**
 * Denetim: İSNAD yazım denetimi over the cited works, the whole library, a
 * collection or the ticked items. Fixes go to the library record (and to the
 * document's copy), then the document refreshes.
 */
import { type Issue, LEVEL_LABEL, applyFix, apostropheReport, checkItem, AUTO } from "../../core/isnad.js";
import { nameVariants, unifyName } from "../../core/names.js";
import { type Item, creatorLine, now, titleOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { citedKeys, refresh } from "./document.js";
import { $, S, doc, h, putItems, run, setMessage } from "./core.js";
import { openEditor } from "./editor.js";
import { inCurrentView } from "./library.js";

/** Fixes applied by "Önerilen düzeltmeleri uygula"; case changes stay manual. */
/** "Önerilen düzeltmeleri uygula": the mechanical fixes also made when a work is added, and a few more. */
const SAFE = new Set([...AUTO, "volume", "issue", "url"]);

let lastItems: Item[] = [];
let lastIssues: Issue[] = [];

function scopeItems(): Item[] {
  const scope = $<HTMLSelectElement>("chk-scope").value;
  if (scope === "document") return [...citedKeys()].map((k) => S.byKey.get(k) ?? doc().items[k]).filter((x): x is Item => Boolean(x));
  if (scope === "collection") return S.items.filter(inCurrentView);
  if (scope === "selected") return [...S.selected].map((k) => S.byKey.get(k)).filter((x): x is Item => Boolean(x));
  return S.items.filter((i) => !i.deleted);
}

export function runCheck(): void {
  lastItems = scopeItems();
  const withInfo = $<HTMLInputElement>("chk-info").checked;
  lastIssues = lastItems.flatMap((i) => checkItem(i)).filter((i) => withInfo || i.level !== "info");
  render();
}

function render(): void {
  const byItem = new Map<string, Issue[]>();
  for (const i of lastIssues) byItem.set(i.key, [...(byItem.get(i.key) ?? []), i]);
  const errors = lastIssues.filter((i) => i.level === "error").length;
  const warnings = lastIssues.filter((i) => i.level === "warning").length;
  const safe = lastIssues.filter((i) => i.fix && SAFE.has(i.code));
  const marks = apostropheReport(lastItems);
  $("chk-summary").textContent = `${lastItems.length} kaynak denetlendi: ${errors} hata, ${warnings} uyarı.` + (marks.length > 1 ? ` Başlıklarda farklı kesme/ayın işaretleri kullanılmış: ${marks.map((m) => `${m.mark} (${m.count})`).join(", ")}.` : "");
  $("chk-fixall").hidden = safe.length === 0;
  $("chk-fixall").textContent = `Önerilen düzeltmeleri uygula (${safe.length})`;
  const list = $("chk-list");
  list.replaceChildren();
  for (const [key, issues] of byItem) {
    const item = lastItems.find((i) => i.key === key)!;
    list.append(
      h(
        "li",
        {},
        h("button", { type: "button", class: "link r-title", onclick: () => S.byKey.has(key) && openEditor(key) }, `${creatorLine(item) || "—"}, ${titleOf(item) || "(başlıksız)"}`),
        ...issues.map((i) =>
          h(
            "div",
            { class: `issue ${i.level}` },
            h("span", { class: "lvl" }, LEVEL_LABEL[i.level]),
            ` ${i.message} `,
            i.fix ? h("button", { type: "button", class: "link", onclick: () => void run("Düzeltiliyor", () => fix([i])) }, i.fixLabel ?? "Düzelt") : null,
          ),
        ),
      ),
    );
  }
  // The same author written in more than one way: a.mlf. and the bibliography need one spelling.
  for (const v of nameVariants(lastItems)) {
    const choice = h("select", { "aria-label": "Kullanılacak yazım" }, ...v.spellings.map((sp, i) => h("option", { value: String(i) }, `${sp.label} (${sp.count})`)));
    list.prepend(
      h(
        "li",
        {},
        h("div", { class: "issue warning" }, h("span", { class: "lvl" }, "Uyarı"), ` Aynı müellif farklı yazılmış: ${v.spellings.map((x) => x.label).join(" · ")}`),
        h(
          "div",
          { class: "row small" },
          choice,
          h("button", {
            type: "button",
            onclick: () =>
              void run("Yazımlar birleştiriliyor", async () => {
                const target = v.spellings[Number(choice.value)]!.creator;
                const changed = unifyName(S.items, target, v.spellings.map((x) => x.creator)).map((i) => ({ ...i, dateModified: now() }));
                await putItems(changed, [], true);
                const d = doc();
                for (const it of changed) if (d.items[it.key]) d.items[it.key] = it;
                await word.saveState(d);
                await refresh(false, true);
                setMessage(`${changed.length} kaynakta müellif adı "${v.spellings[Number(choice.value)]!.label}" olarak birleştirildi.`, "success");
                runCheck();
              }),
          }, "Hepsini bu yazıma çevir"),
        ),
      ),
    );
  }
  if (!byItem.size && !list.children.length) list.append(h("li", { class: "muted" }, lastItems.length ? "İSNAD açısından sorun bulunmadı." : "Denetlenecek kaynak yok."));
}

async function fix(issues: Issue[]): Promise<void> {
  const changed = new Map<string, Item>();
  for (const i of issues) {
    if (!i.fix) continue;
    const base = changed.get(i.key) ?? S.byKey.get(i.key) ?? doc().items[i.key];
    if (base) changed.set(i.key, applyFix(base, i.fix));
  }
  const lib: Item[] = [];
  const d = doc();
  for (const [key, item] of changed) {
    const next = { ...item, dateModified: now() };
    if (S.byKey.has(key)) lib.push(next);
    if (d.items[key]) d.items[key] = next;
  }
  if (lib.length) await putItems(lib, [], true);
  if ([...changed.keys()].some((k) => d.items[k])) {
    await word.saveState(d);
    await refresh(false, true);
  }
  setMessage(`${issues.length} düzeltme uygulandı.`, "success");
  runCheck();
}

export function wireCheck(): void {
  $("chk-run").onclick = runCheck;
  $<HTMLInputElement>("chk-info").onchange = runCheck;
  $("chk-fixall").onclick = () => void run("Düzeltiliyor", () => fix(lastIssues.filter((i) => i.fix && SAFE.has(i.code))));
}

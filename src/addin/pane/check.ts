/**
 * Denetim: İSNAD yazım denetimi over the cited works, the whole library, a
 * collection or the ticked items. Fixes go to the library record (and to the
 * document's copy), then the document refreshes.
 */
import { type Issue, LEVEL_LABEL, applyFix, apostropheReport, checkItem, AUTO } from "../../core/isnad.js";
import { nameVariants, unifyName } from "../../core/names.js";
import { type Item, creatorLine, now, titleOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { ageCount, checkCitations } from "../../core/citecheck.js";
import { keepEdited, revertEdited } from "../../core/docstate.js";
import { citedKeys, currentOrder, refresh } from "./document.js";
import { $, S, doc, h, putItems, run, setMessage } from "./core.js";
import { openEditor } from "./editor.js";
import { inCurrentView } from "./library.js";
import { personIssues } from "./persons.js";
import { fieldVariants, unifyField } from "../../core/library.js";

/** Fixes applied by "Önerilen düzeltmeleri uygula"; case changes stay manual. */
/** "Önerilen düzeltmeleri uygula": the mechanical fixes also made when a work is added, and a few more. */
const SAFE = new Set([...AUTO, "volume", "issue", "url", "dia-name"]);

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
  lastIssues = lastItems.flatMap((i) => [...checkItem(i), ...personIssues(i)]).filter((i) => withInfo || i.level !== "info");
  render();
  if ($<HTMLSelectElement>("chk-scope").value === "document") void checkAge();
}

/** "a.g.e." typed by hand in the document (old footnotes): İSNAD writes a short reference. */
async function checkAge(): Promise<void> {
  const text = await word.documentText().catch(() => "");
  const d = doc();
  const inOwn = Object.entries(d.citations).reduce((n, [id, c]) => n + ageCount(c.override ?? d.edited?.[id] ?? ""), 0);
  const n = ageCount(text) - inOwn;
  if (n <= 0) return;
  $("chk-list").prepend(
    h(
      "li",
      {},
      h("div", { class: "issue warning" }, h("span", { class: "lvl" }, "Uyarı"), ` Belgede elle yazılmış ${n} "a.g.e. / a.e. / a.g.m. / Ibid." var. İSNAD bu kısaltmaları kullanmaz; aynı esere yeniden atıfta kısa künye yazılır (ör. "Kara, Tasavvuf ve Tarikatlar, 47."). `),
      h("button", { type: "button", class: "link", onclick: () => { $("tab-belge").click(); $("hand-scan").scrollIntoView({ block: "center" }); $("hand-scan").focus(); } }, "Dipnotları tara ile kısa künyeye çevir"),
    ),
  );
  $("chk-summary").textContent += ` Elle yazılmış ${n} a.g.e.`;
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
  const reviewKeys = [...byItem.keys()].filter((k) => S.byKey.has(k) && byItem.get(k)!.some((i) => i.level !== "info"));
  $("chk-review").hidden = reviewKeys.length === 0;
  $("chk-review").textContent = `Sırayla düzelt (${reviewKeys.length} kayıt)`;
  $("chk-review").onclick = () => {
    // Errors first, then warnings.
    const rank = (k: string) => (byItem.get(k)!.some((i) => i.level === "error") ? 0 : 1);
    S.review = { keys: [...reviewKeys].sort((a, b) => rank(a) - rank(b)), at: 0 };
    openEditor(S.review.keys[0]!);
  };
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
  // One publisher, place, journal written in more than one way: the bibliography should write it one way.
  for (const v of fieldVariants(lastItems)) {
    const choice = h("select", { "aria-label": "Kullanılacak yazım" }, ...v.spellings.map((sp, i) => h("option", { value: String(i) }, `${sp.value} (${sp.count})`)));
    list.prepend(
      h(
        "li",
        {},
        h("div", { class: "issue warning" }, h("span", { class: "lvl" }, "Uyarı"), ` ${v.what} farklı yazılmış: ${v.spellings.map((x) => x.value).join(" · ")}`),
        h(
          "div",
          { class: "row small" },
          choice,
          h("button", {
            type: "button",
            onclick: () =>
              void run("Yazımlar birleştiriliyor", async () => {
                const target = v.spellings[Number(choice.value)]!.value;
                const changed = unifyField(S.items, v, target).map((i) => ({ ...i, dateModified: now() }));
                await putItems(changed, [], true);
                const d = doc();
                for (const it of changed) if (d.items[it.key]) d.items[it.key] = it;
                await word.saveState(d);
                await refresh(false, true);
                setMessage(`${changed.length} kaynakta ${v.what.toLocaleLowerCase("tr")} "${target}" olarak birleştirildi.`, "success");
                runCheck();
              }),
          }, "Hepsini bu yazıma çevir"),
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
  // The citations themselves (this document only): pages missing, a work twice, text edited by hand.
  if ($<HTMLSelectElement>("chk-scope").value === "document") {
    const withInfo = $<HTMLInputElement>("chk-info").checked;
    const cites = checkCitations(currentOrder(), doc()).filter((c) => withInfo || c.level !== "info");
    if (cites.length) {
      list.prepend(
        h(
          "li",
          {},
          h("span", { class: "r-title" }, `Atıflar (${cites.length})`),
          ...cites.map((c) =>
            h(
              "div",
              { class: `issue ${c.level}` },
              h("span", { class: "lvl" }, c.level === "warning" ? "Uyarı" : "Bilgi"),
              ` ${c.noteIndex ? `dn. ${c.noteIndex}` : `${c.position}. atıf`}: ${c.message} `,
              h("button", { type: "button", class: "link", onclick: () => void run("Atıf seçiliyor", () => word.selectCitation(c.citationId)) }, "Atıfa git"),
              ...(c.code === "edited-in-word"
                ? [
                    " · ",
                    h("button", { type: "button", class: "link", onclick: () => void run("Kaydediliyor", () => editedChoice(c.citationId, true)) }, "Elle yazılanı koru"),
                    " · ",
                    h("button", { type: "button", class: "link", onclick: () => void run("Yenileniyor", () => editedChoice(c.citationId, false)) }, "Derkenar'ın metnine dön"),
                  ]
                : c.code === "hand-edited"
                  ? [" · ", h("button", { type: "button", class: "link", onclick: () => void run("Yenileniyor", () => editedChoice(c.citationId, false)) }, "Derkenar'ın metnine dön")]
                  : []),
            ),
          ),
        ),
      );
      $("chk-summary").textContent += ` Atıflarda ${cites.filter((c) => c.level === "warning").length} uyarı.`;
    }
  }
  if (!byItem.size && !list.children.length) list.append(h("li", { class: "muted" }, lastItems.length ? "İSNAD açısından sorun bulunmadı." : "Denetlenecek kaynak yok."));
}

/** A citation changed by hand in Word: keep that text, or let Derkenar write its own again. */
async function editedChoice(id: string, keep: boolean): Promise<void> {
  const d = doc();
  if (keep) keepEdited(d, id);
  else revertEdited(d, id);
  await word.saveState(d);
  await refresh(false, true);
  setMessage(keep ? "Elle yazılan metin korunacak; bu atıf artık güncellenmez." : "Atıf Derkenar'ın metnine döndü; bundan sonra kendiliğinden güncellenir.", "success");
  runCheck();
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

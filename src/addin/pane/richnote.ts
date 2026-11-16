/**
 * A small rich-text note editor (Zotero notes are HTML): bold, italic,
 * underline, heading, lists, quote, link. Saved HTML is cleaned to the tags
 * Zotero's note editor itself writes.
 */
import { h } from "./core.js";

const ALLOWED = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "SUP", "SUB", "H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "A", "SPAN", "DIV", "PRE", "CODE"]);

/** Keeps only safe formatting (no scripts, styles or event handlers). */
export function cleanNoteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (el: Element): void => {
    for (const child of [...el.children]) {
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(...[...child.childNodes]);
        continue;
      }
      for (const a of [...child.attributes]) if (!(child.tagName === "A" && a.name === "href" && /^(https?:|mailto:|zotero:)/i.test(a.value))) child.removeAttribute(a.name);
      walk(child);
    }
  };
  const root = doc.body.firstElementChild!;
  walk(root);
  // Repeat once: unwrapping can expose nested disallowed tags.
  walk(root);
  return root.innerHTML.replace(/<div>/g, "<p>").replace(/<\/div>/g, "</p>").trim();
}

export function richNote(html: string, onChange: (html: string) => void): HTMLElement {
  const area = h("div", { class: "rich", contenteditable: "true", spellcheck: "true" });
  area.innerHTML = cleanNoteHtml(html);
  let timer = 0;
  area.oninput = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onChange(cleanNoteHtml(area.innerHTML)), 300);
  };
  const cmd = (name: string, value?: string) => () => {
    area.focus();
    document.execCommand(name, false, value);
    area.dispatchEvent(new Event("input"));
  };
  const btn = (label: string, title: string, fn: () => void, cls = "") => h("button", { type: "button", class: `icon-btn ${cls}`, title, onmousedown: (e: Event) => e.preventDefault(), onclick: fn }, label);
  const bar = h(
    "div",
    { class: "rich-bar" },
    btn("K", "Kalın", cmd("bold"), "b"),
    btn("İ", "İtalik", cmd("italic"), "i"),
    btn("A", "Altı çizili", cmd("underline"), "u"),
    btn("B", "Başlık", cmd("formatBlock", "<h2>")),
    btn("¶", "Paragraf", cmd("formatBlock", "<p>")),
    btn("•", "Madde işaretli liste", cmd("insertUnorderedList")),
    btn("1.", "Numaralı liste", cmd("insertOrderedList")),
    btn("❝", "Alıntı", cmd("formatBlock", "<blockquote>")),
    btn("🔗", "Bağlantı", () => {
      const url = window.getSelection()?.toString().match(/^https?:\/\/\S+$/) ? window.getSelection()!.toString() : "";
      if (url) cmd("createLink", url)();
      else cmd("createLink", "https://")();
    }),
    btn("⌫", "Biçimi temizle", cmd("removeFormat")),
  );
  return h("div", { class: "rich-wrap" }, bar, area);
}

/**
 * Transkripsiyon klavyesi: the İSNAD / DİA transcription letters (guide s. 59)
 * one click away, written where the cursor is (editor fields, search, the
 * citation boxes, notes).
 */
import { $, h } from "./core.js";

/** İSNAD çeviri yazı alfabesi (Türkçe and English columns, guide s. 59). */
export const TRANSLIT = ["ʾ", "ʿ", "â", "î", "û", "ā", "ī", "ū", "ḥ", "ḫ", "ṣ", "ḍ", "ż", "ṭ", "ẓ", "ġ", "ḳ", "s̱", "ẕ", "ñ", "’"];

let target: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;
let upper = false;

function writable(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return ["text", "search", ""].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

function insertChar(ch: string): void {
  const el = target;
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(ch, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    document.execCommand("insertText", false, ch);
  }
}

function render(): void {
  const keys = TRANSLIT.map((c) => (upper && c.toLocaleUpperCase("tr") !== c ? c.toLocaleUpperCase("tr") : c));
  $("translit-keys").replaceChildren(
    h("button", { type: "button", class: `tk shift${upper ? " on" : ""}`, title: "Büyük harf", onmousedown: (e: Event) => e.preventDefault(), onclick: () => ((upper = !upper), render()) }, "⇧"),
    ...keys.map((c) => h("button", { type: "button", class: "tk", title: c, onmousedown: (e: Event) => e.preventDefault(), onclick: () => insertChar(c) }, c)),
  );
}

export function wireTranslit(): void {
  document.addEventListener("focusin", (e) => {
    if (writable(e.target) && !(e.target as HTMLElement).closest("#translit")) target = e.target;
  });
  const bar = $("translit");
  const toggle = $<HTMLButtonElement>("translit-toggle");
  let open = false;
  try {
    open = localStorage.getItem("derkenar.translit") === "1";
  } catch {
    /* private mode */
  }
  const apply = () => {
    bar.hidden = !open;
    toggle.setAttribute("aria-pressed", String(open));
    document.body.classList.toggle("with-translit", open);
  };
  toggle.onclick = () => {
    open = !open;
    try {
      localStorage.setItem("derkenar.translit", open ? "1" : "0");
    } catch {
      /* private mode */
    }
    apply();
    target?.focus();
  };
  render();
  apply();
}

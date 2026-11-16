/**
 * citeproc-js "html" output → formatted runs Word can write directly
 * (insertText + font flags). No DOM needed, so it also runs in tests.
 */
import type { Segment } from "./types.js";

type Flags = Omit<Segment, "text">;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function flagsFor(tag: string, attrs: string): Flags {
  switch (tag) {
    case "i":
    case "em":
      return { italic: true };
    case "b":
    case "strong":
      return { bold: true };
    case "sup":
      return { superscript: true };
    case "sub":
      return { subscript: true };
    case "u":
      return { underline: true };
  }
  const style = /style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.replace(/\s+/g, "").toLowerCase() ?? "";
  const f: Flags = {};
  if (style.includes("font-style:italic")) f.italic = true;
  if (style.includes("font-style:normal")) f.italic = false;
  if (style.includes("font-weight:bold")) f.bold = true;
  if (style.includes("font-weight:normal")) f.bold = false;
  if (style.includes("font-variant:small-caps")) f.smallCaps = true;
  if (style.includes("font-variant:normal")) f.smallCaps = false;
  if (style.includes("text-decoration:underline")) f.underline = true;
  if (style.includes("vertical-align:sup")) f.superscript = true;
  if (style.includes("vertical-align:sub")) f.subscript = true;
  return f;
}

const BLOCK = new Set(["div", "p", "br"]);

/** Parses one citation or bibliography entry. Blocks become spaces (second-field-align columns). */
export function htmlToSegments(html: string): Segment[] {
  const out: Segment[] = [];
  const stack: { tag: string; flags: Flags }[] = [];
  const current = (): Flags => Object.assign({}, ...stack.map((s) => s.flags)) as Flags;
  const push = (raw: string): void => {
    const text = decodeEntities(raw);
    if (!text) return;
    const flags = current();
    const last = out[out.length - 1];
    if (last && sameFlags(last, flags)) last.text += text;
    else out.push({ text, ...clean(flags) });
  };
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  let blocks = 0;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      push(m[4].replace(/\s*\n\s*/g, " "));
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? "";
    if (BLOCK.has(tag)) {
      if (!closing && blocks++ > 0) push(" ");
      if (closing && tag !== "br") continue;
      if (tag === "br") push(" ");
      if (tag !== "br" && !closing) stack.push({ tag, flags: flagsFor(tag, attrs) });
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.splice(i, 1);
          break;
        }
      }
    } else if (!attrs.trim().endsWith("/")) {
      stack.push({ tag, flags: flagsFor(tag, attrs) });
    }
  }
  return trimSegments(out);
}

function clean(flags: Flags): Flags {
  const f: Flags = {};
  for (const [k, v] of Object.entries(flags)) if (v) (f as Record<string, boolean>)[k] = true;
  return f;
}

function sameFlags(a: Segment, b: Flags): boolean {
  const keys = ["italic", "bold", "smallCaps", "superscript", "subscript", "underline"] as const;
  return keys.every((k) => Boolean(a[k]) === Boolean(b[k]));
}

function trimSegments(segments: Segment[]): Segment[] {
  const s = segments.map((x) => ({ ...x }));
  if (s[0]) s[0].text = s[0].text.replace(/^\s+/, "");
  const last = s[s.length - 1];
  if (last) last.text = last.text.replace(/\s+$/, "");
  return s.filter((x) => x.text.length > 0);
}

export function segmentsText(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join("");
}

export function htmlToText(html: string): string {
  return segmentsText(htmlToSegments(html));
}

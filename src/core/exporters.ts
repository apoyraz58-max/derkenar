/**
 * Getting works out: a lossless Künye backup, CSL JSON (Zotero imports it),
 * RIS and BibTeX. Roles Zotero has no field for travel in Extra / note lines
 * ("editorial-director: Nâşir || Ali"), the convention Zotero itself reads.
 */
import type { CslItem } from "./types.js";
import { type Collection, type Item, ISNAD_ROLES, extraLine, toCsl } from "./zotero.js";

export interface Backup {
  derkenar: 1;
  exported: string;
  items: Item[];
  collections: Collection[];
}

export function backup(items: readonly Item[], collections: readonly Collection[]): string {
  const b: Backup = { derkenar: 1, exported: new Date().toISOString(), items: [...items], collections: [...collections] };
  return JSON.stringify(b, null, 1);
}

export function isBackup(text: string): boolean {
  return /^\s*\{\s*"derkenar"\s*:\s*1/.test(text);
}

export function parseBackup(text: string): Backup {
  const b = JSON.parse(text) as Backup;
  if (b.derkenar !== 1 || !Array.isArray(b.items)) throw new Error("Künye yedeği okunamadı.");
  return b;
}

/** CSL JSON for Zotero: İSNAD roles also as note lines, so Zotero keeps them in Extra. */
export function toCslForExport(item: Item): CslItem {
  const csl = toCsl(item);
  const lines = item.creators.filter((c) => ISNAD_ROLES[c.creatorType] && c.creatorType !== "muhakkik").map(extraLine);
  if (lines.length) csl.note = [...lines, csl.note].filter(Boolean).join("\n");
  return csl;
}

export function cslJson(items: readonly Item[]): string {
  return JSON.stringify(items.map(toCslForExport), null, 2);
}

/** RIS / BibTeX through citation-js (loaded on demand). */
export async function formatAs(items: readonly Item[], format: "ris" | "bibtex" | "biblatex"): Promise<string> {
  const { Cite } = await import("@citation-js/core");
  await import("@citation-js/plugin-bibtex");
  await import("@citation-js/plugin-ris");
  const cite = await Cite.async(items.map(toCslForExport));
  return (cite as unknown as { format: (f: string, o?: Record<string, unknown>) => string }).format(format, { format: "text" });
}

/**
 * İSNAD citation systems that are not "cilt/sayfa": hadith collections cited
 * by kitâb and bâb or hadith number, dictionaries cited by madde.
 */
import { fold } from "./search.js";
import type { CiteRef } from "./types.js";
import type { Item } from "./zotero.js";

export type CiteMode = "normal" | "hadis-bab" | "hadis-no" | "hadis-cilt" | "sozluk";

export const CITE_MODES: readonly (readonly [CiteMode, string])[] = [
  ["normal", "Cilt/sayfa (olağan)"],
  ["hadis-bab", "Hadis: “Kitâb”, Bâb no (Buhârî, Ebû Dâvûd, İbn Mâce, Tirmizî, Nesâî, Dârimî)"],
  ["hadis-no", "Hadis: “Kitâb”, Hadis no (Müslim, Muvatta)"],
  ["hadis-cilt", "Hadis: Cilt/sayfa (Müsned ve diğerleri)"],
  ["sozluk", "Sözlük: “Madde”, cilt/sayfa"],
];

const BAB = ["buhari", "ebu davud", "ebu davud", "ibn mace", "ibni mace", "tirmizi", "nesai", "darimi"];
const NO = ["muslim", "imam malik", "malik"];
const CILT = ["ahmed b. hanbel", "ahmed b hanbel", "ibn hanbel"];

/** The item's citation system: as set in the editor, else recognised from the author and type. */
export function citeMode(item: Item | undefined): CiteMode {
  if (!item) return "normal";
  if (item.citeMode) return item.citeMode as CiteMode;
  if (item.itemType === "dictionaryEntry" && !item.fields.title?.trim()) return "sozluk";
  if (item.itemType !== "book") return "normal";
  const author = fold(item.creators.find((c) => c.creatorType === "author")?.lastName ?? item.creators.find((c) => c.creatorType === "author")?.name ?? "").replace(/-/g, " ");
  const title = fold(item.fields.title ?? "");
  if (BAB.some((a) => author === a || author.endsWith(` ${a}`))) return "hadis-bab";
  if (NO.some((a) => author === a) || title.includes("muvatta")) return "hadis-no";
  if (CILT.some((a) => author === a) && title.includes("musned")) return "hadis-cilt";
  return "normal";
}

/**
 * The locator İSNAD prints, from the parts typed in the citation pane.
 * Hadith kitâb/bâb uses CSL's "book" label: the İSNAD style then drops the
 * work's title in later notes ("Buhârî, “Menâḳıb”, 24").
 */
export function composeLocator(r: CiteRef): { locator?: string; label?: string } | null {
  const vp = (vol?: string, page?: string) => (vol && page ? `${vol}/${page}` : (page ?? vol ?? ""));
  if (r.kitab?.trim()) {
    const n = r.bab?.trim();
    const tail = r.hadisNo?.trim() ? ` (No. ${r.hadisNo.trim()})` : r.paren?.trim() ? ` (${r.paren.trim()})` : "";
    return { locator: `“${r.kitab.trim()}”${n ? `, ${n}` : ""}${tail}`, label: "book" };
  }
  if (r.madde?.trim()) {
    const where = vp(r.volume?.trim(), r.locator?.trim());
    return { locator: `“${r.madde.trim()}”${where ? `, ${where}` : ""}`, label: "page" };
  }
  if (r.hadisNo?.trim()) {
    const where = vp(r.volume?.trim(), r.locator?.trim());
    return { locator: `${where}${where ? " " : ""}(No. ${r.hadisNo.trim()})`, label: "page" };
  }
  return null;
}

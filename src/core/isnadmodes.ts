/**
 * İSNAD citation systems that are not "cilt/sayfa": hadith collections cited
 * by kitâb and bâb or hadith number, dictionaries cited by madde.
 */
import { BIBLE_BOOKS, SURES, SURES_EN } from "./scripture.js";
import { fold } from "./search.js";
import type { CiteRef } from "./types.js";
import type { Item } from "./zotero.js";

export type CiteMode = "normal" | "hadis-bab" | "hadis-no" | "hadis-cilt" | "sozluk" | "kuran" | "incil";

export const CITE_MODES: readonly (readonly [CiteMode, string])[] = [
  ["normal", "Cilt/sayfa (olağan)"],
  ["hadis-bab", "Hadis: “Kitâb”, Bâb no (Buhârî, Ebû Dâvûd, İbn Mâce, Tirmizî, Nesâî, Dârimî)"],
  ["hadis-no", "Hadis: “Kitâb”, Hadis no (Müslim, Muvatta)"],
  ["hadis-cilt", "Hadis: Cilt/sayfa (Müsned ve diğerleri)"],
  ["sozluk", "Sözlük: “Madde”, cilt/sayfa"],
  ["kuran", "Kur’ân meâli: Sûre no/Âyet (el-Enfâl 8/2)"],
  ["incil", "Kitâb-ı Mukaddes: Kitap kısaltması Bab:Cümle (Yar.1:12)"],
];

const BAB = ["buhari", "ebu davud", "ebu davud", "ibn mace", "ibni mace", "tirmizi", "nesai", "darimi"];
const NO = ["muslim", "imam malik", "malik"];
const CILT = ["ahmed b. hanbel", "ahmed b hanbel", "ibn hanbel"];

/** The item's citation system: as set in the editor, else recognised from the author and type. */
export function citeMode(item: Item | undefined): CiteMode {
  if (!item) return "normal";
  if (item.citeMode) return item.citeMode as CiteMode;
  if (item.itemType === "dictionaryEntry" && !item.fields.title?.trim()) return "sozluk";
  const t = fold(`${item.fields.title ?? ""} ${item.fields.shortTitle ?? ""}`);
  if (/\bkur ?[' ]?an\b|\bkuran\b|\bmeal|\bqur/.test(t)) return "kuran";
  if (/mukaddes|kutsal kitap|\bbible\b|\bincil\b|\btevrat\b/.test(t)) return "incil";
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
export function composeLocator(r: CiteRef, lang = "tr-TR"): { locator?: string; label?: string } | null {
  // Kur’ân and the Bible: CSL "verse" — the İSNAD style then prints only the place in later notes ("el-Enfâl 8/6.").
  if (r.sure) {
    const s = SURES.find(([n]) => String(n) === r.sure);
    const ayet = r.ayet?.trim();
    // A work written in English uses the English names of the same İSNAD table ("al-Baqara 2/4").
    const name = s ? (/^en/.test(lang) ? SURES_EN[s[0]] ?? s[2] : s[2]) : r.sure;
    return { locator: `${name} ${s ? s[0] : ""}${ayet ? `/${ayet}` : ""}`.replace(/\s+/g, " ").replace(" /", "/").trim(), label: "verse" };
  }
  if (r.kitap?.trim()) {
    const bab = r.bab?.trim();
    const cumle = r.cumle?.trim();
    // English works: the English abbreviation of the same table ("Gen.1:12" for "Yar.1:12").
    const book = BIBLE_BOOKS.find((b) => b[1] === r.kitap!.trim());
    const abbr = book && /^en/.test(lang) ? book[3] : r.kitap.trim();
    return { locator: `${abbr}${bab ?? ""}${cumle ? `:${cumle}` : ""}`, label: "verse" };
  }
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

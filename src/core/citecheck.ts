/**
 * Denetim of the citations themselves (not of the records): what İSNAD asks
 * of a footnote that the record cannot answer.
 */
import type { CiteRef, DocState } from "./types.js";
import { creatorLine, titleOf } from "./zotero.js";

export interface CitationIssue {
  readonly citationId: string;
  /** Footnote number, 0 in the text. */
  readonly noteIndex: number;
  /** Position in the document (1 …), for in-text citations. */
  readonly position: number;
  readonly level: "warning" | "info";
  readonly code: "no-place" | "repeated" | "hand-edited" | "edited-in-word" | "age";
  readonly message: string;
}

/** Works whose citations point at a place: a page, a varak, a madde, a hadith … */
const NEEDS_PLACE = new Set(["book", "bookSection", "journalArticle", "magazineArticle", "thesis", "manuscript", "conferencePaper", "report", "dictionaryEntry"]);

export function hasPlace(r: CiteRef): boolean {
  return Boolean(r.locator?.trim() || r.volume?.trim() || r.madde?.trim() || r.kitab?.trim() || r.bab?.trim() || r.hadisNo?.trim() || r.sure?.trim() || r.ayet?.trim() || r.kitap?.trim());
}

/** "a.g.e.", "a.e.", "a.g.m.", "age", "Ibid.", "op. cit.": İSNAD writes a short reference instead. */
export const AGE = /(?:^|[\s(;,])(a\.\s?g\.\s?[em]\.|a\.\s?e\.|a\.\s?y\.\s?e\.|ag[em]\.|ibid\.?|ibidem|op\.\s?cit\.)(?=[\s,;.)]|$)/i;

/** How many times the document's own text (outside Derkenar's citations) says a.g.e. and the like. */
export function ageCount(text: string): number {
  return (text.match(new RegExp(AGE.source, "gi")) ?? []).length;
}

export function checkCitations(order: readonly { id: string; noteIndex: number }[], state: DocState): CitationIssue[] {
  const out: CitationIssue[] = [];
  order.forEach((f, i) => {
    const c = state.citations[f.id];
    if (!c) return;
    const at = { citationId: f.id, noteIndex: f.noteIndex, position: i + 1 };
    if (c.override) out.push({ ...at, level: "info", code: "hand-edited", message: "Atıf metni elle yazılmış hâliyle korunuyor; Derkenar bu atıfı güncellemiyor." });
    const text = state.edited?.[f.id];
    if (text !== undefined) out.push({ ...at, level: "warning", code: "edited-in-word", message: `Atıf Word'de elle değiştirilmiş ("${text.length > 80 ? text.slice(0, 80) + "…" : text}"). Derkenar bu atıfı şimdilik güncellemiyor.` });
    const own = c.override ?? text;
    if (own !== undefined && AGE.test(own)) out.push({ ...at, level: "warning", code: "age", message: `Elle yazılmış metinde "${AGE.exec(own)![0].trim()}" var. İSNAD a.g.e., a.e., a.g.m., Ibid. gibi kısaltmaları kullanmaz; aynı esere yeniden atıfta kısa künye yazılır. "Derkenar'ın metnine dön" kısa künyeyi koyar.` });
    const seen = new Map<string, CiteRef>();
    for (const r of c.items) {
      const item = state.items[r.id];
      const name = item ? `${creatorLine(item) || "—"}, ${titleOf(item) || "(başlıksız)"}` : r.id;
      if (item && NEEDS_PLACE.has(item.itemType) && !hasPlace(r) && !r["suppress-author"] && !r.suffix?.trim()) {
        out.push({ ...at, level: "warning", code: "no-place", message: `Sayfa yok: ${name}. İSNAD dipnotta atıf yapılan yeri (sayfa, varak, madde) ister; eserin bütününe atıf yapılıyorsa böyle kalabilir.` });
      }
      const prev = seen.get(r.id);
      if (prev && (prev.locator ?? "") === (r.locator ?? "") && (prev.volume ?? "") === (r.volume ?? "")) {
        out.push({ ...at, level: "warning", code: "repeated", message: `Aynı eser aynı yerle iki kez: ${name}.` });
      }
      seen.set(r.id, r);
    }
  });
  return out;
}

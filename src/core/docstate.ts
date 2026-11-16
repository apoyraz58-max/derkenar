/**
 * What the document stores and how a refresh is planned. Word-independent:
 * the Word layer reads the citation controls in document order, this module
 * decides which ones change, and the Word layer writes only those.
 */
import { type Bibliography, type OrderedCitation, Renderer } from "./engine.js";
import type { CiteRef, CslItem, DocState, StoredCitation } from "./types.js";

export const TAG_CITATION = "KUNYE:C:";
export const TAG_BIBLIOGRAPHY = "KUNYE:BIB";
export const DEFAULT_STYLE = "isnad-dipnotlu";

export function emptyState(style = DEFAULT_STYLE, locale = "tr-TR"): DocState {
  return { v: 1, style, locale, items: {}, citations: {}, rendered: {} };
}

export function parseState(json: string | null | undefined): DocState {
  if (!json) return emptyState();
  try {
    const s = JSON.parse(json) as Partial<DocState>;
    if (s.v !== 1) return emptyState();
    return { ...emptyState(s.style, s.locale), ...s } as DocState;
  } catch {
    return emptyState();
  }
}

export function newCitationId(): string {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${Date.now().toString(36)}${r[0]!.toString(36)}${r[1]!.toString(36)}`.slice(0, 16);
}

export function citationIdFromTag(tag: string | null | undefined): string | null {
  return tag && tag.startsWith(TAG_CITATION) ? tag.slice(TAG_CITATION.length) : null;
}

/** Stores a citation and copies the cited works into the document. */
export function putCitation(state: DocState, id: string, items: CiteRef[], works: Record<string, CslItem>): void {
  for (const r of items) {
    const w = works[r.id] ?? state.items[r.id];
    if (w) state.items[r.id] = { ...w, id: r.id };
  }
  const old = state.citations[id];
  state.citations[id] = { items, ...(old?.override ? { override: old.override } : {}) };
  delete state.rendered[id];
}

/** A citation control found in the document. */
export interface FoundCitation {
  readonly id: string;
  readonly noteIndex: number;
  readonly text: string;
}

export interface RefreshPlan {
  /** Citations whose text must be rewritten, id → HTML. */
  readonly updates: Map<string, string>;
  /** Controls whose citation data is not in this document (copied from elsewhere). */
  readonly orphans: string[];
  /** Same id appearing twice (a citation copied within the document). */
  readonly duplicates: string[];
  readonly bibliography: Bibliography | null;
  readonly bibliographyChanged: boolean;
  /** Works stored in the document that no citation in the text cites. */
  readonly unused: string[];
}

export function planRefresh(state: DocState, found: readonly FoundCitation[], renderer: Renderer, force = false): RefreshPlan {
  const orphans: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const ordered: OrderedCitation[] = [];
  for (const f of found) {
    const c = state.citations[f.id];
    if (!c) {
      orphans.push(f.id);
      continue;
    }
    if (seen.has(f.id)) {
      duplicates.push(f.id);
      continue;
    }
    seen.add(f.id);
    ordered.push({ id: f.id, items: c.items, noteIndex: renderer.meta.note ? f.noteIndex : 0 });
  }
  renderer.setItems(state.items);
  const html = renderer.renderCitations(ordered);
  const updates = new Map<string, string>();
  const texts = new Map(found.map((f) => [f.id, f.text]));
  for (const [id, h] of html) {
    const c = state.citations[id] as StoredCitation;
    const out = c.override ?? h;
    if (force || state.rendered[id] !== out || (texts.get(id) ?? "").trim() === "") updates.set(id, out);
  }
  // Data of citations no longer in the text stays (undo can bring them back);
  // unused lists the works nothing in the text cites now.
  const cited = new Set(ordered.flatMap((c) => c.items.map((r) => r.id)));
  const unused = Object.keys(state.items).filter((k) => !cited.has(k));
  const bibliography = renderer.bibliography();
  const bibHtml = bibliography?.entries.map((e) => e.html).join("") ?? "";
  const bibliographyChanged = force || bibHtml !== (state.bibliographyHtml ?? "");
  return { updates, orphans, duplicates, bibliography, bibliographyChanged, unused };
}

export function commitPlan(state: DocState, plan: RefreshPlan): void {
  for (const [id, html] of plan.updates) state.rendered[id] = html;
  state.bibliographyHtml = plan.bibliography?.entries.map((e) => e.html).join("") ?? "";
}

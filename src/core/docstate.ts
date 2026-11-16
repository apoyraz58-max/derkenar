/**
 * What the document stores and how a refresh is planned. Word-independent:
 * the Word layer reads the citation controls in document order, this module
 * decides which ones change, and the Word layer writes only those.
 */
import { type Bibliography, type OrderedCitation, Renderer } from "./engine.js";
import type { CiteRef, CslItem, DocState, StoredCitation } from "./types.js";
import { type Item, toCsl } from "./zotero.js";

export const TAG_CITATION = "DERKENAR:C:";
export const TAG_BIBLIOGRAPHY = "DERKENAR:BIB";
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
export function putCitation(state: DocState, id: string, items: CiteRef[], works: Record<string, Item>): void {
  for (const r of items) {
    const w = works[r.id] ?? state.items[r.id];
    if (w) state.items[r.id] = structuredCloneItem(w);
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
    ordered.push({ id: f.id, items: renderer.meta.note ? withSameAuthor(c.items, state.items) : c.items, noteIndex: renderer.meta.note ? f.noteIndex : 0 });
  }
  renderer.setItems(cslMap(state.items, volumesCited(ordered.flatMap((c) => c.items))));
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

function structuredCloneItem(item: Item): Item {
  return JSON.parse(JSON.stringify(item)) as Item;
}

/** Types whose Cilt belongs to the container (journal, encyclopedia): never replaced by the citation's cilt. */
const CONTAINER_VOLUME = new Set(["article-journal", "article-magazine", "article-newspaper", "entry-encyclopedia", "entry-dictionary"]);

/**
 * İSNAD abbreviations for missing publication data, written at render time
 * (the record stays empty): basım yeri yok → b.y., yayınevi yok → y.y.
 * Tarih yok → ts. comes from the style itself.
 */
export const ISNAD_MISSING = { place: "b.y.", publisher: "y.y." } as const;
const NEEDS_IMPRINT = new Set(["book", "chapter", "entry-encyclopedia", "entry-dictionary", "paper-conference"]);

/**
 * Printed works only: an e-book ("PDF: Yayıncı, 2004") or a web source
 * ("Sözlük, “madde” (Erişim …)") has no place to report as missing.
 */
export function fillImprint(csl: CslItem): CslItem {
  if (!NEEDS_IMPRINT.has(csl.type)) return csl;
  if (csl.medium || csl.accessed || (csl.URL && !csl.publisher && !csl["publisher-place"])) return csl;
  if (!String(csl["publisher-place"] ?? "").trim()) csl["publisher-place"] = ISNAD_MISSING.place;
  if (!String(csl.publisher ?? "").trim()) csl.publisher = ISNAD_MISSING.publisher;
  return csl;
}

/** Primary creators as a comparable key ("" when none). */
function authorKey(item: Item | undefined): string {
  if (!item) return "";
  const main = item.creators.filter((c) => c.creatorType === "author");
  return main.map((c) => `${c.lastName ?? c.name ?? ""}|${c.firstName ?? ""}`.toLocaleLowerCase("tr")).join(";");
}

/**
 * İSNAD: in one footnote, a second consecutive work by the same author gets
 * "a.mlf." (aynı müellif) instead of the name: "…, 56; a.mlf., “İlk Mürciî…”".
 */
export function withSameAuthor(refs: readonly CiteRef[], items: Record<string, Item>): CiteRef[] {
  return refs.map((r, i) => {
    if (i === 0 || r["suppress-author"] || r.prefix) return r;
    const key = authorKey(items[r.id]);
    if (!key || key !== authorKey(items[refs[i - 1]!.id])) return r;
    return { ...r, "suppress-author": true, prefix: "a.mlf., " };
  });
}

/** Works cited somewhere with a cilt of their own ("1/80"). */
export function volumesCited(refs: readonly CiteRef[]): Set<string> {
  return new Set(refs.filter((r) => r.volume?.trim()).map((r) => r.id));
}

/**
 * Items as CSL. A book cited with its own cilt ("1/80") must not also print
 * the record's Cilt ("6/1/80"): for those works the record's volume is left out.
 */
export function cslMap(items: Record<string, Item>, citedWithVolume: ReadonlySet<string> = new Set()): Record<string, CslItem> {
  const out: Record<string, CslItem> = {};
  for (const [k, v] of Object.entries(items)) {
    const csl: CslItem = { ...toCsl(v), id: k };
    if (citedWithVolume.has(k) && !CONTAINER_VOLUME.has(csl.type) && csl.volume !== undefined) {
      // The record's Cilt was really the number of volumes: the bibliography says "6 Cilt".
      if (csl["number-of-volumes"] === undefined) csl["number-of-volumes"] = csl.volume;
      delete csl.volume;
    }
    out[k] = fillImprint(csl);
  }
  return out;
}

/** Order of citations and their notes: when it changes, the text must be re-rendered. */
export function signature(found: readonly { id: string; noteIndex: number }[]): string {
  return found.map((f) => `${f.id}@${f.noteIndex}`).join(",");
}

/** Works in the document whose library copy changed: refresh the document copy. */
export function syncWorks(state: DocState, library: (key: string) => Item | undefined): string[] {
  const changed: string[] = [];
  for (const [k, w] of Object.entries(state.items)) {
    const lib = library(k);
    if (lib && lib.dateModified !== w.dateModified) {
      state.items[k] = structuredCloneItem(lib);
      changed.push(k);
    }
  }
  return changed;
}

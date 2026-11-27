/**
 * What the document stores and how a refresh is planned. Word-independent:
 * the Word layer reads the citation controls in document order, this module
 * decides which ones change, and the Word layer writes only those.
 */
import { plainTranscription } from "./transcription.js";
import { type Bibliography, type OrderedCitation, Renderer } from "./engine.js";
import type { CiteRef, CslItem, DocState, StoredCitation } from "./types.js";
import { sameAuthors } from "./names.js";
import { htmlToText } from "./html.js";
import { isArabicTitle } from "./isnadstyle.js";
import { fold } from "./search.js";
import { type Creator, type Item, toCsl } from "./zotero.js";

export const TAG_CITATION = "DERKENAR:C:";
export const TAG_BIBLIOGRAPHY = "DERKENAR:BIB";
export const TAG_ABBREVIATIONS = "DERKENAR:ABBR";
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
  /** Citations whose text was changed by hand in Word (id → that text): left as they are. */
  readonly edited: Map<string, string>;
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
    // a.mlf. in footnotes and in in-text citations alike (guide s. 65 and s. 139).
    ordered.push({ id: f.id, items: renderer.meta.isnad ? withSameAuthor(c.items, state.items, renderer.language) : c.items, noteIndex: renderer.meta.note ? f.noteIndex : 0 });
  }
  renderer.setItems(cslMap(state.items, volumesCited(ordered.flatMap((c) => c.items)), renderer.meta.isnad, renderer.language, state.plainTitles === true));
  const uncited = (state.bibUncited ?? []).filter((k) => state.items[k]);
  const html = renderer.renderCitations(ordered, uncited);
  const updates = new Map<string, string>();
  const edited = new Map<string, string>();
  const texts = new Map(found.map((f) => [f.id, f.text]));
  for (const [id, h] of html) {
    const c = state.citations[id] as StoredCitation;
    const out = c.override ?? h;
    const inWord = texts.get(id) ?? "";
    // Text changed by hand in Word since Künye wrote it: kept (Zotero asks the same).
    const before = state.rendered[id];
    if (before && !c.override && inWord.trim() && sameText(htmlToText(before)) !== sameText(inWord)) {
      edited.set(id, inWord);
      continue;
    }
    if (force || before !== out || inWord.trim() === "") updates.set(id, out);
  }
  // Data of citations no longer in the text stays (undo can bring them back);
  // unused lists the works nothing in the text cites now.
  const cited = new Set([...ordered.flatMap((c) => c.items.map((r) => r.id)), ...uncited]);
  const unused = Object.keys(state.items).filter((k) => !cited.has(k));
  const excluded = new Set(state.bibExcluded ?? []);
  const all = renderer.bibliography();
  const raw = all && excluded.size ? { ...all, entries: all.entries.filter((e) => !e.ids.length || !e.ids.every((id) => excluded.has(id))) } : all;
  const bibliography = raw && state.bibSections ? withSections(raw, state.items) : raw;
  const bibHtml = bibliography?.entries.map((e) => (e.heading ? `<h>${e.html}</h>` : e.html)).join("") ?? "";
  const bibliographyChanged = force || bibHtml !== (state.bibliographyHtml ?? "");
  return { updates, orphans, duplicates, bibliography, bibliographyChanged, unused, edited };
}

export function commitPlan(state: DocState, plan: RefreshPlan): void {
  for (const [id, html] of plan.updates) state.rendered[id] = html;
  state.edited = Object.fromEntries(plan.edited);
  state.bibliographyHtml = plan.bibliography?.entries.map((e) => (e.heading ? `<h>${e.html}</h>` : e.html)).join("") ?? "";
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
export function fillImprint(csl: CslItem, lang = "tr-TR"): CslItem {
  // İSNAD in English (ISNAD Citation Style 2nd ed., abbreviations): s.l. (sine loco), s.n. (sine nomine).
  const missing = /^en/.test(lang) ? { place: "s.l.", publisher: "s.n." } : ISNAD_MISSING;
  if (!NEEDS_IMPRINT.has(csl.type)) return csl;
  if (csl.medium || csl.accessed || (csl.URL && !csl.publisher && !csl["publisher-place"])) return csl;
  if (!String(csl["publisher-place"] ?? "").trim()) csl["publisher-place"] = missing.place;
  if (!String(csl.publisher ?? "").trim()) csl.publisher = missing.publisher;
  return csl;
}

const authorsOf = (item: Item | undefined) => (item ? item.creators.filter((c) => c.creatorType === "author") : []);

/**
 * İSNAD: in one footnote, a consecutive *different* work by the same author
 * gets "a.mlf." (aynı müellif) instead of the name: "…, 56; a.mlf., “İlk
 * Mürciî…”". A second place in the same work is not a.mlf. (guide, s. 65;
 * changes list: "aynı yazara ait farklı eserlere").
 */
export function withSameAuthor(refs: readonly CiteRef[], items: Record<string, Item>, lang = "tr-TR"): CiteRef[] {
  // Two records of one work (entered twice) are still one work.
  const title = (id: string) => fold(items[id]?.fields.title ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
  return refs.map((r, i) => {
    const prev = refs[i - 1];
    if (i === 0 || !prev || r["suppress-author"] || r.prefix || r.id === prev.id || (title(r.id) && title(r.id) === title(prev.id))) return r;
    // The same author even when spelled differently in the two records ("Gazzâlî" / "Gazzali", fuller given name).
    if (!sameAuthors(authorsOf(items[r.id]), authorsOf(items[prev.id]))) return r;
    // İSNAD in English: "Id." (ISNAD Citation Style 2nd ed.: "…, 56; Id., “İlk Mürciî…”").
    return { ...r, "suppress-author": true, prefix: /^en/.test(lang) ? "Id., " : "a.mlf., " };
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
/** English İSNAD: the names of persons in the Şahıslar table written the EI3 way (set by the pane when a table is loaded). */
let englishNames: ((c: Creator) => Creator) | null = null;
export function setEnglishNames(fn: ((c: Creator) => Creator) | null): void {
  englishNames = fn;
}

/** Title variables a transcribed title may be in. */
const TITLE_VARS = ["title", "title-short", "container-title", "container-title-short", "collection-title", "original-title", "volume-title"] as const;

/** Kitap adları transkripsiyonsuz: the titles of the records are printed without the transcription marks (the records keep them). */
export function plainTitles(csl: CslItem): CslItem {
  const c = csl as CslItem & Record<string, unknown>;
  for (const k of TITLE_VARS) if (typeof c[k] === "string") c[k] = plainTranscription(c[k] as string);
  return csl;
}

export function cslMap(items: Record<string, Item>, citedWithVolume: ReadonlySet<string> = new Set(), isnad = true, lang = "tr-TR", plain = false): Record<string, CslItem> {
  const out: Record<string, CslItem> = {};
  const english = isnad && /^en/.test(lang);
  for (const [k, v0] of Object.entries(items)) {
    const v = english && englishNames ? { ...v0, creators: v0.creators.map(englishNames) } : v0;
    const csl: CslItem = { ...toCsl(v), id: k };
    if (citedWithVolume.has(k) && !CONTAINER_VOLUME.has(csl.type) && csl.volume !== undefined) {
      // The record's Cilt was really the number of volumes: the bibliography says "6 Cilt".
      if (csl["number-of-volumes"] === undefined) csl["number-of-volumes"] = csl.volume;
      delete csl.volume;
    }
    // citeproc title-cases titles of English-language works; a transliterated or Turkish title is not one ("Kitāb al-Tawḥīd").
    if (isnad && /^en/.test(lang)) englishIsnad(csl);
    if (plain) plainTitles(csl);
    out[k] = isnad ? fillImprint(spacedInitials(articleToGiven(csl, english)), lang) : plainRoles(csl);
  }
  return out;
}

/** İSNAD writes initials apart: "C.E. Bosworth" → "C. E. Bosworth" (the record is not changed). */
export function spacedInitials(csl: CslItem): CslItem {
  const c = csl as CslItem & Record<string, unknown>;
  for (const value of Object.values(c)) {
    if (!Array.isArray(value)) continue;
    for (const n of value as Record<string, unknown>[]) {
      // Only a given name of initials alone ("C.E.", "J.R.R."); "T.C. Cumhurbaşkanlığı" is an abbreviation, not initials.
      if (typeof n?.given === "string" && /^(?:\p{Lu}\.\s?){2,}$/u.test(n.given.trim())) n.given = n.given.trim().replace(/(\p{Lu}\.)(?=\p{Lu}\.)/gu, "$1 ");
    }
  }
  return csl;
}

/** "el-Gazzâlî" in the surname box (as Zotero users often write it). */
const SURNAME_ARTICLE = /^((?:el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|eż|al)-)(\p{L}.*)$/iu;

/**
 * İSNAD: the article goes with the given name, so the first citation reads
 * "Ebû Hâmid … el-Gazzâlî", later ones and the in-text form "Gazzâlî", and the
 * bibliography "Gazzâlî, Ebû Hâmid …" under G (guide s. 87). A surname typed
 * as "el-Gazzâlî" is read the same way; the record is not changed.
 */
export function articleToGiven(csl: CslItem, english = false): CslItem {
  const c = csl as CslItem & Record<string, unknown>;
  for (const value of Object.values(c)) {
    if (!Array.isArray(value)) continue;
    for (const n of value as Record<string, unknown>[]) {
      const family = typeof n?.family === "string" ? n.family : "";
      const m = SURNAME_ARTICLE.exec(family);
      if (!m || n.literal) continue;
      // English İSNAD keeps EI3's "al-" with the surname: "al-Bukhārī, Abū ʿAbdallāh …", "al-Bukhārī, al-Jāmiʿ".
      if (english && /^al-$/i.test(m[1]!)) continue;
      const article = m[1]!.toLocaleLowerCase("tr");
      const given = typeof n.given === "string" ? n.given.trim() : "";
      n.family = m[2]!.charAt(0).toLocaleUpperCase("tr") + m[2]!.slice(1);
      n.given = given ? `${given} ${article}` : article;
    }
  }
  return csl;
}

/**
 * Other styles (APA, Chicago …) know no muhakkik, nâşir, hazırlayan or
 * sadeleştiren: they read them as editors ("Ed."). Film and broadcast
 * directors stay directors.
 */
export function plainRoles(csl: CslItem): CslItem {
  const c = csl as CslItem & Record<string, unknown>;
  const moved: unknown[] = [];
  const roles = ["collection-editor", "editorial-director", "reviewed-author", ...(["motion_picture", "broadcast"].includes(csl.type) ? [] : ["director"])];
  for (const role of roles) {
    const names = c[role];
    if (Array.isArray(names) && names.length) {
      moved.push(...names);
      delete c[role];
    }
  }
  if (moved.length) c.editor = [...(c.editor ?? []), ...(moved as NonNullable<CslItem["editor"]>)];
  // The Arabic article İSNAD keeps at the end of the given name ("Fahreddin … er-") is a particle here: "er-Râzî".
  for (const value of Object.values(c)) {
    if (!Array.isArray(value)) continue;
    for (const n of value as Record<string, unknown>[]) {
      const given = typeof n?.given === "string" ? n.given : "";
      const m = /\s+((?:el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|al|ar|az|as|an|at|ad)-)$/i.exec(given);
      if (m && typeof n.family === "string" && !n["non-dropping-particle"]) {
        n.given = given.slice(0, m.index);
        n["non-dropping-particle"] = m[1];
      }
    }
  }
  return csl;
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

/** Sections of a bibliography divided by kind, in the order Turkish theses use. */
export const BIB_SECTIONS: readonly { title: string; types: readonly string[] }[] = [
  { title: "Arşiv Belgeleri", types: [] },
  { title: "Yazma Eserler", types: ["manuscript"] },
  { title: "Kitaplar ve Kitap Bölümleri", types: ["book", "bookSection"] },
  { title: "Ansiklopedi ve Sözlük Maddeleri", types: ["encyclopediaArticle", "dictionaryEntry"] },
  { title: "Makaleler ve Bildiriler", types: ["journalArticle", "magazineArticle", "newspaperArticle", "conferencePaper"] },
  { title: "Tezler", types: ["thesis"] },
  { title: "Mevzuat", types: ["statute", "bill", "case", "hearing"] },
  { title: "Elektronik Kaynaklar", types: ["webpage", "blogPost", "forumPost", "podcast", "videoRecording", "film", "tvBroadcast", "radioBroadcast", "computerProgram", "dataset", "audioRecording", "instantMessage", "email"] },
  { title: "Diğer Kaynaklar", types: [] },
];

function sectionOf(item: Item | undefined): string {
  if (!item) return "Diğer Kaynaklar";
  // Archival documents: letters, documents, maps … kept in an archive.
  if (!["manuscript", "book", "bookSection", "thesis"].includes(item.itemType) && item.fields.archive?.trim()) return "Arşiv Belgeleri";
  return BIB_SECTIONS.find((s) => s.types.includes(item.itemType))?.title ?? "Diğer Kaynaklar";
}

/** The same entries, in sections with a heading each; each section keeps the style's order. */
export function withSections(bib: Bibliography, items: Record<string, Item>): Bibliography {
  const by = new Map<string, Bibliography["entries"][number][]>();
  for (const e of bib.entries) {
    const s = sectionOf(items[e.ids[0] ?? ""]);
    by.set(s, [...(by.get(s) ?? []), e]);
  }
  const entries: Bibliography["entries"][number][] = [];
  for (const { title } of BIB_SECTIONS) {
    const list = by.get(title);
    if (list?.length) entries.push({ ids: [], html: title, heading: true }, ...list);
  }
  return { ...bib, entries };
}

/** Text compared without regard to spaces (Word may give non-breaking ones back). */
function sameText(s: string): string {
  return s.normalize("NFC").replace(/[\s\u00a0\u202f]+/g, "");
}

/** "Elle yazılanı koru": the hand-written text becomes the citation's own text. */
export function keepEdited(state: DocState, id: string): void {
  const text = state.edited?.[id];
  const c = state.citations[id];
  if (text === undefined || !c) return;
  c.override = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  state.rendered[id] = c.override;
  delete state.edited![id];
}

/** "Künye'nin metnine dön": the next refresh writes the generated text again. */
export function revertEdited(state: DocState, id: string): void {
  const c = state.citations[id];
  if (c) delete c.override;
  delete state.rendered[id];
  if (state.edited) delete state.edited[id];
}

/** Turkish words in a record that the ISNAD Citation Style 2nd Edition writes in English. */
const EN_GENRE: Record<string, string> = {
  "lisans tezi": "Undergraduate Thesis",
  "yüksek lisans tezi": "Master’s Thesis",
  "doktora tezi": "Ph.D. Dissertation",
  "sanatta yeterlik tezi": "Thesis in Proficiency in Art",
  "tıpta uzmanlık tezi": "Thesis in Specialization in Medicine",
  "tıpta yan dal uzmanlık tezi": "Thesis in Minor Specialization in Medicine",
  "diş hekimliğinde uzmanlık tezi": "Thesis in Specialization in Dentistry",
  "diş hekimliği uzmanlık tezi": "Thesis in Specialization in Dentistry",
  "doçentlik tezi": "Habilitation",
  fotoğraf: "Photograph",
  film: "Movie",
  yazılım: "Software",
  "sınav kağıdı": "Exam Paper",
  "sınav kâğıdı": "Exam Paper",
  "nota kağıdı": "Music Paper",
  "nota kâğıdı": "Music Paper",
  afiş: "Poster",
  "görüşme transkripsiyonu": "Transcribed Interview",
  "e-posta": "E-mail",
};
const EN_CONTAINER: Record<string, string> = { "resmî gazete": "Official Gazette", "resmi gazete": "Official Gazette" };

/**
 * A work cited in an English text (ISNAD Citation Style 2nd Edition): thesis
 * types, kinds of work and the Official Gazette in English; an "y.y." or
 * "b.y." typed into the record as s.n. / s.l.; and no English title casing
 * by citeproc ("und": titles keep their own spelling, "Kitāb al-Tawḥīd",
 * "Geschichte des arabischen Schrifttums"; a Turkish code would make citeproc
 * capitalise English terms the Turkish way, "İnterviewer").
 */
export function englishIsnad(csl: CslItem): CslItem {
  const c = csl as CslItem & Record<string, unknown>;
  const low = (v: unknown) => String(v ?? "").trim().toLocaleLowerCase("tr");
  for (const k of ["genre", "medium"]) if (typeof c[k] === "string" && EN_GENRE[low(c[k])]) c[k] = EN_GENRE[low(c[k])];
  if (typeof c["container-title"] === "string" && EN_CONTAINER[low(c["container-title"])]) c["container-title"] = EN_CONTAINER[low(c["container-title"])];
  if (/^b\.?\s?y\.?$/i.test(String(c["publisher-place"] ?? "").trim())) c["publisher-place"] = "s.l.";
  if (/^y\.?\s?y\.?$/i.test(String(c.publisher ?? "").trim())) c.publisher = "s.n.";
  if (!c.language) c.language = "und";
  return csl;
}

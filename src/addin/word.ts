/**
 * Everything that touches the Word document. Each public function is one
 * Word.run with as few context.sync() round trips as possible: that, not the
 * formatting, is where Word add-ins lose their time.
 */
import { TAG_BIBLIOGRAPHY, TAG_CITATION, citationIdFromTag, parseState, type FoundCitation } from "../core/docstate.js";
import { LIBRARY_NS } from "../core/librarycopy.js";
import type { DocState, Segment } from "../core/types.js";

const SETTING = "derkenar";

export function footnotesSupported(): boolean {
  try {
    return Office.context.requirements.isSetSupported("WordApi", "1.5");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- document data

export function loadState(): DocState {
  return parseState(Office.context.document.settings.get(SETTING) as string | null);
}

export function saveState(state: DocState): Promise<void> {
  Office.context.document.settings.set(SETTING, JSON.stringify(state));
  return new Promise((resolve, reject) =>
    Office.context.document.settings.saveAsync((r) => (r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(r.error?.message ?? "Belge ayarı kaydedilemedi")))),
  );
}

// ---------------------------------------------------------------- writing runs

function writeRuns(target: Word.ContentControl | Word.Paragraph, segments: readonly Segment[], replace: boolean): void {
  const list = segments.length ? segments : [{ text: " " }];
  list.forEach((seg, i) => {
    const where = i === 0 && replace ? "Replace" : "End";
    const range = (target as Word.ContentControl).insertText(seg.text, where as "Replace");
    const f = range.font;
    f.italic = Boolean(seg.italic);
    f.bold = Boolean(seg.bold);
    f.superscript = Boolean(seg.superscript);
    f.subscript = Boolean(seg.subscript);
    f.underline = seg.underline ? "Single" : "None";
  });
}

function setupControl(cc: Word.ContentControl, id: string): void {
  cc.tag = TAG_CITATION + id;
  cc.title = "Atıf";
  cc.appearance = "Hidden";
}

// ---------------------------------------------------------------- citations

export type Placement = "footnote" | "endnote" | "text";

/**
 * Inserts a citation at the cursor: in a new footnote or endnote for note
 * styles (when Word supports notes), in the text otherwise. With a selection,
 * the citation goes after it and the selected text stays.
 */
export async function insertCitation(id: string, segments: readonly Segment[], want: Placement): Promise<Placement> {
  if (want === "text") return insertCitationAt(id, segments, "text");
  try {
    return await insertCitationAt(id, segments, want);
  } catch (e) {
    // Word refuses a note inside a note, a comment or a text box: write the citation where the cursor is.
    if (/NotAllowed|InvalidArgument|GeneralException|notAllowed/i.test(String((e as { code?: string }).code ?? e))) return insertCitationAt(id, segments, "text");
    throw e;
  }
}

async function insertCitationAt(id: string, segments: readonly Segment[], want: Placement): Promise<Placement> {
  return Word.run(async (context) => {
    const end = context.document.getSelection().getRange("End");
    const text = segments.map((s) => s.text).join("") || "…";
    const where: Placement = want !== "text" && footnotesSupported() ? want : "text";
    let range: Word.Range;
    if (where === "text") range = end.insertText(text, "End");
    else {
      const note = where === "endnote" ? end.insertEndnote("") : end.insertFootnote("");
      range = note.body.getRange("End").insertText(text, "End");
    }
    const cc = range.insertContentControl();
    setupControl(cc, id);
    writeRuns(cc, segments, true);
    cc.getRange("After").select("Start");
    await context.sync();
    return where;
  });
}

/** Opens the Derkenar pane whenever this document opens, so automatic updates keep running. */
export function enableAutoOpen(): void {
  try {
    const s = Office.context.document.settings;
    if (s.get("Office.AutoShowTaskpaneWithDocument") !== true) s.set("Office.AutoShowTaskpaneWithDocument", true);
  } catch {
    /* not available: the user opens the pane */
  }
}

export interface InsertionPoint {
  /** The cursor is in a footnote or endnote: insert in place, never a new note (Word refuses one there). */
  readonly inNote: boolean;
  /** A citation right before the cursor in the same note (only spaces or ; between): add to it, "…; …". */
  readonly joinWith: string | null;
}

const NOTE_BODIES = new Set(["Footnote", "Endnote", "NoteItem"]);

/**
 * Where a new citation goes, decided from the cursor before inserting. Uses
 * only text and ranges (WordApi 1.3), no location comparison: the text from
 * the start of the note to the cursor is read, and if it ends with a citation
 * (only spaces, ";" or "," after it), the new works join that citation.
 */
export async function insertionPoint(): Promise<InsertionPoint> {
  return Word.run(async (context) => {
    const sel = context.document.getSelection();
    const inside = sel.parentContentControlOrNullObject;
    inside.load("tag");
    const body = sel.parentBody;
    body.load("type");
    await context.sync();
    const insideId = inside.isNullObject ? null : citationIdFromTag(inside.tag);
    const inNote = NOTE_BODIES.has(body.type);
    if (insideId) return { inNote, joinWith: insideId };
    if (!inNote) return { inNote, joinWith: null };
    const controls = body.contentControls;
    controls.load("items/tag,items/text");
    const before = body.getRange("Start").expandTo(sel.getRange("Start"));
    before.load("text");
    await context.sync();
    const tail = before.text.replace(/[\s;,\u200b]+$/, "");
    let joinWith: string | null = null;
    for (const cc of controls.items) {
      const id = citationIdFromTag(cc.tag);
      const text = cc.text.trim();
      if (id && text && tail.endsWith(text)) joinWith = id;
    }
    return { inNote, joinWith };
  });
}

/** The citation the cursor is in, if any. */
export async function citationAtSelection(): Promise<string | null> {
  return Word.run(async (context) => {
    const cc = context.document.getSelection().parentContentControlOrNullObject;
    cc.load("tag");
    await context.sync();
    return cc.isNullObject ? null : citationIdFromTag(cc.tag);
  });
}

interface Located {
  readonly found: FoundCitation;
  readonly control: Word.ContentControl;
}

/**
 * Every Derkenar control: footnote citations (in note order), endnote
 * citations, then those in the text. Without `withText` only tags are read,
 * which is what the automatic-update watcher needs.
 */
async function locate(context: Word.RequestContext, withText = true): Promise<{ citations: Located[]; bibliography: Word.ContentControl[] }> {
  const props = withText ? "items/id,items/tag,items/text" : "items/id,items/tag";
  const bodyControls = context.document.body.contentControls;
  bodyControls.load(props);
  const noteSets: Word.NoteItemCollection[] = [];
  if (footnotesSupported()) {
    noteSets.push(context.document.body.footnotes, context.document.body.endnotes);
    for (const n of noteSets) n.load("items");
  }
  await context.sync();
  const noteControls: Word.ContentControlCollection[] = [];
  for (const set of noteSets) {
    for (const n of set.items) {
      const c = n.body.contentControls;
      c.load(props);
      noteControls.push(c);
    }
  }
  if (noteControls.length) await context.sync();
  const citations: Located[] = [];
  const inNotes = new Set<number>();
  noteControls.forEach((coll, i) => {
    for (const cc of coll.items) {
      const id = citationIdFromTag(cc.tag);
      if (!id) continue;
      inNotes.add(cc.id);
      citations.push({ found: { id, noteIndex: i + 1, text: withText ? cc.text : "" }, control: cc });
    }
  });
  const bibliography: Word.ContentControl[] = [];
  for (const cc of bodyControls.items) {
    if (inNotes.has(cc.id)) continue;
    if (cc.tag === TAG_BIBLIOGRAPHY) bibliography.push(cc);
    const id = citationIdFromTag(cc.tag);
    if (id) citations.push({ found: { id, noteIndex: 0, text: withText ? cc.text : "" }, control: cc });
  }
  return { citations, bibliography };
}

/** Citation ids and note numbers in document order (cheap: no text is read). */
export async function readOrder(): Promise<FoundCitation[]> {
  return Word.run(async (context) => (await locate(context, false)).citations.map((c) => c.found));
}

export interface RefreshWrite {
  /** Citation id → runs to write. */
  readonly citations: Map<string, Segment[]>;
  /** Bibliography entries; null leaves the bibliography as it is. */
  readonly bibliography: Segment[][] | null;
  readonly hangingIndent: boolean;
  /** Position in the found list → new id (copies of another citation get their own). */
  readonly retag?: Map<number, string>;
}

/**
 * Reads the citations, lets `plan` decide what changes, writes only that.
 * Two to three round trips whatever the length of the document.
 */
export async function refreshDocument(plan: (found: FoundCitation[]) => RefreshWrite | Promise<RefreshWrite>): Promise<{ citations: number; written: number; bibliography: boolean }> {
  return Word.run(async (context) => {
    const { citations, bibliography } = await locate(context);
    const write = await plan(citations.map((c) => c.found));
    let written = 0;
    citations.forEach((c, i) => {
      const fresh = write.retag?.get(i);
      if (fresh) c.control.tag = TAG_CITATION + fresh;
      const segs = write.citations.get(fresh ?? c.found.id);
      if (segs) {
        writeRuns(c.control, segs, true);
        written++;
      }
    });
    if (write.bibliography && bibliography[0]) fillBibliography(bibliography[0], write.bibliography, write.hangingIndent);
    await context.sync();
    return { citations: citations.length, written, bibliography: Boolean(write.bibliography && bibliography[0]) };
  });
}

function fillBibliography(cc: Word.ContentControl, entries: readonly Segment[][], hanging: boolean): void {
  cc.clear();
  const list = entries.length ? entries : [[{ text: "(Kaynakça boş: belgede atıf yok.)" }]];
  list.forEach((segs, i) => {
    const p = i === 0 ? cc.paragraphs.getFirst() : cc.insertParagraph("", "End");
    for (const seg of segs) {
      const r = p.insertText(seg.text, "End");
      r.font.italic = Boolean(seg.italic);
      r.font.bold = Boolean(seg.bold);
      r.font.superscript = Boolean(seg.superscript);
      r.font.subscript = Boolean(seg.subscript);
      r.font.underline = seg.underline ? "Single" : "None";
    }
    p.leftIndent = hanging ? 36 : 0;
    p.firstLineIndent = hanging ? -36 : 0;
  });
}

/**
 * Places an empty bibliography after the paragraph with the cursor (unless
 * one exists), under a "Başlık 1" heading when a title is given.
 */
export async function ensureBibliography(title = "Kaynakça"): Promise<"created" | "exists"> {
  return Word.run(async (context) => {
    const existing = context.document.body.contentControls.getByTag(TAG_BIBLIOGRAPHY);
    existing.load("items");
    await context.sync();
    if (existing.items.length > 0) {
      existing.items[0]!.getRange("Start").select();
      await context.sync();
      return "exists";
    }
    let para: Word.Paragraph = context.document.getSelection().paragraphs.getLast();
    if (title.trim()) {
      para = para.insertParagraph(title.trim(), "After");
      para.styleBuiltIn = "Heading1" as Word.BuiltInStyleName;
    }
    const p = para.insertParagraph("Kaynakça hazırlanıyor…", "After");
    p.styleBuiltIn = "Normal" as Word.BuiltInStyleName;
    const cc = p.insertContentControl();
    cc.tag = TAG_BIBLIOGRAPHY;
    cc.title = "Kaynakça";
    cc.appearance = "BoundingBox";
    await context.sync();
    return "created";
  });
}

/** Turns every citation and the bibliography into plain text (for submission). Undo brings them back. */
export async function unlinkAll(): Promise<number> {
  return Word.run(async (context) => {
    const { citations, bibliography } = await locate(context);
    for (const c of citations) c.control.delete(true);
    for (const b of bibliography) b.delete(true);
    await context.sync();
    return citations.length;
  });
}

/**
 * Deletes a citation from the text. When it is alone in its footnote or
 * endnote (nothing else written there), the note goes too; otherwise only the
 * citation, and the user's own words in the note stay.
 */
export async function deleteCitation(id: string): Promise<"note" | "citation" | "none"> {
  return Word.run(async (context) => {
    const tag = TAG_CITATION + id;
    const sets: Word.NoteItemCollection[] = [];
    if (footnotesSupported()) {
      sets.push(context.document.body.footnotes, context.document.body.endnotes);
      for (const n of sets) n.load("items");
    }
    const bodyControls = context.document.body.contentControls.getByTag(tag);
    bodyControls.load("items");
    await context.sync();
    const notes = sets.flatMap((s) => s.items);
    const checks = notes.map((n) => {
      const ccs = n.body.contentControls.getByTag(tag);
      ccs.load("items/text");
      n.body.load("text");
      return { n, ccs };
    });
    if (checks.length) await context.sync();
    for (const { n, ccs } of checks) {
      const cc = ccs.items[0];
      if (!cc) continue;
      const rest = n.body.text.replace(cc.text, "").replace(/[\s\u200b\u0002]+/g, "");
      if (!rest) n.delete();
      else cc.delete(false);
      await context.sync();
      return rest ? "citation" : "note";
    }
    const cc = bodyControls.items[0];
    if (!cc) return "none";
    cc.delete(false);
    await context.sync();
    return "citation";
  });
}

/** Selects the n-th citation with this id (used by the document list). */
export async function selectCitation(id: string): Promise<boolean> {
  return Word.run(async (context) => {
    const { citations } = await locate(context);
    const c = citations.find((x) => x.found.id === id);
    if (!c) return false;
    c.control.select("Select");
    await context.sync();
    return true;
  });
}

export function onSelectionChanged(handler: () => void): void {
  try {
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler);
  } catch {
    /* older hosts: the pane still works with the Düzenle button */
  }
}

/** Writes plain text at the cursor (Zotero's "Add Note" puts a note into the document). */
export async function insertPlainText(text: string): Promise<void> {
  if (!text.trim()) return;
  await Word.run(async (context) => {
    const paras = text.split(/\n+/);
    let range = context.document.getSelection().insertText(paras[0]!, "Replace");
    for (const p of paras.slice(1)) range = range.insertParagraph(p, "After").getRange("End");
    await context.sync();
  });
}

// ---------------------------------------------------------------- library copy in the document


type Parts = Office.CustomXmlParts;
const parts = (): Parts | null => {
  try {
    return Office.context.document.customXmlParts ?? null;
  } catch {
    return null;
  }
};

/** The library copy stored in this document (raw XML), or null. */
export function readLibraryCopy(): Promise<string | null> {
  const p = parts();
  if (!p) return Promise.resolve(null);
  return new Promise((resolve) => {
    p.getByNamespaceAsync(LIBRARY_NS, (r) => {
      const found = r.status === Office.AsyncResultStatus.Succeeded ? r.value : [];
      if (!found.length) return resolve(null);
      found[found.length - 1]!.getXmlAsync((x) => resolve(x.status === Office.AsyncResultStatus.Succeeded ? x.value : null));
    });
  });
}

/** Replaces the library copy stored in this document. */
export function writeLibraryCopy(xml: string): Promise<void> {
  const p = parts();
  if (!p) return Promise.resolve();
  return new Promise((resolve, reject) => {
    p.getByNamespaceAsync(LIBRARY_NS, (r) => {
      const old = r.status === Office.AsyncResultStatus.Succeeded ? r.value : [];
      p.addAsync(xml, (added) => {
        if (added.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(added.error?.message ?? "Kütüphane belgeye yazılamadı"));
        let left = old.length;
        if (!left) return resolve();
        for (const part of old) part.deleteAsync(() => --left === 0 && resolve());
      });
    });
  });
}

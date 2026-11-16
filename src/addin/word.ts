/**
 * Everything that touches the Word document. Each public function is one
 * Word.run with as few context.sync() round trips as possible: that, not the
 * formatting, is where Word add-ins lose their time.
 */
import { TAG_BIBLIOGRAPHY, TAG_CITATION, citationIdFromTag, parseState, type FoundCitation } from "../core/docstate.js";
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

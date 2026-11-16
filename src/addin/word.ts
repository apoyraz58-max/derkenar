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

/**
 * Inserts a citation at the cursor: in a new footnote for note styles (when
 * Word supports footnotes), in the text otherwise. With a selection, the
 * citation goes after it and the selected text stays.
 */
export async function insertCitation(id: string, segments: readonly Segment[], asFootnote: boolean): Promise<"footnote" | "text"> {
  return Word.run(async (context) => {
    const sel = context.document.getSelection();
    const end = sel.getRange("End");
    const text = segments.map((s) => s.text).join("") || "…";
    let cc: Word.ContentControl;
    let where: "footnote" | "text";
    if (asFootnote && footnotesSupported()) {
      const note = end.insertFootnote("");
      const range = note.body.getRange("End").insertText(text, "End");
      cc = range.insertContentControl();
      where = "footnote";
    } else {
      const range = end.insertText(text, "End");
      cc = range.insertContentControl();
      where = "text";
    }
    setupControl(cc, id);
    writeRuns(cc, segments, true);
    cc.getRange("After").select("Start");
    await context.sync();
    return where;
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

/** Every Derkenar control: footnote citations first (in note order), then those in the text. */
async function locate(context: Word.RequestContext): Promise<{ citations: Located[]; bibliography: Word.ContentControl[] }> {
  const bodyControls = context.document.body.contentControls;
  bodyControls.load("items/id,items/tag,items/text");
  let notes: Word.NoteItemCollection | null = null;
  if (footnotesSupported()) {
    notes = context.document.body.footnotes;
    notes.load("items");
  }
  await context.sync();
  const noteControls: Word.ContentControlCollection[] = [];
  if (notes) {
    for (const n of notes.items) {
      const c = n.body.contentControls;
      c.load("items/id,items/tag,items/text");
      noteControls.push(c);
    }
    if (noteControls.length) await context.sync();
  }
  const citations: Located[] = [];
  const inNotes = new Set<number>();
  noteControls.forEach((coll, i) => {
    for (const cc of coll.items) {
      const id = citationIdFromTag(cc.tag);
      if (!id) continue;
      inNotes.add(cc.id);
      citations.push({ found: { id, noteIndex: i + 1, text: cc.text }, control: cc });
    }
  });
  const bibliography: Word.ContentControl[] = [];
  for (const cc of bodyControls.items) {
    if (inNotes.has(cc.id)) continue;
    if (cc.tag === TAG_BIBLIOGRAPHY) bibliography.push(cc);
    const id = citationIdFromTag(cc.tag);
    if (id) citations.push({ found: { id, noteIndex: 0, text: cc.text }, control: cc });
  }
  return { citations, bibliography };
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

/** Places an empty bibliography after the paragraph with the cursor (unless one exists). */
export async function ensureBibliography(): Promise<"created" | "exists"> {
  return Word.run(async (context) => {
    const existing = context.document.body.contentControls.getByTag(TAG_BIBLIOGRAPHY);
    existing.load("items");
    await context.sync();
    if (existing.items.length > 0) {
      existing.items[0]!.getRange("Start").select();
      await context.sync();
      return "exists";
    }
    const para = context.document.getSelection().paragraphs.getLast();
    const p = para.insertParagraph("Kaynakça hazırlanıyor…", "After");
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

/** CSL-JSON item (https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html). */
export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  "non-dropping-particle"?: string;
  "dropping-particle"?: string;
  suffix?: string;
}

export interface CslDate {
  "date-parts"?: (number | string)[][];
  literal?: string;
  raw?: string;
}

export interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  issued?: CslDate;
  "container-title"?: string;
  publisher?: string;
  "publisher-place"?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  DOI?: string;
  ISBN?: string;
  URL?: string;
  [field: string]: unknown;
}

/** One cited work inside a citation, as stored in the document. */
export interface CiteRef {
  id: string;
  /** Cilt of a multi-volume work; with a page it becomes "1/45" (İSNAD). */
  volume?: string;
  locator?: string;
  /** CSL locator label: page, chapter, volume, folio, … (default page). */
  label?: string;
  prefix?: string;
  suffix?: string;
  "suppress-author"?: boolean;
  /** Hadith: kitâb name ("Menâḳıb"), bâb or hadith number, hadith no in parentheses, free text in parentheses. */
  kitab?: string;
  bab?: string;
  hadisNo?: string;
  paren?: string;
  /** Dictionary: madde ("delîl"). */
  madde?: string;
  /** Kur’ân: sûre number and âyet ("8", "2" → el-Enfâl 8/2). */
  sure?: string;
  ayet?: string;
  /** Kitâb-ı Mukaddes: book abbreviation, bab in `bab`, cümle ("Yar.", "1", "12" → Yar.1:12). */
  kitap?: string;
  cumle?: string;
  "author-only"?: boolean;
}

export interface StoredCitation {
  items: CiteRef[];
  /** Text written by hand over the generated text; kept on refresh when set. */
  override?: string;
}

/** Everything the document keeps, so it renders without the library. */
export interface DocState {
  v: 1;
  style: string;
  locale: string;
  /** Cited works (Derkenar/Zotero item data), so the document renders without the library. */
  items: Record<string, import("./zotero.js").Item>;
  citations: Record<string, StoredCitation>;
  /** Last rendered HTML per citation; only changed citations are rewritten. */
  rendered: Record<string, string>;
  bibliographyHtml?: string;
  /** "footnote" (default) or "endnote" for note styles. */
  notes?: "footnote" | "endnote";
  /** Re-render automatically when citations move, appear or disappear (default on). */
  auto?: boolean;
  /** Heading put above a new bibliography ("Kaynakça"); empty string: no heading. */
  bibTitle?: string;
}

/** Formatted run of text produced from citeproc HTML. */
export interface Segment {
  text: string;
  italic?: boolean;
  bold?: boolean;
  smallCaps?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  underline?: boolean;
}

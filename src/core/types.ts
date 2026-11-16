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

/** Library entry: the CSL item plus what the pane needs to find it. */
export interface LibraryItem {
  readonly key: string;
  readonly csl: CslItem;
  /** Where the item came from: "zotero:users/123", "file:refs.bib", "doi", "manual". */
  readonly source: string;
  readonly collections?: readonly string[];
  readonly tags?: readonly string[];
  readonly version?: number;
}

/** One cited work inside a citation, as stored in the document. */
export interface CiteRef {
  id: string;
  locator?: string;
  /** CSL locator label: page, chapter, volume, folio, … (default page). */
  label?: string;
  prefix?: string;
  suffix?: string;
  "suppress-author"?: boolean;
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
  items: Record<string, CslItem>;
  citations: Record<string, StoredCitation>;
  /** Last rendered HTML per citation; only changed citations are rewritten. */
  rendered: Record<string, string>;
  bibliographyHtml?: string;
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

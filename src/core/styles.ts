/** Styles published with the add-in (data/styles, CC BY-SA 3.0, citation-style-language/styles). */
export interface BuiltinStyle {
  readonly id: string;
  readonly title: string;
  readonly note: boolean;
}

export const BUILTIN_STYLES: readonly BuiltinStyle[] = [
  { id: "isnad-dipnotlu", title: "İSNAD 2 (dipnotlu)", note: true },
  { id: "isnad-metinici", title: "İSNAD 2 (metin içi)", note: false },
  { id: "apa", title: "APA 7", note: false },
  { id: "chicago-notes-bibliography", title: "Chicago 18 (dipnot)", note: true },
  { id: "chicago-author-date", title: "Chicago 18 (yazar-tarih)", note: false },
  { id: "modern-language-association", title: "MLA 9", note: false },
  { id: "harvard-cite-them-right", title: "Harvard (Cite Them Right)", note: false },
  { id: "ieee", title: "IEEE", note: false },
];

export const LOCALES = ["tr-TR", "en-US"] as const;

/** Styles published with the add-in (data/styles, CC BY-SA 3.0, citation-style-language/styles). İSNAD first; APA and Chicago with their own rules (Künye's İSNAD rules apply to İSNAD only). */
export interface BuiltinStyle {
  readonly id: string;
  readonly title: string;
  readonly note: boolean;
}

export const BUILTIN_STYLES: readonly BuiltinStyle[] = [
  { id: "isnad-dipnotlu", title: "İSNAD 2 (dipnotlu)", note: true },
  { id: "isnad-metinici", title: "İSNAD 2 (metin içi)", note: false },
  { id: "apa", title: "APA 7 (metin içi)", note: false },
  { id: "chicago-notes-bibliography", title: "Chicago 18 (dipnotlu)", note: true },
];

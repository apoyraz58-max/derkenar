/** Styles published with the add-in (data/styles, CC BY-SA 3.0, citation-style-language/styles). İSNAD first; others later. */
export interface BuiltinStyle {
  readonly id: string;
  readonly title: string;
  readonly note: boolean;
}

export const BUILTIN_STYLES: readonly BuiltinStyle[] = [
  { id: "isnad-dipnotlu", title: "İSNAD 2 (dipnotlu)", note: true },
  { id: "isnad-metinici", title: "İSNAD 2 (metin içi)", note: false },
];

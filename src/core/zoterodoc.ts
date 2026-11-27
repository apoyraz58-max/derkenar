/**
 * Documents written with Zotero's Word plugin: each citation is a Word field
 *   ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":…,"citationItems":[{"uris":[…/items/ABCD1234],"itemData":{…CSL…},"locator":"45","label":"page","prefix":"bk.",…}],"properties":{"plainCitation":…,"noteIndex":1}}
 * and the bibliography a field "ADDIN ZOTERO_BIBL {…} CSL_BIBLIOGRAPHY".
 * Everything a Künye citation needs is in the field: the works (with their
 * Zotero keys and full CSL data), pages, prefixes.
 */
import type { CiteRef, CslItem } from "./types.js";

export interface ZoteroFieldWork {
  /** Zotero item key (the last part of the item's URI), when there is one. */
  readonly key?: string;
  readonly data: CslItem;
  readonly ref: Omit<CiteRef, "id">;
}

export type ZoteroField =
  | { readonly kind: "citation"; readonly works: ZoteroFieldWork[]; readonly text: string; readonly noteIndex: number }
  | { readonly kind: "bibliography" };

export function isZoteroFieldCode(code: string): boolean {
  return /ADDIN\s+ZOTERO_(ITEM|BIBL)/.test(code);
}

/** The JSON in a field code (from the first "{" to its matching "}"). */
function jsonIn(code: string): unknown {
  const start = code.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < code.length; i++) {
    const ch = code[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(code.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface ZCitation {
  citationItems?: {
    uris?: string[];
    uri?: string[];
    itemData?: CslItem;
    locator?: string;
    label?: string;
    prefix?: string;
    suffix?: string;
    "suppress-author"?: boolean;
  }[];
  properties?: { plainCitation?: string; formattedCitation?: string; noteIndex?: number };
}

export function parseZoteroField(code: string): ZoteroField | null {
  if (/ADDIN\s+ZOTERO_BIBL/.test(code)) return { kind: "bibliography" };
  if (!/ADDIN\s+ZOTERO_ITEM/.test(code)) return null;
  const json = jsonIn(code) as ZCitation | null;
  if (!json?.citationItems?.length) return null;
  const works: ZoteroFieldWork[] = json.citationItems.flatMap((ci) => {
    if (!ci.itemData) return [];
    const uri = (ci.uris ?? ci.uri ?? [])[0] ?? "";
    const key = /\/items\/([A-Z0-9]{8})$/i.exec(uri)?.[1];
    const ref: Omit<CiteRef, "id"> & Record<string, unknown> = {};
    // İSNAD's "1/45": a cilt and a page.
    const loc = ci.locator?.trim();
    const label = ci.label && ci.label !== "page" ? ci.label : undefined;
    const slash = loc && !label ? /^(\d+)\/(.+)$/.exec(loc) : null;
    if (slash) {
      ref.volume = slash[1];
      ref.locator = slash[2];
    } else if (loc) ref.locator = loc;
    if (label) ref.label = label;
    if (ci.prefix) ref.prefix = ci.prefix;
    if (ci.suffix) ref.suffix = ci.suffix;
    if (ci["suppress-author"]) ref["suppress-author"] = true;
    return [{ ...(key ? { key: key.toUpperCase() } : {}), data: ci.itemData, ref }];
  });
  if (!works.length) return null;
  return { kind: "citation", works, text: json.properties?.plainCitation ?? "", noteIndex: json.properties?.noteIndex ?? 0 };
}

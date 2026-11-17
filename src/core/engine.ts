/**
 * Thin wrapper around citeproc-js, the CSL processor Zotero itself uses.
 * One Renderer per (style, locale); items are swapped in without rebuilding it.
 */
import CSL from "citeproc";
import { composeLocator } from "./isnadmodes.js";
import type { CiteRef, CslItem } from "./types.js";

export interface StyleMeta {
  readonly title: string;
  readonly note: boolean;
  readonly defaultLocale?: string;
  readonly hasBibliography: boolean;
  /** An İSNAD style: Derkenar's İSNAD rules (a.mlf., b.y./y.y., output tidying) apply only to these. */
  readonly isnad: boolean;
}

export function styleMeta(xml: string): StyleMeta {
  const title = /<title>([^<]*)<\/title>/.exec(xml)?.[1]?.trim() ?? "Adsız stil";
  const cls = /<style\b[^>]*\bclass="([^"]+)"/.exec(xml)?.[1];
  const defaultLocale = /<style\b[^>]*\bdefault-locale="([^"]+)"/.exec(xml)?.[1];
  return { title: decodeXml(title), note: cls === "note", defaultLocale, hasBibliography: /<bibliography\b/.test(xml), isnad: /İSNAD|ISNAD/i.test(title) };
}

function decodeXml(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** A citation in document order. noteIndex: footnote number (1…), 0 in the body. */
export interface OrderedCitation {
  readonly id: string;
  readonly items: readonly CiteRef[];
  readonly noteIndex: number;
}

export interface Bibliography {
  /** heading: a section title ("Kitaplar") when the bibliography is divided by kind. */
  readonly entries: { readonly ids: string[]; readonly html: string; readonly heading?: boolean }[];
  readonly hangingIndent: boolean;
  readonly lineSpacing: number;
  readonly entrySpacing: number;
  readonly secondFieldAlign: boolean;
}

export const MISSING = "[Kaynak bulunamadı]";

type Locales = (lang: string) => string | undefined;

interface Engine {
  opt: { development_extensions: Record<string, boolean>; xclass?: string };
  rebuildProcessorState(citations: unknown[], mode: string, uncited?: string[]): [string, number, string][];
  makeBibliography(): false | [Record<string, unknown>, string[]];
  previewCitationCluster(citation: unknown, pre: unknown[], post: unknown[], mode: string): string;
  updateItems(ids: string[]): void;
}

export class Renderer {
  readonly meta: StyleMeta;
  private items: Record<string, CslItem> = {};
  private readonly engine: Engine;

  private readonly lang: string;

  /** The language the citations are written in ("tr-TR", "en-US"). */
  get language(): string {
    return this.lang;
  }

  constructor(styleXml: string, locales: Locales, lang?: string) {
    this.meta = styleMeta(styleXml);
    this.lang = lang ?? this.meta.defaultLocale ?? "tr-TR";
    const sys = {
      retrieveLocale: (l: string) => locales(l) ?? locales(l.split("-")[0] ?? l) ?? locales("en-US"),
      retrieveItem: (id: string) => this.items[id] ?? { id, type: "document", title: MISSING },
    };
    const Engine = (CSL as unknown as { Engine: new (...args: unknown[]) => Engine }).Engine;
    this.engine = new Engine(sys, styleXml, lang ?? this.meta.defaultLocale ?? "tr-TR", true);
    this.engine.opt.development_extensions.wrap_url_and_doi = false;
  }

  setItems(items: Record<string, CslItem>): void {
    this.items = {};
    for (const [id, item] of Object.entries(items)) this.items[id] = { ...item, id };
  }

  /** Renders every citation, in order, so ibid./short forms come out right. Returns id → HTML. */
  renderCitations(citations: readonly OrderedCitation[], uncited: readonly string[] = []): Map<string, string> {
    const input = citations.map((c) => ({
      citationID: c.id,
      citationItems: c.items.map((r, i) => this.citeItem(r, i === 0)),
      properties: { noteIndex: c.noteIndex },
    }));
    const out = new Map<string, string>();
    for (const [id, , html] of this.engine.rebuildProcessorState(input, "html", [...uncited])) out.set(id, this.tidy(html));
    return out;
  }

  /** What a new citation would look like (does not change the processor state). */
  preview(refs: readonly CiteRef[], noteIndex = 1): string {
    const citation = { citationItems: refs.map((r, i) => this.citeItem(r, i === 0)), properties: { noteIndex } };
    return this.tidy(this.engine.previewCitationCluster(citation, [], [], "html"));
  }

  /**
   * Cilt and sayfa: İSNAD writes "1/45"; a note style otherwise "1:45"
   * (Chicago); an in-text style "Cilt 1, s. 45" (APA).
   */
  private citeItem(r: CiteRef, first = false): Record<string, unknown> {
    const item = toCiteItem(r, this.lang);
    // A footnote starts a sentence: "Bk. Gazzâlî, …" (the user types "bk.").
    if (first && this.meta.note && typeof item.prefix === "string") item.prefix = item.prefix.replace(/^(\s*)(\p{Ll})/u, (_, sp: string, c: string) => sp + c.toLocaleUpperCase("tr"));
    const vol = r.volume?.trim();
    if (this.meta.isnad || !vol || !r.locator || (r.label ?? "page") !== "page" || composeLocator(r)) return item;
    if (this.meta.note) item.locator = `${vol}:${r.locator}`;
    else {
      item.locator = `${vol}, ${/^en/.test(this.lang) ? "p." : "s."} ${r.locator}`;
      item.label = "volume";
    }
    return item;
  }

  private tidy(html: string): string {
    return this.meta.isnad ? isnadTidy(html) : html;
  }

  /** Bibliography of the works cited by the last renderCitations; null when the style has none. */
  bibliography(): Bibliography | null {
    if (!this.meta.hasBibliography) return null;
    const result = this.engine.makeBibliography();
    if (!result) return null;
    const [params, entries] = result;
    const ids = (params.entry_ids as string[][]) ?? [];
    // İSNAD: several entries of one dictionary are one bibliography line (madde names are not listed).
    const seen = new Set<string>();
    // İSNAD keeps the period after a title ending in ? or ! ("Nedir?”. Sabah", guide s. 112).
    const keepPeriod = (h: string) => h.replace(/([?!])”(\s|&#160;)(?=[\p{Lu}<])/gu, "$1”.$2");
    const unique = entries.map((html, i) => ({ ids: ids[i] ?? [], html: this.meta.isnad ? keepPeriod(isnadTidy(stripArticle(html))) : html })).filter((e) => {
      const k = e.html.replace(/\s+/g, " ").trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return {
      entries: unique,
      hangingIndent: Boolean(params.hangingindent),
      lineSpacing: Number(params.linespacing) || 1,
      entrySpacing: Number(params.entryspacing) || 0,
      secondFieldAlign: Boolean(params["second-field-align"]),
    };
  }
}

/**
 * İSNAD: no comma before a parenthesis ("…Defteri (1334-1336), 61a", guide s. 67).
 */
export function isnadTidy(html: string): string {
  return html.replace(/,(\s|&#160;)+\(/g, " (").replace(/,(\s|&#160;)*\./g, ".");
}

/**
 * In the bibliography the Arabic article written at the end of the given
 * name (İSNAD's Zotero rule: "Buhârî, Ebû Abdillâh Muhammed b. İsmail el-")
 * is dropped: "Buhârî, Ebû Abdillâh Muhammed b. İsmail." (guide s. 87).
 */
export function stripArticle(html: string): string {
  return html.replace(/\s(?:[ae][lrsztdnş]|eş|ed|el)-(?=\.)/gu, "");
}

function toCiteItem(r: CiteRef, lang = "tr-TR"): Record<string, unknown> {
  const item: Record<string, unknown> = { id: r.id };
  const special = composeLocator(r, lang);
  if (special) {
    if (special.locator) item.locator = special.locator;
    if (special.label) item.label = special.label;
    if (r.prefix) item.prefix = r.prefix;
    if (r.suffix) item.suffix = r.suffix;
    if (r["suppress-author"]) item["suppress-author"] = true;
    return item;
  }
  const vol = r.volume?.trim();
  if (vol && r.locator && (r.label ?? "page") === "page") {
    item.locator = `${vol}/${r.locator}`;
    item.label = "page";
  } else if (r.locator) {
    item.locator = vol ? `${vol}/${r.locator}` : r.locator;
    item.label = r.label ?? "page";
  } else if (vol) {
    item.locator = vol;
    item.label = "volume";
  }
  if (r.prefix) item.prefix = r.prefix;
  if (r.suffix) item.suffix = r.suffix;
  if (r["suppress-author"]) item["suppress-author"] = true;
  if (r["author-only"]) item["author-only"] = true;
  return item;
}

/** CSL locator labels offered in the pane, Turkish names. */
export const LOCATOR_LABELS: readonly (readonly [string, string])[] = [
  ["page", "Sayfa"],
  ["volume", "Cilt"],
  ["chapter", "Bölüm"],
  ["folio", "Varak"],
  ["section", "Kısım"],
  ["sub verbo", "Madde (md.)"],
  ["paragraph", "Paragraf"],
  ["line", "Satır"],
  ["number", "Numara"],
  ["verse", "Ayet / Beyit"],
  ["column", "Sütun"],
  ["figure", "Şekil"],
  ["note", "Not"],
];

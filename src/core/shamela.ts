/**
 * Şamile kataloğu: the books of el-Mektebetü’ş-Şâmile as İSNAD records.
 *
 * The catalog is prepared outside the add-in from Şamile's own database and
 * the user's Şahıslar table, and imported once (like the Şahıslar table; it
 * is not bundled). Each entry keeps:
 *   - the title as Şamile names the book, written in DİA's transcription,
 *     and its plain form ("Câmiu’s-sahîh") for documents that want it;
 *   - the authors with their DİA name where the Şahıslar table knows them;
 *   - where it came from (Şamile and the book's number there), so that
 *     records taken from other programs later are told apart.
 */
import { diaParts, type Person } from "./persons.js";
import { shortTitleOf } from "./isnadstyle.js";
import { type Creator, type Item, emptyItem } from "./zotero.js";

export interface CatalogAuthor {
  /** DİA short name ("Gazzâlî", "İbn Kayyim el-Cevziyye"), when the Şahıslar table knows the person. */
  dia?: string | null;
  diaFull?: string | null;
  group?: string | null;
  /** The name as Şamile writes it (Arabic). */
  shamela: string;
  /** The name in İSNAD transcription, for persons DİA has no article on. */
  name?: string | null;
  death?: number | null;
  match?: string;
}

export interface CatalogEntry {
  /** The book's number in Şamile. */
  id: number;
  /** Şamile's title (Arabic, with its own notes). */
  ar: string;
  /** The title in DİA's transcription ("el-Muṣannef"). */
  title: string;
  /** The same without the transcription marks ("el-Musannef"). */
  plain: string;
  authors: CatalogAuthor[];
  /** Muhakkik and edition as far as Şamile's title tells (a hint until the book card is read). */
  thk?: string | null;
  ed?: string | null;
  /** Which of two same-named books this is, as Şamile tells them apart (the commentator, the edition). */
  note?: string | null;
  /** From the book card (بطاقة الكتاب): the print's place (İSNAD's spelling: "Beyrut"), year ("1413/1992"), edition (2, 3 …; the first is not written), volumes. */
  place?: string | null;
  date?: string | null;
  edition?: number | null;
  volumes?: number | null;
  /** A thesis: the university and the degree ("Yüksek Lisans Tezi", "Doktora Tezi"). */
  university?: string | null;
  thesisType?: string | null;
  /** An article in a journal issue (the card's edition line is "السنة ٣٤ - العدد ١١٥"): the journal, its volume (السنة) and issue (العدد). */
  /** An entry taken from another source than the catalog's own (OpenITI), and its identifier there ("0255Jahiz.Bayan"). */
  catalog?: string | null;
  ref?: string | null;
  journal?: string | null;
  volume?: string | null;
  issue?: string | null;
  category?: string | null;
  /** What still wants a look. */
  review?: string[];
}

export interface Catalog {
  /** "el-Mektebetü’ş-Şâmile" … */
  name: string;
  /** When and from what it was made. */
  source: string;
  entries: CatalogEntry[];
}

/** The source program, written into every record taken from it. */
export const SHAMELA = "el-Mektebetü’ş-Şâmile";

function creatorOf(a: CatalogAuthor): Creator | null {
  if (a.dia) {
    const p: Person = { dia: a.dia, diaFull: a.diaFull ?? undefined, ei3: "", group: a.group ?? "Arap" };
    const { surname, given, article } = diaParts(p);
    const firstName = `${given}${article ? ` ${article}` : ""}`.trim();
    return { creatorType: "author", lastName: surname, ...(firstName ? { firstName } : {}) };
  }
  if (a.name) return { creatorType: "author", name: a.name };
  return null;
}

/** A catalog entry as an İSNAD record: transcribed title (the plain form goes with it), DİA names, its source. */
export function catalogItem(e: CatalogEntry, catalog = SHAMELA): Item {
  catalog = e.catalog || catalog;
  const item = emptyItem(e.journal ? "journalArticle" : e.university ? "thesis" : "book", "samile");
  item.fields.title = e.title;
  const short = shortTitleOf(e.title);
  if (short && short !== e.title) item.fields.shortTitle = short;
  item.fields.language = "ar";
  for (const a of e.authors) {
    const c = creatorOf(a);
    if (c) item.creators.push(c);
  }
  // Several muhakkiks are written one by one ("A; B").
  for (const name of (e.thk ?? "").split(/\s*;\s*/).filter(Boolean)) item.creators.push({ creatorType: "muhakkik", name });
  if (e.journal) {
    item.fields.publicationTitle = e.journal;
    if (e.volume) item.fields.volume = e.volume;
    if (e.issue) item.fields.issue = e.issue;
  } else if (e.university) {
    item.fields.university = e.university;
    if (e.thesisType) item.fields.thesisType = e.thesisType;
  } else if (e.ed) item.fields.publisher = e.ed;
  if (e.place && !e.journal) item.fields.place = e.place;
  if (e.date) item.fields.date = e.date;
  if (e.edition && e.edition > 1) item.fields.edition = String(e.edition);
  if (e.volumes && e.volumes > 1) item.fields.numberOfVolumes = String(e.volumes);
  item.fields.libraryCatalog = catalog;
  item.fields.extra = [`Kaynak: ${catalog}, kitap no. ${e.ref || e.id}`, `Kaynak adı: ${e.ar}`, `Transkripsiyonsuz başlık: ${e.plain}`, ...(e.review?.length ? [`Kontrol: ${e.review.join("; ")}`] : [])].join("\n");
  return item;
}

/** Where a record came from, when it came from a catalog ("el-Mektebetü’ş-Şâmile, kitap no. 1234"). */
export function catalogSource(item: Item): { catalog: string; id: string } | null {
  const m = /^Kaynak: (.+?), kitap no\. (\S+)$/m.exec(item.fields.extra ?? "");
  return m ? { catalog: m[1]!, id: m[2]! } : null;
}

// ---------------------------------------------------------------- searching the catalog

/** Arabic for searching: no vowel signs, one alif, yā and tā marbūṭa as plain letters. */
const arabicKey = (s: string) =>
  s
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^؀-ۿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Latin for searching: no marks, no ayn or hamza, no article ("ʿUmdetü’l-ḳārî" → "umdetul kari"). */
const latinKey = (s: string) =>
  s
    .replace(/[İIı]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ʿʾ‘’'`]/g, "")
    .replace(/(^|\s)(el|er|ez|es|es|en|et|ed|al)-/g, "$1")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const keys = new WeakMap<CatalogEntry, string>();
function keyOf(e: CatalogEntry): string {
  let k = keys.get(e);
  if (k === undefined) {
    k = ` ${latinKey(`${e.title} ${e.plain} ${e.authors.map((a) => `${a.dia ?? ""} ${a.name ?? ""}`).join(" ")}`)} ${arabicKey(`${e.ar} ${e.authors.map((a) => a.shamela).join(" ")}`)} `;
    keys.set(e, k);
  }
  return k;
}

/**
 * Books of the catalog for a search: every word of the query, in Latin letters (with or without
 * the marks: "umdetul kari", "Aynî umde") or Arabic ("عمدة القاري"), begins a word of the entry.
 */
export function searchCatalog(q: string, catalog: Catalog, limit = 8): CatalogEntry[] {
  const words = [...latinKey(q).split(" "), ...arabicKey(q).split(" ")].filter((w) => w.length >= 2);
  if (!words.length) return [];
  const out: CatalogEntry[] = [];
  for (const e of catalog.entries) {
    const k = keyOf(e);
    if (words.every((w) => k.includes(` ${w}`))) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

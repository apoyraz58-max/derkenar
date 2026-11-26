import { createHash } from "node:crypto";
import { isbnForms } from "../core/isbn.js";
import { foldText, isnadPlace, isnadTitle, isTurkishPlace } from "../core/isnadstyle.js";
import { creatorFull, type Creator } from "../core/zotero.js";

export interface Claim {
  field: string;
  value: string;
  path: string;
}

export interface Attribution {
  creator: Creator;
  path: string;
  kind?: "person" | "organization";
}

export interface RecordInput {
  id: string;
  url: string;
  raw: string;
  fields: Claim[];
  creators: Attribution[];
}

export interface Source {
  name: string;
  license: string;
  policy: string;
  priority: number;
}

export const SOURCES = {
  ttk: { name: "Türk Tarih Kurumu Kütüphanesi", license: "Elle doğrulanmış pilot künyeleri", policy: "https://kutuphane.ttk.gov.tr/", priority: 80 },
  asbu: { name: "ASBÜ KKTC Kütüphanesi", license: "Elle doğrulanmış pilot künyeleri", policy: "https://katalogkktc.asbu.edu.tr/", priority: 65 },
  k10plus: { name: "K10plus", license: "CC0 1.0", policy: "https://wiki.k10plus.de/display/K10PLUS/K10plus+Open+Data", priority: 75 },
  ozgur: { name: "Özgür Yayınları", license: "Yayınevinin katalog aktarım izni", policy: "https://www.ozguryayinlari.com/site/tr/libraries", priority: 78 },
  "ozgur-kunye": { name: "Özgür Yayınları (kitap künyeleri)", license: "Elle doğrulanmış bibliyografik alanlar", policy: "https://www.ozguryayinlari.com/site/tr/libraries", priority: 82 },
  "ozgur-kbart": { name: "Özgür Yayınları (KBART)", license: "Yayınevinin katalog aktarım izni", policy: "https://www.ozguryayinlari.com/site/tr/libraries", priority: 60 },
  crossref: { name: "Crossref (Türkiye konumlu üyeler)", license: "Crossref üstverisi, yeniden kullanıma açık", policy: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/", priority: 68 },
  doab: { name: "Directory of Open Access Books", license: "CC0 1.0 (üstveri)", policy: "https://www.doabooks.org/en/librarians/doab-metadata", priority: 70 },
  openlibrary: { name: "Open Library", license: "Internet Archive yeni hak ileri sürmez, mevcut katkı hakları saklıdır", policy: "https://openlibrary.org/developers/licensing", priority: 45 },
  exchange: { name: "Kullanıcı dosyası", license: "Kullanıcının sağladığı dosya", policy: "https://www.zotero.org/support/dev/data_formats", priority: 35 },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const textValue = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function validIsbn(value: string): string | null {
  const isbn = value.replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "").replace(/[\s\p{Pd}]/gu, "").toUpperCase();
  if (/^\d{9}[0-9X]$/.test(isbn)) {
    const sum = [...isbn].reduce((n, digit, i) => n + (digit === "X" ? 10 : Number(digit)) * (10 - i), 0);
    return sum % 11 === 0 ? isbnForms(isbn)[0]! : null;
  }
  if (!/^97[89]\d{10}$/.test(isbn)) return null;
  const sum = [...isbn].reduce((n, digit, i) => n + Number(digit) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0 ? isbn : null;
}

export function equivalent(value: string): string {
  return value.replace(/[ıİI]/g, "i").toLowerCase().normalize("NFD")
    .replace(/\p{M}+/gu, "").replace(/[ʿʾ‘’'`´.]/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function cleanClaim(claim: Claim): Claim {
  const value = claim.value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (claim.field === "title") return { ...claim, value: isnadTitle(value) };
  if (claim.field === "place") return { ...claim, value: isnadPlace(value) };
  if (claim.field === "country" && /^(TR|TUR|Türkiye|Turkey|XB-TR|tu)$/i.test(value)) return { ...claim, value: "TR" };
  if (claim.field === "language") {
    const aliases: Record<string,string> = {tur:"tr", turkish:"tr", eng:"en", english:"en", "turkish-english":"tr, en", ara:"ar", ota:"ota", fra:"fr", fre:"fr", ger:"de", deu:"de", per:"fa", fas:"fa", türkçe:"tr", arapça:"ar", "osmanlı türkçesi":"ota", ingilizce:"en"};
    return { ...claim, value: value.split(/\s*[,;]\s*/).map(language => aliases[language.toLocaleLowerCase("tr")] ?? language).join(", ") };
  }
  if (claim.field === "date") return { ...claim, value: value.replace(/^©\s*(?=\d{4}$)/, "") };
  if (claim.field === "edition") {
    const ordinals: Record<string, string> = {birinci:"1", ikinci:"2", üçüncü:"3", dördüncü:"4", beşinci:"5", altıncı:"6", yedinci:"7", sekizinci:"8", dokuzuncu:"9", onuncu:"10", ilk:"1"};
    const word = /^(\p{L}+)\s+(?:baskı|basım)\.?$/iu.exec(value)?.[1]?.toLocaleLowerCase("tr");
    if (word && ordinals[word]) return { ...claim, value: ordinals[word] };
    const number = /^(?:([1-9]\d*)\.?\s*(?:baskı|basım|ed\.?|edition)?|([1-9]\d*)\s*(?:st|nd|rd|th)\s+ed(?:ition)?\.?)$/i.exec(value);
    return { ...claim, value: number?.[1] ?? number?.[2] ?? value };
  }
  if (claim.field === "format") {
    if (/^(paperback|softcover|karton kapak)$/i.test(value)) return { ...claim, value: "Paperback" };
    if (/^(hardcover|hardback|ciltli)$/i.test(value)) return { ...claim, value: "Hardcover" };
    if (/^(basılı|print|matbu|cilt)$/i.test(value)) return { ...claim, value: "Basılı" };
    if (/^epub$/i.test(value)) return { ...claim, value: "Epub" };
    if (/^pdf$/i.test(value)) return { ...claim, value: "PDF" };
  }
  return { ...claim, value };
}

/** Historical and foreign-language names of places inside today's Türkiye, used only as scope evidence. */
const HISTORICAL_TR_PLACES = new Set([
  "konstantinopel", "constantinopel", "constantinople", "konstantinopolis", "constantinopolis", "costantinopoli",
  "stambul", "istanbol", "dersaadet", "der i saadet", "der saadet", "dersaadet istanbul", "asitane", "dar ul hilafe",
  "kostantiniyye", "kustantiniyye", "konstantiniyye", "galata", "pera", "uskudar", "kadikoy", "beyoglu",
  "smyrna", "smyrne", "angora", "adrianopel", "adrianople", "trapezunt", "trebizond", "brussa", "brousse",
  "turkiye", "turkey", "turkei", "turquie", "turchia", "turkiya", "turkiyä",
  "kostantiniye", "qostantiniye", "qustantiniye", "kustantiniye", "qostandina", "qonstantinopla", "konstantinupolis",
  "en smyrne", "en konstantinoupolei", "konstantinoupolis", "kostandiniye",
]);
const placeKey = (value: string) => foldText(value).replace(/-/g, " ").replace(/\s+/g, " ").trim();
const turkishPart = (value: string) => isTurkishPlace(value) || HISTORICAL_TR_PLACES.has(placeKey(value));

/**
 * Whether an imprint place shows publication inside Türkiye. Accepts several
 * places ("Ankara ; Berlin", "İstanbul [u.a.]") when one of them is Turkish.
 * The selected place value and its İSNAD rendering are not changed.
 */
export function turkeyPlace(place: string): boolean {
  // "İst[anbul]", "Dersaadet [d.i. İstanbul]", "Der-i Saʻādet [i.e. İstanbul]": cataloguer additions in brackets.
  const notes = [...place.matchAll(/\[(?:=|d\.\s?i\.|i\.\s?e\.|that is)?\s*([^\]]+)\]/gi)].map(m => m[1]!);
  return [place, place.replace(/[[\]()]/g, ""), ...notes].some(candidate => turkeyPlaceText(candidate));
}

function turkeyPlaceText(place: string): boolean {
  const parts = place.replace(/\[?\b(?:u\.\s?a\.|usw\.|etc\.|vd\.|et al\.)\]?/gi, "")
    .split(/\s*[;|]\s*|\s+(?:und|and|ve|et)\s+/i).map(p => p.replace(/^\[|\]$/g, "").replace(/\s*:.*$/, "").trim()).filter(Boolean);
  // "Sarıyer/Istanbul", "Kadıköy-Istanbul", "Imak, Istanbul": district or publisher before the city.
  return parts.some(p => turkishPart(p) || p.split(/\s*[/,]\s*|\s+-\s+|(?<=\p{L})-(?=\p{Lu})/u).some(turkishPart));
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const ORDINAL_WORDS: Record<string, number> = { birinci: 1, ilk: 1, ikinci: 2, ucuncu: 3, dorduncu: 4, besinci: 5, altinci: 6,
  yedinci: 7, sekizinci: 8, dokuzuncu: 9, onuncu: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const EDITION_WORD = "(?:bas[ıi]m|bask[ıi]|tab[ıi]|aufl(?:age)?|aufl\\.|ed(?:ition|ition\\.|\\.)?|[çc]ap)(?![\\p{L}])";

/**
 * Edition number stated in a source's edition statement: "2", "2. baskı",
 * "Gözden geçirilmiş 2. baskı", "II. basım", "ikinci baskı", "3. Aufl.".
 * Anything else ("Çapa ewil", "Genişletilmiş baskı") stays unknown.
 */
export function parseEditionNumber(value: string): string | undefined {
  const text = value.trim();
  if (/^\d+$/.test(text)) return String(Number(text));
  const digits = new RegExp(`(?:^|\\s)(\\d+)\\s*\\.?\\s*${EDITION_WORD}`, "iu").exec(text);
  if (digits) return String(Number(digits[1]));
  const roman = new RegExp(`(?:^|\\s)([IVXLC]+)\\s*\\.\\s*${EDITION_WORD}`, "iu").exec(text);
  if (roman && roman[1] === roman[1]!.toUpperCase()) {
    const n = [...roman[1]!].reduce((sum, ch, i, all) => {
      const v = ROMAN[ch]!, next = ROMAN[all[i + 1] ?? ""] ?? 0;
      return sum + (v < next ? -v : v);
    }, 0);
    if (n > 0 && n < 200) return String(n);
  }
  const word = new RegExp(`(?:^|\\s)(\\p{L}+)\\s+${EDITION_WORD}`, "iu").exec(text);
  const ordinal = word ? ORDINAL_WORDS[foldText(word[1]!)] : undefined;
  return ordinal ? String(ordinal) : undefined;
}

export function publicationScope(fields: Record<string, string>): "TR" | "outside" | "unknown" | "conflict" {
  const turkish = turkeyPlace(fields.place ?? "") || turkeyPlace(fields.otherPlaces ?? "");
  if (fields.country === "TR") return "TR";
  if (fields.country && turkish) return "conflict";
  if (fields.country) return "outside";
  if (turkish) return "TR";
  return "unknown";
}

export function authorKey(creators: readonly Creator[]): string {
  return creators.filter(c => c.creatorType === "author").map(c => equivalent(creatorFull(c))).filter(Boolean).join("|");
}

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

/** A chapter or other part of a book; stored apart from editions. */
export interface PartInput {
  doi: string;
  title: string;
  creators: Creator[];
  pages: string;
  containerTitle: string;
  containerIsbns: string[];
  url: string;
  raw: string;
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
  dnb: { name: "Deutsche Nationalbibliothek", license: "CC0 1.0", policy: "https://www.dnb.de/EN/Professionell/Metadatendienste/Datenbezug/datenbezug_node.html", priority: 74 },
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

// Cataloguers' "unknown" markers are not publisher or place evidence ("Verlag nicht ermittelbar", "[s.n.]", "y.y.").
const PLACEHOLDER = /\$?n?\[?(?<![\p{L}])(?:(?:kein\s+)?(?:verlag(?:sname)?|ort|erscheinungsort)\s+(?:nicht\s+)?ermittelbar|s\.\s?n\.?|s\.\s?l\.?|sine\s+(?:nomine|loco)|publisher\s+not\s+identified|place\s+of\s+publication\s+not\s+identified|y\.\s?y\.?|yayınevi\s+yok|yer\s+yok)(?![\p{L}])\]?/giu;

export function withoutPlaceholder(value: string): string {
  return value.replace(PLACEHOLDER, " ").replace(/^[\s:;,/\[\]]+|[\s:;,/\[]+$/gu, "").replace(/\s+/gu, " ").trim();
}

export function cleanClaim(claim: Claim): Claim {
  let value = claim.value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (claim.field === "publisher" || claim.field === "place" || claim.field === "otherPlaces") value = withoutPlaceholder(value);
  // Ottoman calendar notes cut short in the source ("1343 [h", "1341 ([māl.]"): close the bracket, keep the note.
  if (claim.field === "date") value = value.replace(/\(\s*\[/g, "[").replace(/\[([^\]]*)$/, (_, note: string) => `[${note.replace(/[\s.(]+$/, "")}]`);
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
  "stambul", "istanbol", "dersaadet", "derseadet", "der i saadet", "der saadet", "dersaadet istanbul", "asitane", "dar ul hilafe",
  "kostantiniyye", "kustantiniyye", "konstantiniyye", "galata", "pera", "uskudar", "kadikoy", "beyoglu",
  "smyrna", "smyrne", "angora", "adrianopel", "adrianople", "trapezunt", "trebizond", "brussa", "brousse",
  "turkiye", "turkey", "turkei", "turquie", "turchia", "turkiya", "turkiyä",
  "kostantiniye", "qostantiniye", "qustantiniye", "kustantiniye", "qostandina", "qonstantinopla", "konstantinupolis",
  "en smyrne", "en konstantinoupolei", "konstantinoupolis", "kostandiniye",
  // Armenian, Greek, Arabic and Western spellings of İstanbul and Ankara, and common misspellings.
  "istanpowl", "istanpol", "stanpowl", "istanpoul", "k polis", "kpolis", "en konstantinupolei", "konstantinupolis", "kostandnowpolis",
  "kostandnowpolis", "qustantiniyah", "qustantiniya", "al qustantiniyah", "al qustantiniya", "konstantinoplah", "konstantinopla",
  "stenbol", "stamboul", "constantinopoli", "istambul", "estambul", "jstanbul", "instanbul", "istanbul", "ist", "der i seadet",
  "anakara", "anqara", "ankyra", "engürü", "engurü", "enguru",
  // Towns that are not province names.
  "gebze", "adapazari", "antakya", "iskenderun", "bodrum", "tarsus", "alanya", "lalahan", "eregli", "bandirma", "polatli", "inegol",
  "akhisar", "nazilli", "fethiye", "odemis", "izmit", "golcuk", "corlu", "luleburgaz", "kusadasi", "marmaris", "didim", "silivri",
  "buyukada", "heybeliada", "kartal", "pendik", "bakirkoy", "eyup", "uskudar", "kadikoy", "beyoglu", "cagaloglu", "fatih", "sisli",
  "besiktas", "kizilay", "cankaya", "bornova", "karsiyaka", "mudanya", "gemlik", "safranbolu", "nusaybin", "midyat", "cizre", "silopi",
  "elbistan", "kozan", "ceyhan", "manavgat", "side", "iznik", "bergama", "tire", "urla", "cesme", "seferihisar",
  "carigrad", "konstantinupolei", "stanbol", "istanbu", "brusa", "antioche", "konja", "konija", "kunie", "eskiehir", "anakra", "ancara",
  "amed", "diyar bakr", "diyarbekir", "zmiwrnia", "izmirne", "dinar", "camdibi", "akcaabat", "tavsanli", "payas", "peyas",
]);
const placeKey = (value: string) => foldText(value).replace(/-/g, " ").replace(/\s+/g, " ").trim();
// Northern Cyprus (KKTC) uses Turkish ISBNs and appears in the İSNAD place list, but it is not Türkiye.
const KKTC_PLACES = new Set(["lefkosa", "lefkoşa", "gazimagusa", "magusa", "girne", "guzelyurt", "iskele", "lefke", "kktc", "kibris",
  "nicosia", "famagusta", "kyrenia", "north cyprus", "northern cyprus", "kuzey kibris", "kuzey kibris turk cumhuriyeti"]);
export const kktcPlace = (value: string) => value.split(/\s*[;,/]\s*|\s+-\s+/).some(p => KKTC_PLACES.has(placeKey(p.replace(/[[\]()]/g, ""))));
const turkishPart = (value: string) => !KKTC_PLACES.has(placeKey(value)) && (isTurkishPlace(value) || HISTORICAL_TR_PLACES.has(placeKey(value)));

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
  // "Sarıyer/Istanbul", "Kadıköy-Istanbul", "Imak, Istanbul", "Beyoğlu İstanbul": district or publisher before the city.
  return parts.some(p => turkishPart(p) || p.split(/\s*[/,]\s*|\s+-\s+|(?<=\p{L})-(?=\p{Lu})/u).some(turkishPart) ||
    /\s/.test(p) && turkishPart(p.split(/\s+/).at(-1)!) && isTurkishPlace(p.split(/\s+/).at(-1)!));
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const ORDINAL_WORDS: Record<string, number> = { birinci: 1, ilk: 1, ikinci: 2, ucuncu: 3, dorduncu: 4, besinci: 5, altinci: 6,
  yedinci: 7, sekizinci: 8, dokuzuncu: 9, onuncu: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const EDITION_WORD = "(?:bas(?:[ıi]m|k[ıi]|[ıi])?\\.?|tab[ıi]|auf(?:l(?:age)?)?\\.?|ed(?:ition|ition\\.|\\.)?|[çc]ap)(?![\\p{L}])";

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

const VOLUME_SUFFIX = /^(.+?)\.\s*(?:(?:cilt|c\.|band|bd\.|vol\.?|volume|kitap|kısım)\s*)?(\d{1,3}|[IVXLC]{1,6})(?=$|[\s:(])/iu;

/**
 * Two titles of one multi-volume set: the same base title with different
 * volume designations ("Masonluk Tarihimizde 1920-1924. Cilt 1" / "… Cilt 3",
 * "Rethinking Mosque Architecture. 01" / "… 02").
 */
export function otherVolume(a: string, b: string): boolean {
  const x = VOLUME_SUFFIX.exec(a.trim()), y = VOLUME_SUFFIX.exec(b.trim());
  if (!x || !y) return false;
  const number = (v: string) => /^\d+$/.test(v) ? String(Number(v)) : v.toUpperCase();
  return equivalent(x[1]!) === equivalent(y[1]!) && number(x[2]!) !== number(y[2]!);
}

/**
 * Pre-filter for wide sources: true when the record's own claims point to
 * Türkiye (or conflict about it). Records rejected here are not stored at all,
 * so they neither create editions nor fill the review queue.
 */
export function mayBeTurkish(input: RecordInput): boolean {
  const fields: Record<string, string> = {};
  let turkishCountry = false;
  for (const claim of input.fields.map(cleanClaim)) {
    if (!claim.value) continue;
    fields[claim.field] ??= claim.value;
    if (claim.field === "country" && claim.value === "TR") turkishCountry = true;
  }
  const scope = publicationScope(fields);
  return turkishCountry || scope === "TR" || scope === "conflict";
}

const GENERIC_PUBLISHER = new Set(["yayinlari", "yayinevi", "yayincilik", "yayin", "yayinlar", "yay", "yayinevleri", "neşriyat", "nesriyat",
  "kitabevi", "kitabevleri", "kitap", "kitaplari", "kitaplar", "basimevi", "matbaasi", "matbaa", "publishing", "publications", "publication",
  "publisher", "publishers", "press", "verlag", "ltd", "sti", "as", "tic", "san", "ve", "ltd sti", "a s", "co", "inc",
  // State prefixes: "Türkiye İş Bankası" / "İş Bankası", "T.C. Kültür Bakanlığı" / "Kültür Bakanlığı".
  "turkiye", "tc"]);
const publisherWords = (value: string) => foldText(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

/**
 * Whether two publisher statements name the same publisher once generic
 * words ("Yayınları", "yay.", "Verlag"), diacritics and initialisms ("YKY" /
 * "Yapı Kredi Yayınları") are set aside. Used for comparison only.
 */
export function samePublisher(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  const wa = publisherWords(a), wb = publisherWords(b);
  if (wa.join(" ") === wb.join(" ")) return true;
  const ka = wa.filter(w => !GENERIC_PUBLISHER.has(w)).join(" "), kb = wb.filter(w => !GENERIC_PUBLISHER.has(w)).join(" ");
  if (ka && ka === kb) return true;
  const initials = (words: string[]) => words.map(w => w[0]).join("");
  const acronym = (one: string[], other: string[]) => one.length === 1 && one[0]!.length >= 2 && other.length >= 2 &&
    (one[0] === initials(other) || one[0] === initials(other.filter(w => !GENERIC_PUBLISHER.has(w))));
  return acronym(wa, wb) || acronym(wb, wa);
}

const FOREIGN_PLACES = new Set(["kahire", "cairo", "misir", "bulak", "paris", "berlin", "london", "leipzig", "tahran", "tihran", "teheran",
  "beyrut", "beirut", "sam", "dimask", "damascus", "bagdat", "baghdad", "halep", "aleppo", "kudus", "jerusalem", "selanik", "thessaloniki",
  "sofya", "sofia", "uskup", "skopje", "atina", "athens", "wien", "vienna", "roma", "rome", "new york", "moskva", "moscow", "baku", "bakü",
  "tiflis", "tbilisi", "taskent", "bonn", "munchen", "hamburg", "frankfurt", "koln", "stuttgart", "leiden", "oxford", "cambridge",
  "budapest", "bukres", "bucuresti", "venezia", "venedik", "mekke", "medine", "kum", "tebriz", "isfahan", "lahor", "delhi", "kabil",
  "kairo", "tunus", "tunis", "wiesbaden", "baki", "en petrupolei", "petersburg", "sankt peterburg", "kudus", "iskenderiye", "alexandria"]);
/** A place known to lie outside Türkiye (first part of the imprint place). */
function foreignPlace(place: string): boolean {
  const first = place.split(/\s*[;,/[(]\s*/)[0] ?? "";
  return FOREIGN_PLACES.has(placeKey(isnadPlace(first)));
}

export function publicationScope(fields: Record<string, string>): "TR" | "outside" | "unknown" | "conflict" {
  const turkish = turkeyPlace(fields.place ?? "") || turkeyPlace(fields.otherPlaces ?? "");
  if (fields.country === "TR" && !turkish && kktcPlace(fields.place ?? "")) return "conflict";
  // A country code of Türkiye with a place that is known to be elsewhere ("Kahire", "Paris", "Leipzig") needs review.
  if (fields.country === "TR" && !turkish && foreignPlace(fields.place ?? "")) return "conflict";
  if (fields.country === "TR") return "TR";
  if (fields.country && turkish) return "conflict";
  if (fields.country) return "outside";
  if (turkish) return "TR";
  return "unknown";
}

export function authorKey(creators: readonly Creator[]): string {
  return creators.filter(c => c.creatorType === "author").map(c => equivalent(creatorFull(c))).filter(Boolean).join("|");
}

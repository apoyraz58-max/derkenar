/**
 * İSNAD spelling of the parts of a reference that catalogues get wrong:
 * title case, names, publishers, places, years and short titles.
 *
 * Title case follows the İSNAD guide's own records: Turkish and Western
 * titles capitalise every word except conjunctions ("Kelâm Terimleri
 * Sözlüğü", "Kültür ve Turizm"); transliterated Arabic titles capitalise only
 * the first word, the article staying small ("el-Maḥsûl fî ʿilmi uṣûli’l-fıḳh",
 * "İhyâü ulûmi’d-dîn"). Each part of a title (split at ":") is judged by itself.
 */

const lower = (s: string) => s.toLocaleLowerCase("tr");
const upper = (s: string) => s.toLocaleUpperCase("tr");
const cap = (w: string) => (w ? upper(w.charAt(0)) + w.slice(1) : w);
const sentenceCaseText = (s: string) => lower(s).replace(/^(\s*)(\p{L})/u, (_, sp: string, c: string) => sp + upper(c));

/** Lower case, no diacritics, dotless i folded: for comparing spellings. */
export function foldText(s: string): string {
  return s
    .replace(/[ıİI]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ʿʾ‘’'`´.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ARABIC = /(^|[\s(])(el|er|ez|es|eş|en|et|ed|eẓ|eṣ|eḍ|eṭ|al)-\p{L}|\p{L}[’'ʾ](l|d|t|s|ş|r|z|n|ṭ|ḍ|ṣ|ẓ|ẕ|ẖ)-\p{L}|(^|\s)(fî|fi|li|bi)[’'\s]|[ḥṣṭẓḳḫġżḍāīūʿ]/iu;

/** A transliterated Arabic (or Persian) title part. */
export function isArabicTitle(s: string): boolean {
  return ARABIC.test(s);
}

const SMALL = new Set(["ve", "ile", "veya", "ya", "da", "de", "ki", "mi", "mı", "mu", "mü", "a", "an", "the", "and", "or", "nor", "but", "of", "in", "on", "at", "to", "for", "by", "with", "from", "as", "vs"]);
const IZAFET = /^(ı|i|u|ü|yı|yi|yu|yü)$/;

/** English (or other Western) title part: capitals without the Turkish dotted İ. */
const isWestern = (s: string) => !/[çğışöüâîûÇĞİŞÖÜ]/.test(s) && /\b(the|of|and|in|on|for|with|an?|to)\b/i.test(s);

/** German, French … titles follow their own rules: left as they are. */
const isOtherWestern = (s: string) => !/[çğışâîû]/.test(s) && /\b(der|die|das|des|und|ein|eine|zur|zum|im|von|le|la|les|du|et|une|il|della|del)\b/i.test(s) && !/\b(the|of|and)\b/i.test(s);

/** Persian and Ottoman izafet ("Fihrist-i kitâbhâ-yı çâpî"): no single rule; left as written. */
const IZAFET_LINK = /\p{L}-(i|ı|yi|yı|u|ü|yu|yü)\s/gu;
/** Two or more izafet links ("Fihrist-i kitâbhâ-yı çâpî"); one ("Kur’ân-ı Kerîm") is ordinary Turkish. */
const IZAFET_TITLE = { test: (s: string) => (s.match(IZAFET_LINK) ?? []).length >= 2 };

function titleCasePart(part: string, allCaps: boolean): string {
  if (allCaps && IZAFET_TITLE.test(lower(part))) return sentenceCaseText(part);
  if (isOtherWestern(part) || /:\/\/|www\./.test(part) || IZAFET_TITLE.test(part)) return part;
  let first = true;
  const western = isWestern(part);
  const lo = (x: string) => (western ? x.toLowerCase() : lower(x));
  const up = (x: string) => (western ? x.charAt(0).toUpperCase() + x.slice(1) : cap(x));
  // Acronyms (İSAM, TDV, MÜ), Roman numerals (I, IV) and names like "EndNote" stay as they are.
  const keep = (p: string) =>
    (!allCaps && p.length <= 8 && /\p{L}{2}/u.test(p) && p === upper(p) && p !== lower(p)) ||
    /^[IVXLC]+$/.test(p) ||
    (!western && /^\p{Lu}$/u.test(p)) ||
    (/\p{Ll}/u.test(p) && /^.\p{L}*\p{Lu}/u.test(p)) ||
    /^e-\p{L}/u.test(p);
  return part.replace(/[\p{L}\p{N}ʿʾ‘’'-]+/gu, (word) => {
    const isFirst = first;
    first = false;
    if (keep(word)) return word;
    const w = lo(word);
    if (!isFirst && SMALL.has(w)) return w;
    return word
      .split("-")
      .map((orig, i) => {
        if (keep(orig)) return orig;
        const p = lo(orig);
        return i > 0 && (IZAFET.test(p) || /^\d/.test(p)) ? p : /^[ʿʾ‘’']/.test(p) ? p.charAt(0) + up(p.slice(1)) : up(p);
      })
      .join("-");
  });
}

function arabicPart(part: string, allCaps: boolean): string {
  let s = allCaps ? lower(part) : part;
  // "El-makâsıd" → "el-Makâsıd": the article small, the word after it capital.
  const m = /^(\s*)(el|er|ez|es|eş|en|et|ed|al)-(\p{L})/iu.exec(s);
  if (m) s = m[1] + lower(m[2]!) + "-" + upper(m[3]!) + s.slice(m[0].length);
  else s = s.replace(/^(\s*)(\p{L})/u, (_, sp: string, c: string) => sp + upper(c));
  return s;
}

/** A title written the İSNAD way (see the module note). */
export function isnadTitle(title: string): string {
  const letters = title.replace(/[^\p{L}]/gu, "");
  const allCaps = letters.length >= 4 && letters === upper(letters);
  return title
    .split(/(\s*:\s*)/)
    // In an Arabic title the part after ":" stays small too ("…: el-fıkh ve usûluhû").
    .map((part, i) => (i % 2 ? part : isArabicTitle(part) ? (i === 0 ? arabicPart(part, allCaps) : allCaps ? lower(part) : part) : titleCasePart(part, allCaps)))
    .join("");
}

// ---------------------------------------------------------------- names

const ARTICLE = /^(el|er|ez|es|eş|en|et|ed|ebü|ebi|ibn|ibnü|ibni|b\.|bin|bint|al|de|van|von|du|da|di)\b/i;

/** Needs fixing: all capitals, all small, or starting small (articles aside). */
export function nameNeedsCase(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return false;
  // Acronyms beside an institution's name (TÜİK, BOA) and initials (C.E.) are right as they are.
  if (/^\p{Lu}{2,6}$/u.test(s.trim()) || /^(\p{Lu}\.\s?)+$/u.test(s.trim()) || /^[\p{Lu}.]+(\s[\p{Lu}.]+)*$/u.test(s.trim()) && s.trim().length <= 8) return false;
  if (letters === upper(letters) && letters !== lower(letters)) return true;
  if (ARTICLE.test(s.trim())) return false;
  return /^\p{Ll}/u.test(s.trim());
}

/** "AHMET YILMAZ", "ahmet yılmaz" → "Ahmet Yılmaz"; "el-gazzâlî" → "el-Gazzâlî". */
export function isnadName(s: string): string {
  return lower(s)
    .replace(/(^|[\s(.-])(\p{L})/gu, (_, p: string, c: string) => p + upper(c))
    .replace(/(^|\s)(El|Er|Ez|Es|Eş|En|Et|Ed|B|Bin|İbn|İbnü)(?=[-.\s])/gu, (w, p: string, a: string) => p + (a === "İbn" || a === "İbnü" ? a : lower(a)))
    .replace(/(\s)(De|Van|Von|Du|Da|Di)(?=\s)/gu, (_, sp: string, a: string) => sp + lower(a));
}

// ---------------------------------------------------------------- publishers

/** Known Turkish publishers, by folded short name → full İSNAD form. */
const PUBLISHERS: Record<string, string> = {
  isam: "İSAM Yayınları",
  tdv: "TDV Yayınları",
  "turkiye diyanet vakfi": "Türkiye Diyanet Vakfı Yayınları",
  "diyanet isleri baskanligi": "Diyanet İşleri Başkanlığı Yayınları",
  ketebe: "Ketebe Yayınları",
  klasik: "Klasik Yayınları",
  dergah: "Dergâh Yayınları",
  ensar: "Ensar Neşriyat",
  misvak: "Misvak Neşriyat",
  otuken: "Ötüken Neşriyat",
  iz: "İz Yayıncılık",
  insan: "İnsan Yayınları",
  timas: "Timaş Yayınları",
  mahya: "Mahya Yayınları",
  "ankara okulu": "Ankara Okulu Yayınları",
  litera: "Litera Yayıncılık",
  beyan: "Beyan Yayınları",
  hikmetevi: "Hikmetevi Yayınları",
  ragbet: "Rağbet Yayınları",
  albaraka: "Albaraka Yayınları",
  avesta: "Avesta Yayınları",
  bidge: "Bidge Yayınları",
  iletisim: "İletişim Yayınları",
  "yapi kredi": "Yapı Kredi Yayınları",
  kabalci: "Kabalcı Yayınevi",
  kitabiyat: "Kitâbiyât Yayınları",
  isaret: "İşaret Yayınları",
  "turk tarih kurumu": "Türk Tarih Kurumu Yayınları",
  "turk dil kurumu": "Türk Dil Kurumu Yayınları",
  "marmara universitesi ilahiyat fakultesi vakfi": "Marmara Üniversitesi İlâhiyat Fakültesi Vakfı Yayınları",
  "mu ilahiyat fakultesi vakfi": "MÜ İlâhiyat Fakültesi Vakfı Yayınları",
  siyer: "Siyer Yayınları",
  endulus: "Endülüs Yayınları",
  kure: "Küre Yayınları",
  vefa: "Vefa Yayınları",
  sule: "Şule Yayınları",
  "eski yeni": "Eski Yeni Yayınları",
  pinhan: "Pinhan Yayıncılık",
  "tarih vakfi yurt": "Tarih Vakfı Yurt Yayınları",
  "is bankasi kultur": "Türkiye İş Bankası Kültür Yayınları",
  "turkiye is bankasi kultur": "Türkiye İş Bankası Kültür Yayınları",
  alfa: "Alfa Yayınları",
  "dogu bati": "Doğu Batı Yayınları",
  ayrinti: "Ayrıntı Yayınları",
  metis: "Metis Yayınları",
  libra: "Libra Kitap",
  kronik: "Kronik Kitap",
  "kultur ve turizm bakanligi": "Kültür ve Turizm Bakanlığı Yayınları",
  "milli egitim bakanligi": "Milli Eğitim Bakanlığı Yayınları",
  "sonçag": "Sonçağ Yayınları",
  soncag: "Sonçağ Yayınları",
  "kitap yayinevi": "Kitap Yayınevi",
  "darulhadis": "Darulhadis Yayınları",
  "nesil": "Nesil Yayınları",
  "otto": "Otto Yayınları",
  "ilahiyat": "İlahiyat Yayınları",
  "dem": "DEM Yayınları",
  "ilem": "İLEM Yayınları",
  "kuramer": "KURAMER Yayınları",
  "tdv isam": "TDV İSAM Yayınları",
};

const SUFFIX_WORDS = /\b(yayinlari|yayinlar|yayinevi|yayincilik|yayin|yay|nesriyat|nesriyati|kitabevi|press|publishing|publications|ltd|sti|as)\b/g;

/** A publisher's name that already says what it is (Yayınları, Üniversitesi, Press, Dâr …). */
const INSTITUTIONAL = /\b(yayin\w*|yay|nesriyat\w*|kitabevi|kitap|kitaplari|matbaa\w*|basimevi|press|verlag|publish\w*|publications?|books|editions?|dar\w*|mektebe\w*|muessese\w*|baskanligi|bakanligi|kurum\w*|vakf\w*|universite\w*|enstitu\w*|dernegi|merkez\w*|akademi\w*|belediye\w*|cemiyet\w*|sirket\w*|fakulte\w*|ltd|inc|company|corporation|kultur|tbmm|tasam|brill|routledge|springer)\b/;

export interface PublisherFix {
  value: string;
  known: boolean;
}

/** Full İSNAD form of a known publisher, or the same name in proper case. */
export function isnadPublisher(publisher: string, turkish: boolean): PublisherFix | null {
  const p = publisher.trim().replace(/\s+/g, " ");
  if (!p) return null;
  const f = foldText(p);
  const core = f.replace(SUFFIX_WORDS, "").replace(/\s+/g, " ").trim();
  if (isArabicTitle(p) || IZAFET_TITLE.test(p)) return null;
  const known = PUBLISHERS[core] ?? PUBLISHERS[f];
  if (known) {
    if (known === p) return null;
    // An institution is a publisher by its own name ("Türk Dil Kurumu"): no "Yayınları" added.
    if (core === f && INSTITUTIONAL.test(f) && foldText(known).startsWith(f)) return null;
    // "Otuken Nesriyat" → "Ötüken Neşriyat"; but "Ketebe Yayınevi" is not turned into "Ketebe Yayınları".
    const suffix = f.slice(core.length).trim();
    const knownSuffix = foldText(known).slice(core.length).trim();
    const norm = (x: string) => x.replace(/^yay$/, "yayinlari").replace(/^yayinlar$/, "yayinlari");
    if (core === f || norm(suffix) === knownSuffix) return { value: known, known: true };
    return null;
  }
  if (!turkish) return null;
  const expanded = p.replace(/\bYay\.?$/i, "Yayınları");
  const cased = titleCasePart(expanded, false);
  return cased !== p ? { value: cased, known: false } : null;
}

/** A Turkish publisher without "Yayınları", "Yayınevi", "Neşriyat" … */
export function publisherLooksShort(publisher: string): boolean {
  const f = foldText(publisher);
  return Boolean(f) && !INSTITUTIONAL.test(f) && !isArabicTitle(publisher) && !/\p{L}-(i|ı|yi|yı|u|ü)(\s|$)/u.test(publisher) && f.split(" ").length <= 3;
}

// ---------------------------------------------------------------- places

const TR_CITIES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya", "Ardahan", "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Düzce", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Iğdır", "Isparta", "İstanbul", "İzmir", "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri", "Kırıkkale", "Kırklareli", "Kırşehir", "Kilis", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Mardin", "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Osmaniye", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Şanlıurfa", "Şırnak", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Van", "Yalova", "Yozgat", "Zonguldak", "Lefkoşa", "Üsküdar", "Kadıköy", "Fatih", "Beyoğlu",
];

/** Arabic-world and Persian cities are written in Turkish; Western ones keep their own name (London, Leiden). */
const PLACES: Record<string, string> = {
  ...Object.fromEntries(TR_CITIES.map((c) => [foldText(c), c])),
  afyon: "Afyonkarahisar",
  urfa: "Şanlıurfa",
  izmit: "Kocaeli",
  beirut: "Beyrut", bayrut: "Beyrut", beyrut: "Beyrut",
  cairo: "Kahire", kahire: "Kahire", "al qahira": "Kahire", "el kahire": "Kahire", qahira: "Kahire", kahira: "Kahire",
  tehran: "Tahran", tahran: "Tahran", teheran: "Tahran",
  riyadh: "Riyad", riyad: "Riyad", riyaz: "Riyad",
  baghdad: "Bağdat", bagdat: "Bağdat", bagdad: "Bağdat",
  damascus: "Dımaşk", dimashq: "Dımaşk", dimask: "Dımaşk",
  mecca: "Mekke", makkah: "Mekke", mekke: "Mekke", "mekke i mukerreme": "Mekke",
  medina: "Medine", madinah: "Medine", medine: "Medine", "medine i munevvere": "Medine",
  jeddah: "Cidde", cidde: "Cidde",
  kuwait: "Kuveyt", kuveyt: "Kuveyt",
  tunis: "Tunus", tunus: "Tunus",
  qom: "Kum", qum: "Kum",
  mashhad: "Meşhed", meshed: "Meşhed",
  lahore: "Lahor", lahor: "Lahor",
  karachi: "Karaçi", karaci: "Karaçi",
  hyderabad: "Haydarabad", haydarabad: "Haydarabad",
  bulaq: "Bulak", bulak: "Bulak",
  amman: "Amman",
};

/** Place as İSNAD writes it: no country, Turkish spelling of Turkish and Middle Eastern cities. */
export function isnadPlace(place: string): string {
  const p = place
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\s*[,/-]\s*(Türkiye|Turkey|TR|Türkiye Cumhuriyeti)\.?$/i, "")
    .replace(/\s*:$/, "")
    .trim();
  return PLACES[foldText(p)] ?? p;
}

export function isTurkishPlace(place: string): boolean {
  return TR_CITIES.some((c) => foldText(c) === foldText(isnadPlace(place)));
}

// ---------------------------------------------------------------- years

/** "c2015", "[2015?]", "2015." → "2015"; keeps hicrî/milâdî "1413/1993" and ranges. */
export function cleanYear(date: string): string | null {
  const d = date.trim();
  if (/^\d{3,4}(\/\d{3,4})?$/.test(d) || /^\d{3,4}-\d{3,4}$/.test(d)) return null;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(d) || /\d{1,2}[./ ]\d{1,2}[./ ]\d{4}/.test(d) || /\p{L}{3,}/u.test(d.replace(/^c/i, ""))) return null;
  const years = d.match(/\d{4}/g);
  return years?.length === 1 && years[0] !== d ? years[0]! : null;
}

// ---------------------------------------------------------------- short title

const CUT = new Set(["fî", "fi", "ilâ", "ila", "min", "alâ", "ala", "an", "li", "ve", "ile", "and", "of", "the", "in", "on"]);

/**
 * Short title for later citations: the main title (before ":"), cut before
 * "fî"/"ilâ"/"min" in Arabic titles, else its first three words.
 * Null when the full title is short already.
 */
export function shortTitleOf(title: string): string | null {
  const main = title.split(/\s*[:–—]\s+|\s+-\s+|\s*:\s*/)[0]!.trim();
  const words = main.split(/\s+/);
  let cut = words;
  if (isArabicTitle(main)) {
    const i = words.findIndex((w, k) => k > 0 && CUT.has(lower(w)));
    if (i > 0) cut = words.slice(0, i);
  }
  // Up to three words that carry meaning ("The Venture of Islam", "Geleneksel ve Çağdaş Yorumlarla").
  let content = 0;
  const kept: string[] = [];
  for (const w of cut) {
    if (content === 3) break;
    kept.push(w);
    if (!CUT.has(lower(w)) && !SMALL.has(w.toLowerCase())) content++;
  }
  cut = kept;
  while (cut.length > 1 && CUT.has(lower(cut[cut.length - 1]!))) cut = cut.slice(0, -1);
  const short = cut.join(" ").replace(/[,;]$/, "");
  return short && short !== title.trim() ? short : null;
}

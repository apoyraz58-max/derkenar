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

const ARABIC = /(^|[\s(])(el|er|ez|es|eş|en|et|ed|eẓ|eṣ|eḍ|eṭ|eż|eẕ|es\u0331|al)-\p{L}|\p{L}[’'ʾ](l|d|t|s|ş|r|z|n|ṭ|ḍ|ṣ|ẓ|ẕ|ẖ)-\p{L}|(^|\s)(fî|fi|li|bi)[’'\s]|[ḥṣṭẓḳḫġżḍẕāīūʿ\u0331]/iu;

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
  // (Also the articles of transcribed titles: "eṭ-Ṭabaḳāt", "eṣ-Ṣalât", "eż-Żuʿafâʾ", "eẕ-Ẕeyl", "es̱-S̱iḳāt".)
  const m = /^(\s*)(el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eż|eḍ|eẓ|eẕ|es\u0331|al)-(\p{L}\u0331?)/iu.exec(s);
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
  // İlahiyat ve sosyal bilimlerde sık geçenler.
  fecr: "Fecr Yayınları",
  nun: "Nun Yayıncılık",
  pinar: "Pınar Yayınları",
  hece: "Hece Yayınları",
  "bilge kultur sanat": "Bilge Kültür Sanat",
  kayihan: "Kayıhan Yayınları",
  camlica: "Çamlıca Yayınları",
  erkam: "Erkam Yayınları",
  semerkand: "Semerkand Yayınları",
  "sufi kitap": "Sufi Kitap",
  ilke: "İlke Yayıncılık",
  akcag: "Akçağ Yayınları",
  kalem: "Kalem Yayınevi",
  muhit: "Muhit Kitap",
  isar: "İSAR Yayınları",
  "isar vakfi": "İSAR Vakfı Yayınları",
  yeditepe: "Yeditepe Yayınevi",
  kaknus: "Kaknüs Yayınları",
  "iz yayincilik": "İz Yayıncılık",
  "insan yayinlari": "İnsan Yayınları",
  "mahya yayincilik": "Mahya Yayıncılık",
  "kitap dunyasi": "Kitap Dünyası",
  "otto yayinlari": "Otto Yayınları",
  "ayasofya": "Ayasofya Yayınları",
  "eski yeni yayinlari": "Eski Yeni Yayınları",
  "dib": "Diyanet İşleri Başkanlığı Yayınları",
  "diyanet": "Diyanet İşleri Başkanlığı Yayınları",
  "dergah yayinlari": "Dergâh Yayınları",
  "tarih vakfi": "Tarih Vakfı Yurt Yayınları",
  "turk tarih kurumu basimevi": "Türk Tarih Kurumu Basımevi",
  "ttk": "Türk Tarih Kurumu Yayınları",
  "tdk": "Türk Dil Kurumu Yayınları",
  "yapi kredi yayinlari": "Yapı Kredi Yayınları",
  "yky": "Yapı Kredi Yayınları",
  "is bankasi": "Türkiye İş Bankası Kültür Yayınları",
  "kultur bakanligi": "Kültür Bakanlığı Yayınları",
  "vakiflar genel mudurlugu": "Vakıflar Genel Müdürlüğü Yayınları",
  "ataturk kultur merkezi": "Atatürk Kültür Merkezi Yayınları",
  "turk diyanet vakfi": "Türkiye Diyanet Vakfı Yayınları",
  "ankara universitesi ilahiyat fakultesi": "Ankara Üniversitesi İlahiyat Fakültesi Yayınları",
  "ataturk universitesi ilahiyat fakultesi": "Atatürk Üniversitesi İlahiyat Fakültesi Yayınları",
  "inonu universitesi ilahiyat fakultesi": "İnönü Üniversitesi İlahiyat Fakültesi Yayınları",
};

const SUFFIX_WORDS = /\b(yayinlari|yayinlar|yayinevi|yayincilik|yayin|yay|nesriyat|nesriyati|kitabevi|press|publishing|publications|ltd|sti|as)\b/g;

/** A publisher's name that already says what it is (Yayınları, Üniversitesi, Press, Dâr …). */
const INSTITUTIONAL = /\b(yayin\w*|yay|nesriyat\w*|kitabevi|kitap|kitaplari|matbaa\w*|basimevi|press|verlag|publish\w*|publications?|books|editions?|dar\w*|mektebe\w*|muessese\w*|baskanligi|bakanligi|mudurlug\w*|kurum\w*|vakf\w*|universite\w*|enstitu\w*|dernegi|merkez\w*|akademi\w*|belediye\w*|cemiyet\w*|sirket\w*|fakulte\w*|ltd|inc|company|corporation|kultur|tbmm|tasam|brill|routledge|springer)\b/;

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

/** Postpositions that close an adjunct ("İslam Hukukunda Delil Olarak", "Kelam Açısından"). */
const POSTPOSITIONS = new Set(["olarak", "açısından", "bağlamında", "göre", "ışığında", "üzerine", "üzerinde", "hakkında", "karşı", "itibariyle", "yönüyle", "yönünden", "çerçevesinde", "bakımından", "kapsamında", "örneğinde", "özelinde", "etrafında", "perspektifinden", "ekseninde", "aracılığıyla", "için", "dair", "ait", "boyunca", "sonra", "önce", "kadar", "rağmen", "sayesinde", "nazarında", "gözüyle", "temelinde", "zemininde", "işığında"]);

/** Nouns that only look case-marked (irade, mesele, vicdan …). */
const NOT_ADJUNCT = new Set(["irade", "ifade", "iade", "ziyade", "sade", "akide", "maide", "vade", "mesele", "risale", "mukabele", "muamele", "cümle", "hile", "kale", "vicdan", "meydan", "ramazan", "insan", "zaman", "mekân", "mekan", "lisan", "ihsan", "irfan", "kur’an", "kur'an", "kurân", "kur’ân", "kur'ân", "ezan", "beyan", "divan", "erkan", "erkân", "nazariyede", "hidayet", "seyyide", "fâide", "faide", "kaide", "medine", "dünya", "felsefe", "mektepte"]);

/** A word that ends an adjunct: locative, ablative or instrumental ("Hukukunda", "Kur’ân’da", "Başlangıçtan", "Yorumlarla"). */
function isAdjunct(word: string): boolean {
  const w = lower(word).replace(/[!?.,;]+$/, "");
  if (POSTPOSITIONS.has(w)) return true;
  if (NOT_ADJUNCT.has(w) || w.length < 5) return false;
  if (/[’'](d|t)[ae](n)?$/.test(w) || /[’'](y)?l[ae]$/.test(w)) return true;
  const stem = w.replace(/(d|t)[ae]n?$/, "");
  if (stem !== w) return /[^aeıioöuüâîû]$/.test(stem) || w.length >= 7;
  return /[^aeıioöuüâîû]l[ae]$/.test(w) && /(lar|ler|[^aeıioöuüâîû])l[ae]$/.test(w) && w.length >= 6;
}


/**
 * A leading scope a short title can do without: a field or period in the
 * locative ("Hukukunda", "Düşüncesinde", "Döneminde") or a proper name
 * ("Osmanlı Devleti'nde", "Gazzâlî'de").
 */
function isScope(word: string): boolean {
  const w = lower(word);
  if (!/(d|t)[ae]$/.test(w) || NOT_ADJUNCT.has(w)) return false;
  if (/[’'][^’']*(d|t)[ae]$/.test(w)) return true;
  return /^(hukuk|düşünce|gelenek|tarih|devlet|dönem|kelâm|kelam|tasavvuf|tefsir|hadis|fıkıh|fıkh|felsefe|edebiyat|kültür|toplum|ilim|ilm|ekol|mezhep|mezheb|literatür|anlayış|yorum|asır|yüzyıl|çağ|gelenek|dünya|islâm|islam|türk|osmanlı|kur)/.test(w);
}

/** Arabic particles a title's first construct ends before ("li’t-", "fî", "ve", "mine’l-"). */
const AR_CUT = /^((li|bi|ke)[-’'ʾ]|(fî|fi|ve|min|ilâ|ila|alâ|ala|an|ʿan|ʿalâ|wa|fī|ilá|ʿalá)$|mine[’'ʾ])/i;

/**
 * Short title for later citations, the way the İSNAD guide's own records
 * shorten them (test: the guide's 34 short titles):
 *  - the main title only: no subtitle after ":", nothing in ( ) or [ ],
 *    no trailing date ("953 Tarihli", "XVIII. Yüzyıl");
 *  - Arabic: the first construct ("Telḫîṣü’l-edille li-ḳavâʿidi…" →
 *    "Telḫîṣü’l-edille", "Miftâḥu’s-saʿâde ve miṣbâḥu…" → "Miftâḥu’s-saʿâde");
 *  - Turkish: a second part joined by "ve" goes ("Mâtürîdî Kelâm Ekolünde
 *    Nesefîler ve Ebû Hafs … Görüşleri" → "… Nesefîler"); a leading scope
 *    drops from a long title ("İslam Ceza Hukukunda Suça Teşebbüsten
 *    Vazgeçme" → "Suça Teşebbüsten Vazgeçme"); a closing range goes
 *    ("Konsiller Tarihi İznik’ten II. Vatikan’a" → "Konsiller Tarihi");
 *  - English and other Western titles: the main title.
 * Null when that is the whole title already.
 */
export function shortTitleOf(title: string): string | null {
  const full = title.trim();
  let main = full
    .split(/\s*[:–—]\s+|\s+-\s+|\s*:\s*/)[0]!
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s*-?\s*\b[IVXLC]+\.\s*(Yüzyıl|Asır)\b.*$/i, "")
    .replace(/\s+\d+\s+Tarihli$/i, "")
    .replace(/[,;.\s]+$/, "")
    .trim();
  let words = main.split(/\s+/);

  // (A Turkish title that begins with an Arabic name: "Bedreddin eş-Şuhâvî’nin et-Tırâzu’l-müzheb Adlı Eserinin Tahkik ve Tercümesi".)
  const turkishTail = words.some((w) => /^(adlı|isimli|adındaki)$/i.test(w) || (!isArabicTitle(w) && /(?:[ıiuü]n[ıiuü]n|s[ıiuü]n[ıiuü]n)$/.test(lower(w))));
  if (isArabicTitle(words.slice(0, 2).join(" ")) && !turkishTail && !words.some((w, k) => k < words.length - 1 && isAdjunct(w) && !isArabicTitle(w))) {
    if (words.length > 1 && /^(kitâb|kitāb|kitab)$/i.test(words[0]!) && /^(al|el)-/i.test(words[1]!)) words = words.slice(1);
    const i = words.findIndex((w, k) => k > 0 && AR_CUT.test(w));
    if (i > 0) words = words.slice(0, i);
    else if (words.length > 4) words = words.slice(0, 2);
  } else if (!(isWestern(main) || isOtherWestern(main))) {
    // A second part joined by "ve" (long enough to be a second subject).
    // ("Tahkik ve Tercümesi" share one suffix: one subject, not two.)
    // ("Ahlak ve Tasavvuf Kavramları", "Tahkik ve Tercümesi": one suffix for both, so one subject, not two.)
    const sharedSuffix = (k: number) => !/(s?[ıiuü]|[’'].*|l[ae]r[ıi]?)$/.test(lower(words[k - 1]!)) && [words[k + 1], words[k + 2]].some((x) => x && /(s?[ıiuü]|l[ae]r[ıi])$/.test(lower(x)));
    const v = words.findIndex((w, k) => k >= 2 && /^(ve|ile)$/i.test(w) && words.length - k - 1 >= 3 && !words.slice(0, k).join(" ").includes(",") && !sharedSuffix(k));
    if (v > 0) words = words.slice(0, v);
    // A closing range: "… İznik’ten II. Vatikan’a".
    const last = words[words.length - 1] ?? "";
    if (/[’'](y)?[ae]$/.test(last) || /[^aeıioöuü][ae]$/.test(last)) {
      const from = words.findIndex((w, k) => k >= 2 && /[’'](d|t)[ae]n$/.test(w));
      if (from > 0) words = words.slice(0, from);
    }
    // A leading scope ("İslam Ceza Hukukunda") drops from a long title.
    if (words.length > 4) {
      const a = words.findIndex((w, k) => k <= 3 && k < words.length - 2 && isScope(w));
      if (a >= 0 && !words.slice(0, a).some((w) => /[’'](d|t)[ae]n$|[’'](y)?[ae]$/.test(w))) words = words.slice(a + 1);
      // "… Müzesi'nde Bulunan Türk Halıları" → "Türk Halıları": the participle went with the place.
      if (a >= 0 && words.length > 2 && /^\p{L}+(?:[ıiuü]?l?[ae]n|[dt][ıiuü][ğk][ıiuü])$/u.test(words[0]!) && /^\p{Lu}/u.test(words[0]!) && /(?:an|en|ılan|ilen|ulan|ülen)$/.test(words[0]!)) words = words.slice(1);
    }
    // "… Üzerine Bir İnceleme", "… Bir Değerlendirme": a generic close, then the postposition before it.
    if (words.length > 3 && /^bir$/i.test(words[words.length - 2]!) && /^(inceleme|değerlendirme|araştırma|yaklaşım|deneme|tahlil|tetkik|çözümleme|analiz|okuma|bakış|giriş|katkı|tartışma)$/i.test(lower(words[words.length - 1]!))) words = words.slice(0, -2);
    // A closing postposition ("Tasavvuf Üzerine") is about what precedes it.
    while (words.length > 2 && POSTPOSITIONS.has(lower(words[words.length - 1]!))) words = words.slice(0, -1);
  } else if (words.length > 10) {
    words = words.slice(0, 6);
  }
  while (words.length > 1 && (CUT.has(lower(words[words.length - 1]!)) || /^(ve|ile)$/i.test(words[words.length - 1]!))) {
    // "… Tahkik ve Tercümesi": the last word ends a pair; cutting it would leave "… Tahkik".
    if (words.length > 2 && /^(ve|ile)$/i.test(words[words.length - 2]!) && CUT.has(lower(words[words.length - 1]!))) break;
    words = words.slice(0, -1);
  }
  const short = words.join(" ").replace(/[,;:]$/, "");
  return short && short !== full ? short : null;
}

// ---------------------------------------------------------------- lost Turkish letters

/**
 * Words whose Turkish letters were lost on the way ("Erdogan Universitesi").
 * Only unambiguous words: "dini" (dinî / onun dini) or "ayin" are not here.
 */
const TR_WORDS = `Üniversitesi Üniversite Üniversiteleri Fakültesi Fakülte Enstitüsü Yüksekokulu Müdürlüğü Başkanlığı Bakanlığı Bakanlık Vakfı Vakıf Vakıflar Derneği Şirketi Kütüphanesi Kütüphane Yayınları Yayınevi Yayıncılık Yayın Neşriyat Neşriyatı Matbaası Basımevi Kitabevi Araştırma Araştırmaları Araştırmalar Merkezi Bölümü Anabilim Dalı Eğitim Eğitimi Öğretim Öğretimi Öğrenci Öğretmen Sağlık Güzel Teknik
İlahiyat İlâhiyat İslam İslâm İslami İslâmî İslamiyet İnanç İnancı İnançları Esasları Düşünce Düşüncesi Düşüncesinde Düşünürleri Kültür Kültürü Kültürel Türk Türkiye Türkçe Türklerin Osmanlı Osmanlıca Çağdaş Çağ Çağı Günümüz Günümüze Öğreti Öğretisi Özel Üzerine Üzerinde Açısından Bağlamında Işığında Çerçevesinde Hakkında Karşı Karşılaştırmalı Değerlendirme Değerlendirmesi Yaklaşım Yaklaşımı Yaklaşımlar Gelişim Gelişimi Doğuşu Doğu Batı Dünya Dünyası Işık Işığı Sünnet Fıkıh Fıkhı Usulü Mantık Akıl Şiir Şiiri Şair Şairi Çeviri Çevirisi Hazırlayan Seçme Seçmeler Özgürlük Özgürlüğü Hürriyet Hürriyeti Sorunları Çözüm Önerileri Çocuk Kadın Geçmiş Yüzyıl Yüzyılda Yüzyılı Dönem Dönemi Döneminde Şehir Şehri Arşiv Arşivi Kaynakları Kataloğu Sözlük Sözlüğü Sayı Baskı Büyük Küçük Bütün Kısa Dönüşüm Değişim İlişki İlişkiler İlişkileri Uluslararası Bildiriler Kitabı Kitapları Armağan Armağanı Hatıra İçin Göre Arasında Önce Öncesi Sonrası Günü Günleri Tarihçe Ahlâk Ahlak Felsefesi Medeniyeti Medeniyet İktisat İktisadi Siyasî Toplumsal Sosyoloji Psikoloji Bilgisi Bilinç Varlık Gönül İnsan İnsanın Kur’ân Kur’an Kuran’ı Mushaf Âyet Âyetleri Sûre Sûresi Hadîs Hz İSAM Ötüken Peygamber Peygamberin Sahâbe Tâbiîn Müslüman Müslümanlar Müslümanların Ümmet Şerh Şerhi Hâşiye Ta‘lîk Tercüme Tercümesi
İstanbul İzmir Uludağ Selçuk Çukurova Fırat İnönü Atatürk Erdoğan Mayıs Eylül Yüzüncü Yıl Sütçü Şeyh Çeçen Ağrı Şırnak Bartın Karabük Düzce Uşak Süleyman Muğla Sıtkı Koçman Aydın Balıkesir Çanakkale Kırklareli Namık Nevşehir Hacı Bektaş Niğde Ömer Karamanoğlu Aralık Şanlıurfa Iğdır Çoruh Gaziosmanpaşa Çorum Kırşehir Yıldırım Özal Elazığ Çankırı Gümüşhane Adıyaman Kahramanmaraş Muş Diyarbakır Kırıkkale Eskişehir Kütahya Dumlupınar Tekirdağ Bingöl Yıldız Boğaziçi İzzet Üsküdar Bahçeşehir Özyeğin Koç Sabancı Atılım Başkent Çankaya Haliç Doğuş İbrahim Ankara`;

const TR_FIX = new Map<string, string>();
for (const w of TR_WORDS.split(/\s+/)) {
  const key = foldText(w).replace(/ /g, "");
  if (/[çğıöşüâîûÇĞİÖŞÜÂÎÛ’‘]/.test(w) && !TR_FIX.has(key)) TR_FIX.set(key, w);
}

/** Text with no Turkish letter at all whose words show they lost them. */
export function restoreTurkish(text: string): string {
  if (!text || /[çğıöşüâîûÇĞİÖŞÜÂÎÛ]/.test(text) || /[ḥṣṭẓḳḫġżḍāīūʿ]/.test(text) || isWestern(text) || isOtherWestern(text) || /\b(studies|journal|review|walls|history|law|press|quarterly|bulletin|annals|proceedings|series|world|new|modern|islamic|muslim|university|institute|center|centre|research|thought|religion|religious)\b/i.test(text)) return text;
  return text.replace(/[A-Za-z]+(?:['’][a-z]+)?/g, (word) => {
    const fixed = TR_FIX.get(word.toLowerCase().replace(/['’]/g, ""));
    if (!fixed) return word;
    if (word === word.toUpperCase() && word.length > 1) return upper(fixed);
    return /^[A-Z]/.test(word) ? cap(fixed) : lower(fixed);
  });
}

// ---------------------------------------------------------------- Arabic article of a nisba

const SUN = /^[tsşdzrnṭṣḍẓẕs̱ẕ]/i;

/**
 * Classical Arabic authors carry the article before their nisba: "Ebû Şekûr
 * Muhammed b. Abdüsseyyid es-Sâlimî el-Keşşî", "Muhammed Aʿlâ b. Ali
 * et-Tehânevî". With the İSNAD-Zotero convention the article ends the given
 * name ("Ebû Hâmid Muhammed el-" + "Gazzâlî"), so the short form reads
 * "Gazzâlî". Returns the given name with the article added, or null.
 */
export function nisbaArticle(lastName: string, firstName: string): string | null {
  const last = lastName.trim();
  const first = firstName.trim();
  if (!last || !first || /-$/.test(first) || /^(el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|al|at|as|az|an|ad|ar|ash)-/i.test(last)) return null;
  if (/^(ibn|ibnü|ibni|ebû|ebü|ebi|abd|abdül|abdür|abdu)/i.test(last)) return null;
  if (!/[îīiy]$/.test(last) || !/[^aeıioöuüâîûāīū][îī]$/.test(last)) return null;
  // A classical name chain: "b." (bin) or a kunya.
  // Turkish İSNAD spelling only: "ibn … Birgiwī" (Western transliteration) and "Şeyh Zindânî" stay as written.
  if (/\s/.test(last) || /(^|\s)ibn\s/i.test(first) || /[āīūḥṣṭẓ]/.test(first + last) && !/[âîû]/.test(first + last)) return null;
  if (!/(^|\s)(b\.|bin)\s/i.test(first) && !/^(ebû|ebü|ebu)\s/i.test(first)) return null;
  const c = last.normalize("NFD").charAt(0).toLocaleLowerCase("tr");
  const article = SUN.test(c) ? `e${c === "s" && /^ş/i.test(last) ? "ş" : last.charAt(0).toLocaleLowerCase("tr")}-` : "el-";
  return `${first} ${article}`;
}

// ---------------------------------------------------------------- hicrî years

/** Milâdî year in which most of a hicrî year falls (1408 → 1988, 1364 → 1945). */
export function hijriToGregorian(h: number): number {
  const start = 622.5378 + (h - 1) * 0.970224;
  return Math.floor(start + 0.485);
}

const ARAB_PLACES = new Set(["Beyrut", "Kahire", "Riyad", "Bağdat", "Dımaşk", "Mekke", "Medine", "Cidde", "Kuveyt", "Tunus", "Amman", "Bulak", "Lahor", "Karaçi", "Haydarabad", "Rabat", "Fas", "Sana", "Doha", "Halep", "Musul", "Necef", "Kerbelâ", "Kerbela", "İskenderiye", "Trablus", "Cezayir", "Abu Dabi", "Dubai", "Şârika", "Ebûzabî"]);

/**
 * A lone hicrî year on an Arabic print ("Beyrut: Dâru’l-Maʿrife, 1408"):
 * İSNAD writes both, "1408/1988". Returns the suggested date or null.
 */
export function hijriPair(date: string, place: string, publisher: string): string | null {
  const d = date.trim();
  if (!/^1[0-4]\d\d$/.test(d)) return null;
  const h = Number(d);
  if (h < 1100 || h > 1460) return null;
  const arabic = ARAB_PLACES.has(isnadPlace(place)) || /^(dâr|dār|dar|mektebe|mektebet|müessese|muessese|el-|al-)/i.test(publisher.trim());
  if (!arabic) return null;
  // A Gregorian year in the same range (1100–1460) on an Arabic print is very unlikely after the 1800s.
  return `${h}/${hijriToGregorian(h)}`;
}

const WESTERN_PLACES = ["London", "Londra", "Leiden", "Oxford", "Cambridge", "New York", "Princeton", "Chicago", "Paris", "Berlin", "Leipzig", "Wiesbaden", "Göttingen", "Wien", "Viyana", "Roma", "Edinburgh", "Boston", "Washington", "Toronto", "Montreal", "Leuven", "Amsterdam", "Bonn", "Münih", "München", "Hamburg", "Heidelberg", "Tübingen", "Freiburg", "Lahey", "Brüksel", "Bruxelles", "Madrid", "Moskova", "Budapeşte", "Sofya", "Saraybosna", "Bakü", "Taşkent", "Kazan", "Üsküp", "Prizren", "Priştine", "Lefkoşa", "Berkeley", "Los Angeles", "Bloomington", "Albany", "Edinburg", "Abingdon", "New Haven", "Ithaca", "Austin", "Salt Lake City", "Atlanta", "Cenevre", "Genève"];
const PLACE_KEYS = [...Object.keys(PLACES), ...WESTERN_PLACES.map(foldText)].sort((a, b) => b.length - a.length);

/** A city named in a line ("İstanbul, 2015", "DERGÂH YAYINLARI İSTANBUL"): its İSNAD form and the words as written. */
export function placeIn(line: string): { place: string; raw: string } | null {
  const words = line.split(/[\s,;:()/–-]+/).filter(Boolean);
  for (const key of PLACE_KEYS) {
    const n = key.split(" ").length;
    for (let i = 0; i + n <= words.length; i++) {
      const raw = words.slice(i, i + n).join(" ");
      if (foldText(raw) === key) return { place: PLACES[key] ?? WESTERN_PLACES.find((w) => foldText(w) === key)!, raw };
    }
  }
  return null;
}

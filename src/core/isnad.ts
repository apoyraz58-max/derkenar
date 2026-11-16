/**
 * İSNAD yazım denetimi: checks an item against what İSNAD 2 needs and the
 * usual slips of hand-entered or imported records. Each finding says what is
 * wrong and, where the fix is mechanical, carries it ("Düzelt").
 */
import { cleanYear, restoreTurkish, isTurkishPlace, isnadName, isnadPlace, isnadPublisher, isnadTitle, nameNeedsCase, publisherLooksShort, shortTitleOf } from "./isnadstyle.js";
import { type Creator, type Item, baseField, containerOf, fieldLabel, parseDate, primaryCreators, typeField } from "./zotero.js";

export type Level = "error" | "warning" | "info";

export interface Patch {
  readonly field?: string;
  readonly value?: string;
  /** Move the field's current value to this field (then `value` is what stays behind). */
  readonly moveTo?: string;
  readonly creatorIndex?: number;
  readonly creator?: Creator;
}

export interface Issue {
  readonly key: string;
  readonly code: string;
  readonly level: Level;
  readonly message: string;
  readonly field?: string;
  readonly creatorIndex?: number;
  readonly fix?: Patch;
  /** Short label for the fix button. */
  readonly fixLabel?: string;
}

// ---------------------------------------------------------------- text helpers

const TR_LOWER = (s: string) => s.toLocaleLowerCase("tr");
const TR_UPPER = (s: string) => s.toLocaleUpperCase("tr");

export function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && letters === TR_UPPER(letters) && letters !== TR_LOWER(letters);
}

/** "İHYÂÜ ULÛMİ'D-DÎN" → "İhyâü ulûmi'd-dîn" (first letter, and after ": "). */
export function sentenceCase(s: string): string {
  const lower = TR_LOWER(s);
  return lower.replace(/(^|[:.?!]\s+)(\p{L})/gu, (_, p: string, c: string) => p + TR_UPPER(c));
}

/** "AHMET YILMAZ" → "Ahmet Yılmaz"; keeps "b.", "el-", "ibn". */
export function nameCase(s: string): string {
  return TR_LOWER(s).replace(/(^|[\s(])(\p{L})/gu, (_, p: string, c: string) => p + TR_UPPER(c)).replace(/\b(El|Er|Ez|Es|Eş|En|Et|Ed|Ed|Ebü'l|B)\b(?=[-.])/gu, (w) => TR_LOWER(w));
}

/** Text saved in one encoding and read in another (UTF-8 as Latin-1, Windows-1254 as 1252). */
const MOJIBAKE: [RegExp, string][] = [
  [/Ä±/g, "ı"], [/Ä°/g, "İ"], [/ÅŸ/g, "ş"], [/Åž/g, "Ş"], [/ÄŸ/g, "ğ"], [/Äž/g, "Ğ"], [/Ã¼/g, "ü"], [/Ãœ/g, "Ü"], [/Ã¶/g, "ö"], [/Ã–/g, "Ö"], [/Ã§/g, "ç"], [/Ã‡/g, "Ç"], [/Ã¢/g, "â"], [/Ã®/g, "î"], [/Ã»/g, "û"], [/Ã‚/g, "Â"], [/ÃŽ/g, "Î"], [/Ã›/g, "Û"], [/â€™/g, "’"], [/â€œ/g, "“"], [/â€\u009d/g, "”"],
];
const CP1254: [RegExp, string][] = [[/ý/g, "ı"], [/Ý/g, "İ"], [/þ/g, "ş"], [/Þ/g, "Ş"], [/ð/g, "ğ"], [/Ð/g, "Ğ"]];

export function fixEncoding(s: string): string {
  let out = s;
  for (const [re, ch] of MOJIBAKE) out = out.replace(re, ch);
  if (/[ýþð]/.test(out) && /[a-zçöü]/i.test(out)) for (const [re, ch] of CP1254) out = out.replace(re, ch);
  return out;
}

function isbnValid(isbn: string): boolean {
  const d = isbn.replace(/[^0-9X]/gi, "").toUpperCase();
  if (d.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (d[i] === "X" ? 10 : Number(d[i])) * (10 - i);
    return sum % 11 === 0;
  }
  if (d.length === 13) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

// ---------------------------------------------------------------- rules

interface Need {
  base: string;
  level: Level;
  message: string;
  fill?: string;
}

/** What İSNAD expects per item type (by base field). */
const NEEDS: Record<string, Need[]> = {
  book: [
    { base: "place", level: "info", message: "Basım yeri yok; atıfta ve kaynakçada \"b.y.\" yazılacak." },
    { base: "publisher", level: "info", message: "Yayınevi yok; atıfta ve kaynakçada \"y.y.\" yazılacak." },
  ],
  bookSection: [
    { base: "publicationTitle", level: "error", message: "Bölümün yer aldığı kitabın adı yok." },
    { base: "pages", level: "warning", message: "Bölümün sayfa aralığı yok (kaynakçada gerekir)." },
    { base: "place", level: "info", message: "Basım yeri yok; \"b.y.\" yazılacak." },
    { base: "publisher", level: "info", message: "Yayınevi yok; \"y.y.\" yazılacak." },
  ],
  journalArticle: [
    { base: "publicationTitle", level: "error", message: "Derginin adı yok." },
    { base: "volume", level: "warning", message: "Cilt yok. Dergide cilt yoksa yalnız sayı yazılabilir." },
    { base: "pages", level: "warning", message: "Makalenin sayfa aralığı yok (ör. 45-78)." },
    { base: "date", level: "warning", message: "Yayın yılı yok." },
  ],
  encyclopediaArticle: [
    { base: "publicationTitle", level: "error", message: "Ansiklopedinin adı yok (ör. Türkiye Diyanet Vakfı İslâm Ansiklopedisi)." },
    { base: "volume", level: "warning", message: "Ansiklopedi cildi yok (İSNAD: 13/489-505)." },
    { base: "pages", level: "warning", message: "Maddenin sayfa aralığı yok." },
    { base: "place", level: "warning", message: "Yayın yeri yok." },
    { base: "publisher", level: "warning", message: "Yayınevi yok." },
    { base: "date", level: "warning", message: "Yayın yılı yok." },
  ],
  dictionaryEntry: [
    { base: "publicationTitle", level: "error", message: "Sözlüğün adı yok." },
    { base: "pages", level: "info", message: "Maddenin sayfası yok." },
  ],
  thesis: [
    { base: "publisher", level: "error", message: "Üniversite / enstitü yok." },
    { base: "type", level: "warning", message: "Tez türü yok (Doktora Tezi, Yüksek Lisans Tezi)." },
    { base: "place", level: "warning", message: "Yer (şehir) yok." },
    { base: "date", level: "warning", message: "Tez yılı yok." },
  ],
  manuscript: [
    { base: "archive", level: "warning", message: "Yazmanın bulunduğu kütüphane (Arşiv) yok." },
    { base: "archiveLocation", level: "warning", message: "Koleksiyon ve demirbaş numarası (Arşivdeki yeri) yok." },
  ],
  conferencePaper: [
    { base: "publicationTitle", level: "warning", message: "Bildiri kitabının adı yok." },
    { base: "place", level: "info", message: "Basım yeri yok." },
  ],
  webpage: [
    { base: "url", level: "error", message: "Web adresi (URL) yok." },
    { base: "accessDate", level: "warning", message: "Erişim tarihi yok (İSNAD: Erişim 12 Mart 2024)." },
  ],
  blogPost: [
    { base: "url", level: "error", message: "Web adresi (URL) yok." },
    { base: "accessDate", level: "warning", message: "Erişim tarihi yok." },
  ],
};

const ITALIC_TITLE = new Set(["book"]);
const NO_DATE_OK = new Set(["manuscript", "letter", "webpage"]);

export function checkItem(item: Item): Issue[] {
  const out: Issue[] = [];
  const add = (i: Omit<Issue, "key">) => out.push({ key: item.key, ...i });
  const f = item.fields;

  if (!f.title?.trim()) add({ code: "title-missing", level: "error", message: "Başlık yok.", field: "title" });
  if (!primaryCreators(item).length) add({ code: "creator-missing", level: "info", message: "Yazar, editör veya muhakkik yok; atıf başlıkla başlar." });

  for (const need of NEEDS[item.itemType] ?? []) {
    const field = typeField(item.itemType, need.base);
    if (!field) continue;
    if (!f[field]?.trim()) add({ code: `need-${need.base}`, level: need.level, message: need.message, field, ...(need.fill ? { fix: { field, value: need.fill }, fixLabel: `"${need.fill}" yaz` } : {}) });
  }
  if (!f.date?.trim() && typeField(item.itemType, "date") && !NO_DATE_OK.has(item.itemType) && !(NEEDS[item.itemType] ?? []).some((n) => n.base === "date")) {
    add({ code: "date-missing", level: "info", message: "Tarih yok; atıfta \"ts.\" yazılacak.", field: "date" });
  }

  // Field by field.
  for (const [field, value] of Object.entries(f)) {
    if (!value) continue;
    const base = baseField(item.itemType, field);
    const label = fieldLabel(field);
    const fixed = fixEncoding(value);
    if (fixed !== value) {
      add({ code: "encoding", level: "error", message: `${label}: bozuk Türkçe karakter (kodlama hatası).`, field, fix: { field, value: fixed }, fixLabel: "Karakterleri düzelt" });
      continue;
    }
    const trimmed = value.replace(/[ \t]{2,}/g, " ").trim();
    if (trimmed !== value && field !== "extra" && field !== "abstractNote") add({ code: "spaces", level: "info", message: `${label}: fazla boşluk.`, field, fix: { field, value: trimmed }, fixLabel: "Boşlukları temizle" });

    // Lost Turkish letters ("Recep Tayyip Erdogan Universitesi").
    if (["title", "publicationTitle", "shortTitle", "publisher", "place", "series", "seriesTitle", "university", "institution", "archive"].includes(base) || ["publisher", "place", "series"].includes(field)) {
      const t = restoreTurkish(value);
      if (t !== value) {
        add({ code: "turkish-letters", level: "warning", message: `${label}: Türkçe harfler eksik ("${t}").`, field, fix: { field, value: t }, fixLabel: "Düzelt" });
        continue;
      }
    }
    if (base === "title" || base === "publicationTitle" || base === "shortTitle") {
      if (isAllCaps(value) && !(base === "shortTitle" && !/\s/.test(value.trim()))) add({ code: "caps", level: "warning", message: `${label} tamamen büyük harfle yazılmış.`, field, fix: { field, value: base === "shortTitle" ? sentenceCase(value) : isnadTitle(value) }, fixLabel: "Küçült" });
      // Title case only for what İSNAD prints in italics: books, and the book or journal a part belongs to.
      else if (base !== "shortTitle" && (base === "publicationTitle" || ITALIC_TITLE.has(item.itemType)) && isnadTitle(value) !== value) {
        const v = isnadTitle(value);
        add({ code: "title-case", level: "warning", message: `${label} İSNAD'a göre büyük-küçük harf: "${v}". (Türkçe ve Batı dillerindeki adlarda kelime başları büyük; Arapça adlarda yalnız ilk kelime.)`, field, fix: { field, value: v }, fixLabel: "Düzelt" });
      }
      if (/[^.]\.$/.test(value.trim()) && !/(^|\s)(\p{L}|vb|vd|vs|haz|thk|çev|nşr|ed|eds|bs|yy|ts|nr|no|c|s|ss|st|dr|prof|doç|mlf)\.$/iu.test(value.trim())) add({ code: "title-period", level: "warning", message: `${label} nokta ile bitiyor; noktayı stil koyar.`, field, fix: { field, value: value.trim().replace(/\.$/, "") }, fixLabel: "Noktayı sil" });
      if (/['’ʿ‘`]/.test(value) && new Set(value.match(/['’ʿ‘`]/g)).size > 1) add({ code: "apostrophes", level: "info", message: `${label}: farklı kesme / ayın işaretleri karışık kullanılmış (' ’ ʿ ‘).`, field });
    }
    if (base === "pages") {
      const p = value.replace(/^\s*(s|ss|sf|pp?)\.\s*/i, "").replace(/\s*[–—‒−]\s*/g, "-").replace(/\s*-\s*/g, "-");
      if (p !== value) add({ code: "pages", level: "warning", message: `Sayfa aralığı İSNAD biçiminde değil ("${value}" → "${p}").`, field, fix: { field, value: p }, fixLabel: "Düzelt" });
    }
    if (base === "volume") {
      const v = value.replace(/^\s*(c|cilt|vol|volume)\.?\s*/i, "");
      if (v !== value) add({ code: "volume", level: "warning", message: `Cilt alanına yalnız numara yazılır ("${v}").`, field, fix: { field, value: v }, fixLabel: "Düzelt" });
    }
    if (base === "issue") {
      const v = value.replace(/^\s*(s|sayı|no|issue)\.?\s*/i, "");
      if (v !== value) add({ code: "issue", level: "warning", message: `Sayı alanına yalnız numara yazılır ("${v}").`, field, fix: { field, value: v }, fixLabel: "Düzelt" });
    }
    if (base === "edition") {
      const m = /^\s*(\d+)\s*\.?\s*(bs|baskı|basım|baskı|ed|edition)?\.?\s*$/i.exec(value);
      if (m && m[1] !== value) add({ code: "edition", level: "warning", message: `Baskı alanına yalnız sayı yazılır; "Basım" sözünü stil ekler.`, field, fix: { field, value: m[1]! }, fixLabel: `"${m[1]}" yap` });
    }
    if (base === "DOI") {
      const d = /10\.\d{4,9}\/\S+/.exec(value)?.[0];
      if (!d) add({ code: "doi", level: "error", message: "DOI geçersiz (10.xxxx/… biçiminde olmalı).", field });
      else if (d !== value.trim()) add({ code: "doi-url", level: "warning", message: "DOI alanına yalnız DOI yazılır (adres değil).", field, fix: { field, value: d }, fixLabel: "Düzelt" });
    }
    if (base === "ISBN" && !value.split(/[\s,;]+/).every((x) => !x || isbnValid(x))) add({ code: "isbn", level: "warning", message: "ISBN numarası hatalı görünüyor (denetim hanesi tutmuyor).", field });
    if (base === "url" && !/^https?:\/\//i.test(value.trim())) add({ code: "url", level: "warning", message: "Web adresi http:// veya https:// ile başlamalı.", field, fix: { field, value: `https://${value.trim()}` }, fixLabel: "https:// ekle" });
    if (base === "date" || base === "accessDate") {
      const d = parseDate(value);
      if (d?.literal && !/^\d{3,4}\/\d{3,4}$/.test(d.literal) && !/^\d{3,4}-\d{3,4}$/.test(d.literal)) add({ code: "date", level: "warning", message: `Tarih anlaşılamadı ("${value}"). Yıl, gün.ay.yıl veya hicrî/milâdî (1413/1993) yazın.`, field });
    }
  }

  // Creators.
  item.creators.forEach((c, i) => {
    const full = c.name ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`;
    const fixedEnc = fixEncoding(full);
    if (fixedEnc !== full) {
      add({ code: "encoding", level: "error", message: `Kişi adı: bozuk Türkçe karakter (${full}).`, creatorIndex: i, fix: { creatorIndex: i, creator: mapCreator(c, fixEncoding) }, fixLabel: "Karakterleri düzelt" });
      return;
    }
    if (c.name !== undefined && restoreTurkish(c.name) !== c.name) {
      add({ code: "turkish-letters", level: "warning", message: `Kurum adı: Türkçe harfler eksik ("${restoreTurkish(c.name)}").`, creatorIndex: i, fix: { creatorIndex: i, creator: { ...c, name: restoreTurkish(c.name) } }, fixLabel: "Düzelt" });
    }
    const acronym = c.name !== undefined && /^[\p{Lu}.\s]{2,10}$/u.test(c.name.trim());
    if (isAllCaps(full) && !acronym) add({ code: "name-caps", level: "warning", message: `Kişi adı büyük harfle yazılmış (${full.trim()}).`, creatorIndex: i, fix: { creatorIndex: i, creator: mapCreator(c, isnadName) }, fixLabel: "Düzelt" });
    else if (c.creatorType !== "contributor" && [c.name, c.lastName, c.firstName].some((x) => x && nameNeedsCase(x)) && !(c.name && /\p{Lu}{2}/u.test(c.name))) {
      const fixedName = mapCreator(c, (x) => (nameNeedsCase(x) ? isnadName(x) : x));
      add({ code: "name-case", level: "warning", message: `Kişi adının baş harfleri büyük yazılmalı (${full.trim()}).`, creatorIndex: i, fix: { creatorIndex: i, creator: fixedName }, fixLabel: "Düzelt" });
    }
    if (c.name === undefined && c.lastName?.includes(",") && !c.firstName) {
      const [last, first] = c.lastName.split(",").map((s) => s.trim());
      add({ code: "name-comma", level: "warning", message: `Ad ve soyad tek kutuya yazılmış (${c.lastName}).`, creatorIndex: i, fix: { creatorIndex: i, creator: { creatorType: c.creatorType, lastName: last, firstName: first } }, fixLabel: "Ayır" });
    }
    if (c.name === undefined && !c.lastName?.trim() && c.firstName?.trim()) add({ code: "name-last", level: "warning", message: `Soyad / şöhret kutusu boş (${c.firstName}).`, creatorIndex: i });
  });

  // İSNAD abbreviations typed into the record: Derkenar writes them itself.
  for (const [base, abbr] of [["place", ["b.y.", "y.y.", "yy.", "b.y", "y.y"]], ["publisher", ["y.y.", "y.y.y.", "yyy.", "y.y", "y.y.y"]], ["date", ["ts.", "ts", "t.y.", "t.y"]]] as const) {
    const field = typeField(item.itemType, base);
    const v = field ? f[field]?.trim().toLocaleLowerCase("tr") : undefined;
    if (field && v && (abbr as readonly string[]).includes(v)) {
      add({ code: "abbr-in-field", level: "info", message: `${fieldLabel(field)} alanına "${f[field]}" yazılmış. Bu alanı boş bırakın; İSNAD kısaltmasını (${base === "place" ? "b.y." : base === "publisher" ? "y.y." : "ts."}) Derkenar kendisi yazar.`, field, fix: { field, value: "" }, fixLabel: "Alanı boşalt" });
    }
  }

  // Publisher, place, year, short title as İSNAD writes them.
  const placeField = typeField(item.itemType, "place");
  const pubField = typeField(item.itemType, "publisher");
  const place = placeField ? f[placeField]?.trim() : "";
  const publisher = pubField ? f[pubField]?.trim() : "";
  const abbr = /^(b\.?y\.?|y\.?y\.?(y\.?)?|ts\.?)$/i;
  if (placeField && place && !abbr.test(place)) {
    const p = isnadPlace(place);
    if (p !== place) add({ code: "place", level: "warning", message: `Basım yeri İSNAD'da "${p}" diye yazılır.`, field: placeField, fix: { field: placeField, value: p }, fixLabel: `"${p}" yap` });
  }
  const turkish = Boolean((place && isTurkishPlace(place)) || /^(tr|tur|türkçe|turkish)/i.test(f.language ?? "") || /[çğışöüÇĞİŞÖÜ]/.test(publisher ?? ""));
  const isBookish = ["book", "bookSection", "encyclopediaArticle", "dictionaryEntry", "conferencePaper", "report"].includes(item.itemType);
  if (pubField && publisher && !abbr.test(publisher) && isBookish) {
    const fix = isnadPublisher(publisher, turkish);
    if (fix?.known) add({ code: "publisher-known", level: "warning", message: `Yayınevinin tam adı: "${fix.value}".`, field: pubField, fix: { field: pubField, value: fix.value }, fixLabel: `"${fix.value}" yap` });
    else if (fix) add({ code: "publisher-case", level: "warning", message: `Yayınevi adı: "${fix.value}".`, field: pubField, fix: { field: pubField, value: fix.value }, fixLabel: "Düzelt" });
    else if (turkish && publisherLooksShort(publisher)) {
      add({ code: "publisher-short", level: "warning", message: `Yayınevi adı eksik olabilir: İSNAD'da tam adıyla yazılır (ör. "${publisher} Yayınları", "${publisher} Yayınevi", "${publisher} Neşriyat"). Kitabın künye sayfasındaki adı yazın.`, field: pubField, fix: { field: pubField, value: `${publisher} Yayınları` }, fixLabel: `"${publisher} Yayınları" yap` });
    }
  }
  if (f.date && isBookish) {
    const y = cleanYear(f.date);
    if (y) add({ code: "date-clean", level: "warning", message: `Tarih alanına yalnız yıl yazılır ("${f.date}" → "${y}").`, field: "date", fix: { field: "date", value: y }, fixLabel: `"${y}" yap` });
    const year = Number(/^\d{4}/.exec(f.date.trim())?.[0] ?? (/\/(\d{4})$/.exec(f.date.trim())?.[1] ?? 0));
    if (year > new Date().getFullYear() + 1) add({ code: "date-future", level: "warning", message: `Yıl ileri bir tarih (${year}); denetleyin.`, field: "date" });
  }
  const stField = typeField(item.itemType, "shortTitle") ?? (f.shortTitle !== undefined ? "shortTitle" : undefined);
  if (f.title && !f.shortTitle?.trim() && ["book", "bookSection", "journalArticle", "encyclopediaArticle", "thesis", "manuscript", "conferencePaper", "report", "dictionaryEntry"].includes(item.itemType)) {
    const st = shortTitleOf(isnadTitle(f.title));
    if (st) add({ code: "short-title", level: "info", message: `Kısa başlık yok; sonraki atıflarda kullanılacak kısa ad: "${st}".`, field: stField ?? "shortTitle", fix: { field: stField ?? "shortTitle", value: st }, fixLabel: `"${st}" yaz` });
  }

  // Cilt sayısı written into Cilt (a 6-volume work entered as "Cilt: 6").
  const volField = typeField(item.itemType, "volume");
  const nvolField = typeField(item.itemType, "numberOfVolumes");
  if ((item.itemType === "book" || item.itemType === "bookSection") && volField && nvolField && f[volField]?.trim() && !f[nvolField]?.trim() && /^\d+$/.test(f[volField]!.trim())) {
    add({
      code: "volume-count",
      level: "warning",
      message: `Cilt alanında "${f[volField]}" yazıyor. Bu, kaydın tek bir cildiyse doğru; eserin toplam cilt sayısıysa Cilt Sayısı alanına yazılmalı (kaynakçada "${f[volField]} Cilt" olarak çıkar, dipnotta çıkmaz).`,
      field: volField,
      fix: { field: volField, value: "", moveTo: nvolField },
      fixLabel: "Cilt Sayısı'na taşı",
    });
  }

  // Container wrongly in the title.
  if (item.itemType === "journalArticle" && f.title && containerOf(item) && f.title.includes(containerOf(item))) {
    add({ code: "title-container", level: "info", message: "Başlıkta dergi adı geçiyor; dergi adı kendi alanında olmalı.", field: "title" });
  }
  return out;
}

function mapCreator(c: Creator, fn: (s: string) => string): Creator {
  return { creatorType: c.creatorType, ...(c.name !== undefined ? { name: fn(c.name) } : { lastName: fn(c.lastName ?? ""), ...(c.firstName ? { firstName: fn(c.firstName) } : {}) }) };
}

export function applyFix(item: Item, patch: Patch): Item {
  const next: Item = { ...item, fields: { ...item.fields }, creators: [...item.creators] };
  if (patch.field !== undefined && patch.moveTo) next.fields[patch.moveTo] = item.fields[patch.field] ?? "";
  if (patch.field !== undefined && patch.value !== undefined) {
    if (patch.value === "") delete next.fields[patch.field];
    else next.fields[patch.field] = patch.value;
  }
  if (patch.creatorIndex !== undefined && patch.creator) next.creators[patch.creatorIndex] = patch.creator;
  return next;
}

/** Library-wide: the same apostrophe style everywhere (ʿ vs ' vs ’) in transliterated titles. */
export function apostropheReport(items: readonly Item[]): { mark: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const it of items) for (const m of (it.fields.title ?? "").match(/['’ʿ‘]/g) ?? []) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([mark, count]) => ({ mark, count })).sort((a, b) => b.count - a.count);
}

export const LEVEL_LABEL: Record<Level, string> = { error: "Hata", warning: "Uyarı", info: "Bilgi" };

/** Fixes applied by themselves when a work is added (DOI, ISBN, pasted record): mechanical, safe ones. */
const AUTO = new Set(["turkish-letters", "encoding", "spaces", "caps", "title-case", "title-period", "name-caps", "name-case", "name-comma", "pages", "edition", "doi-url", "abbr-in-field", "place", "publisher-known", "publisher-case", "date-clean", "short-title"]);
const AUTO_LABEL: Record<string, string> = {
  "turkish-letters": "eksik Türkçe harfler",
  encoding: "bozuk karakterler",
  spaces: "fazla boşluklar",
  caps: "büyük harfle yazılmış başlık",
  "title-case": "başlıkta büyük-küçük harf",
  "title-period": "başlık sonundaki nokta",
  "name-caps": "kişi adları",
  "name-case": "kişi adları",
  "name-comma": "ad-soyad ayrımı",
  pages: "sayfa aralığı",
  edition: "baskı",
  "doi-url": "DOI",
  "abbr-in-field": "elle yazılmış kısaltma",
  place: "basım yeri",
  "publisher-known": "yayınevinin tam adı",
  "publisher-case": "yayınevi adı",
  "date-clean": "yıl",
  "short-title": "kısa başlık",
};

/** Applies the safe İSNAD fixes; returns the fixed item and what was changed. */
export function autoFix(item: Item): { item: Item; changed: string[] } {
  let next = item;
  const changed = new Set<string>();
  const seen = new Set<string>();
  for (let n = 0; n < 60; n++) {
    const issue = checkItem(next).find((i) => i.fix && AUTO.has(i.code) && !seen.has(JSON.stringify([i.code, i.fix])));
    if (!issue) break;
    seen.add(JSON.stringify([issue.code, issue.fix]));
    next = applyFix(next, issue.fix!);
    changed.add(AUTO_LABEL[issue.code] ?? issue.code);
  }
  return { item: next, changed: [...changed] };
}

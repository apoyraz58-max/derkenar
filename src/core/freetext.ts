/**
 * Serbest künye: a reference copied from anywhere (another thesis's
 * bibliography, a footnote, a PDF, a web page) split into a record.
 *
 * İSNAD is read first, both ways it is written:
 *   dipnot    Ebû Hâmid Muhammed el-Gazzâlî, el-Mustasfâ, thk. Hamza b. Züheyr Hâfız (Medine: el-Câmiatü'l-İslâmiyye, 1413/1993), 1/45.
 *             Sönmez Kutlu, “İlk Mürciî Metinler”, Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 320.
 *   kaynakça  Gazzâlî, Ebû Hâmid Muhammed. el-Mustasfâ. thk. Hamza b. Züheyr Hâfız. 4 Cilt. Medine: el-Câmiatü'l-İslâmiyye, 1413/1993.
 *             Kutlu, Sönmez. “İlk Mürciî Metinler”. Ankara Üniversitesi İlahiyat Fakültesi Dergisi 37 (1997), 317-331.
 * then APA ("Kutlu, S. (1997). Başlık. Dergi, 37(1), 317–331.") and the
 * plain "Yer: Yayınevi, Yıl" of other styles. What could not be told for sure
 * is listed in `unsure`, so the user looks only at that.
 */
import { placeIn } from "./isnadstyle.js";
import { type Creator, type Item, emptyItem, typeField } from "./zotero.js";

/** Writes a base field ("publicationTitle", "publisher" …) under the name the item type gives it. */
function put(item: Item, base: string, value: string): void {
  if (value) item.fields[typeField(item.itemType, base) ?? base] = value;
}

/** Fields set before the type was known move to the type's own names (publicationTitle → encyclopediaTitle …); authors come first. */
function settle(item: Item): Item {
  const rank = (t: string) => (t === "author" ? 0 : t === "editor" && !item.creators.some((c) => c.creatorType === "author") ? 0 : 1);
  item.creators = item.creators.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.creatorType) - rank(b.c.creatorType) || a.i - b.i).map((x) => x.c);
  for (const base of ["publicationTitle", "publisher", "place", "type"]) {
    const v = item.fields[base];
    const own = typeField(item.itemType, base);
    if (v !== undefined && own && own !== base) {
      item.fields[own] = v;
      delete item.fields[base];
    }
  }
  return item;
}

export interface ParsedReference {
  readonly item: Item;
  readonly form: "isnad-dipnot" | "isnad-kaynakca" | "apa" | "diger";
  /** Fields worth a look ("yazar", "yer", …). */
  readonly unsure: string[];
}

const ROLE: Record<string, string> = {
  "thk.": "muhakkik",
  "nşr.": "nasir",
  "haz.": "hazirlayan",
  "sad.": "sadelestiren",
  "mlf.": "muellif",
  "çev.": "translator",
  "trans.": "translator",
  "ed.": "editor",
  "eds.": "editor",
  "critical ed.": "muhakkik",
  "Türkçeye çev.": "turkceye",
};
const ROLE_RE = /^(Türkçeye çev\.|critical ed\.|thk\.|nşr\.|haz\.|sad\.|mlf\.|çev\.|trans\.|eds?\.)\s+(.+)$/i;

const MONTHS: Record<string, number> = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12, january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const DATE = String.raw`(?:(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|january|february|march|april|may|june|july|august|september|october|november|december)\s+)?(?:\d{3,4}(?:-\d{2,4})?(?:\/\d{3,4}(?:-\d{2,4})?)?(?:\s*\[\d{4}\])?|ts\.|n\.d\.)`;
const ARTICLES = /^(el|er|ez|es|eş|en|et|ed|eṭ|eṣ|eḍ|eẓ|al|ad|an|ar|as|at|az)-/i;

/** "12 Mart 2024" → "2024-03-12". */
function dayMonthYear(s: string): string | undefined {
  const m = /(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/u.exec(s);
  const mo = m ? MONTHS[m[2]!.toLocaleLowerCase("tr")] : undefined;
  return m && mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : undefined;
}

/** "Ebû Hâmid Muhammed b. Muhammed el-Gazzâlî": the last word is the surname, its article stays with the given name (İSNAD's Zotero rule). */
function nameInOrder(raw: string, creatorType: string): Creator {
  const n = raw.trim().replace(/\s+/g, " ").replace(/[,;]$/, "");
  // "Türkiye Yazma Eserler Kurumu Başkanlığı (TYEKB)": İSNAD's Zotero rule keeps the acronym as the surname.
  const acr = /^(.+?)\s+\((\p{Lu}[\p{Lu}.\s]{1,9})\)$/u.exec(n);
  if (acr) return { creatorType, lastName: acr[2]!, firstName: acr[1]! };
  if (!/\s/.test(n)) return { creatorType, name: n };
  // A title of honour ends the name: "Taşköprizâde Ahmed Efendi", "Ahmed Cevdet Paşa".
  // ("Çelebi", "Dede", "Hoca" are also today's surnames: "İlyas Çelebi"; a title only after an Ottoman name: "Kâtib Çelebi", "Evliyâ Çelebi".)
  if (/\s(Efendi|Paşa|Bey|Hanım|Ağa)$/u.test(n) || (/\s(Çelebi|Hoca|Dede)$/u.test(n) && /[âîûÂÎÛ]|^(Evliya|Kâtib|Katib|Âşık|Aşık|Şeyh|Molla|Hacı|Hoca|Lâmiî|Sâî)\s/u.test(n))) return { creatorType, name: n };
  // An institution: "Türk Standardları Enstitüsü".
  if (/\b(Enstitüsü|Üniversitesi|Başkanlığı|Bakanlığı|Kurumu|Vakfı|Derneği|Merkezi|University|Institute|Foundation|Ministry)\b/.test(n)) return { creatorType, name: n };
  const words = n.split(" ");
  // "Ahmed b. Hanbel": the well-known name is the whole "X b. Y" (DİA, İSNAD).
  if (words.length === 3 && /^(b\.|bin|bint|bt\.)$/i.test(words[1]!)) return { creatorType, name: n };
  // "… Muhammed b. Yezîd İbn Mâce", "… İbnü’l-Arabî": "İbn Mâce" is the surname.
  if (words.length >= 3 && /^(İbn|Ibn|İbni|İbnü’l|İbnü'l)$/.test(words[words.length - 2]!)) {
    const last2 = words.splice(-2).join(" ");
    return { creatorType, lastName: last2, firstName: words.join(" ") };
  }
  if (words.length === 2 && /^(İbn|Ibn|İbni)$/.test(words[0]!)) return { creatorType, name: n };
  const last = words.pop()!;
  const art = ARTICLES.exec(last);
  if (art) return { creatorType, lastName: last.slice(art[0].length), firstName: `${words.join(" ")} ${art[0].toLocaleLowerCase("tr")}` };
  return { creatorType, lastName: last, firstName: words.join(" ") };
}

/** "Gazzâlî, Ebû Hâmid Muhammed el-" (kaynakça order). */
function nameInverted(raw: string, creatorType: string): Creator {
  const [last, ...first] = raw.split(",");
  const firstName = first.join(",").trim().replace(/[.]$/, (m) => (/\b\p{Lu}$/u.test(first.join(",").trim().slice(0, -1)) ? m : ""));
  return firstName ? { creatorType, lastName: last!.trim(), firstName } : { creatorType, name: last!.trim() };
}

/** "A - B", "A-B", "A ve B", "A vd." → names; "vd." / "et al." are dropped (the record cannot hold the others). */
function splitNames(s: string): { names: string[]; more: boolean } {
  let t = s.trim();
  const more = /\s(vd\.|et al\.?)$/i.test(t);
  t = t.replace(/\s(vd\.|et al\.?)$/i, "").trim();
  const names = t.split(/\s+[-–]\s+|\s+ve\s+|\s+and\s+|\s*&\s*|(?<=\p{Ll}{3})-(?=\p{Lu}\p{Ll}{2})/u).map((x) => x.trim()).filter(Boolean);
  return { names, more };
}

function setDate(item: Item, d: string): void {
  const t = d.trim().replace(/\s*\[\d{4}\]$/, "");
  if (t && !/^(ts\.|n\.d\.)$/i.test(t)) item.fields.date = t;
}

/** "Medine: el-Câmiatü'l-İslâmiyye, 2. Basım, 1413/1993" (also "Bursa: Uludağ Üniversitesi, İlahiyat Fakültesi, Lisans Tezi, 2002"). */
function readImprint(item: Item, s: string): boolean {
  // Gaps in the imprint, as hand-typed references have them: "(2001)", "(İstanbul: 2001)", "(İstanbul, 2001)".
  const onlyDate = new RegExp(String.raw`^\s*(${DATE})\s*$`, "iu").exec(s);
  if (onlyDate) {
    setDate(item, onlyDate[1]!.replace(/^\p{L}+\s+/u, ""));
    return true;
  }
  const placeDate = new RegExp(String.raw`^\s*([^:,()]{2,40}?)\s*[:,]\s*(${DATE})\s*$`, "iu").exec(s);
  if (placeDate && placeIn(placeDate[1]!) && !/\b(yay|yayın|neşriyat|kitabevi|matbaa|press|basımevi|vakfı|kurumu)/i.test(placeDate[1]!)) {
    item.fields.place = placeDate[1]!.trim();
    setDate(item, placeDate[2]!);
    return true;
  }
  const m = new RegExp(String.raw`^\s*(?:([^:]{2,60}?):\s*)?(.+?),\s*(?:(\d+)\.\s*(?:Basım|bs\.|ed\.|edition),\s*)?(${DATE})\s*$`, "iu").exec(s);
  if (!m) return false;
  const [, place, middle, edition, date] = m;
  if (place && !/^(b\.y\.|s\.l\.)$/i.test(place.trim())) item.fields.place = place.trim();
  const parts = middle!.split(/,\s*/);
  // A thesis: "Üniversite, Enstitü, Doktora Tezi".
  const thesisAt = parts.findIndex((p) => /\b(Tezi|Thesis|Dissertation|Habilitation)\b/i.test(p));
  if (thesisAt >= 0) {
    item.itemType = "thesis";
    item.fields.thesisType = parts[thesisAt]!.trim();
    item.fields.university = parts.slice(0, thesisAt).join(", ").trim();
  } else {
    const pub = middle!.trim();
    if (!/^(y\.y\.|s\.n\.)$/i.test(pub)) item.fields.publisher = pub;
  }
  if (edition) item.fields.edition = edition;
  // A book is dated by its year ("Kasım 1996" → 1996).
  setDate(item, date!.replace(/^\p{L}+\s+/u, ""));
  return true;
}

/** "thk. A - B", "çev. C", "Türkçeye çev. D" … after the title. */
function readRoles(item: Item, parts: string[]): string[] {
  const rest: string[] = [];
  for (const p of parts) {
    const m = ROLE_RE.exec(p.trim());
    if (!m) {
      rest.push(p);
      continue;
    }
    const role = ROLE[m[1]!] ?? ROLE[m[1]!.toLowerCase()] ?? "editor";
    for (const n of splitNames(m[2]!).names) item.creators.push(/,/.test(n) ? nameInverted(n, role) : nameInOrder(n, role));
  }
  return rest;
}

function stripLeading(s: string): string {
  return s
    .trim()
    .replace(/^(\[\d+\]|\d+[.)]\s|\d+\s+(?=\p{Lu}))/u, "")
    .replace(/\s+/g, " ")
    // "eş- Şuhâvî": a broken line left a space after the article.
    .replace(/(?<=^|[\s(])(el|er|ez|es|eş|en|et|ed|al)-\s+(?=\p{Lu})/gu, "$1-")
    .replace(/[„"]([^"“”]+?)["“”]/g, "“$1”")
    .replace(/[‘']{2}([^'’]+?)[’']{2}/g, "“$1”")
    .trim();
}

function readUrl(item: Item, s: string): string {
  let t = s;
  // A DOI, also written as an address ("https://doi.org/10.…").
  const doiUrl = /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+?)[.,;]?(?=\s|$)/i.exec(t);
  if (doiUrl) {
    item.fields.DOI = doiUrl[1]!;
    t = t.replace(doiUrl[0], "").trim();
  }
  // A bare "www.davet.org.tr" at the end is an address too.
  const url = /(https?:\/\/\S+?)[.,;)]?(?=\s|$)/.exec(t) ?? /(?<=^|\s)(www\.[\w-]+(?:\.[\w-]+)+(?:\/\S*?)?)[.,;]?$/.exec(t);
  if (url) {
    item.fields.url = url[1]!;
    t = t.replace(url[0], "").trim();
  }
  const doi = /\b(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s,;]+?)[.,;]?(?=\s|$)/i.exec(t + " ");
  if (doi) {
    item.fields.DOI = doi[1]!;
    t = t.replace(doi[0], "").trim();
    if (item.fields.url && /doi\.org/.test(item.fields.url)) delete item.fields.url;
  }
  const access = /\(?(?:Erişim|Access(?:ed)?)(?: Tarihi)?:?\s+([^)]+?)\)?(?=[.,]?\s*$|[.,]\s)/i.exec(t);
  if (access) {
    const d = dayMonthYear(access[1]!);
    // "Erişim Ocak 2019": a month without a day.
    const my = /^(\p{L}+)\s+(\d{4})$/u.exec(access[1]!.trim());
    const mo = my ? MONTHS[my[1]!.toLocaleLowerCase("tr")] : undefined;
    if (d) item.fields.accessDate = d;
    else if (my && mo) item.fields.accessDate = `${my[2]}-${String(mo).padStart(2, "0")}`;
    t = t.replace(access[0], "").trim();
  }
  return t.replace(/[.,;:\s]+$/, "");
}

// ---------------------------------------------------------------- İSNAD dipnot

/** "Ad Soyad, Başlık, thk. X (Yer: Yayınevi, Yıl), 45." and the article / web forms. */
function isnadNote(s: string): ParsedReference | null {
  const item = emptyItem("book", "serbest");
  const unsure: string[] = [];
  let t = readUrl(item, s);

  // Article: Ad Soyad, “Makale”, Dergi 37/1 (Haziran 1997), 320.
  const art = /^(.*?),?\s*“([^”]+)”,\s*(.+?)\s+(\d+)(?:\/(\d+))?\s+\(([^)]*?\d{4})\)(?:,\s*([\d\-–]+))?\.?$/u.exec(t);
  if (art && !/:/.test(art[3]!)) {
    item.itemType = "journalArticle";
    // A text published in an article (İSNAD 14.3): "Müellif, Eserin Adı, “Makale”, nşr. X, Dergi …"; the work's name is kept apart.
    const lead = topSplit(art[1]!, ",");
    if (lead.length >= 2 && looksLikeName(lead[0]!) && !lead.slice(1).some((x) => ROLE_RE.test(x.trim()))) {
      item.fields.seriesText = lead.slice(1).join(", ").trim();
      art[1] = lead[0]!;
    }
    authorsInOrder(item, art[1]!);
    item.fields.title = art[2]!;
    const container = readRoles(item, art[3]!.split(/,\s*/));
    item.fields.publicationTitle = container.join(", ");
    item.fields.volume = art[4]!;
    if (art[5]) item.fields.issue = art[5];
    const d = /(\p{L}+)?\s*(\d{4})$/u.exec(art[6]!);
    item.fields.date = d![2]!;
    if (d![1]) {
      const mo = MONTHS[d![1].toLocaleLowerCase("tr")];
      if (mo) item.fields.date = `${d![2]}-${String(mo).padStart(2, "0")}`;
    }
    unsure.push("sayfa aralığı");
    return { item: settle(item), form: "isnad-dipnot", unsure };
  }

  // Book, chapter, encyclopedia: everything before "(Yer: Yayınevi, Yıl)" — the last parenthesis that is an imprint.
  let imp: RegExpExecArray | null = null;
  for (const m of t.matchAll(/\(([^()]*?(?:\d{3,4}(?:-\d{2,4})?(?:\/\d{3,4}(?:-\d{2,4})?)?|ts\.|n\.d\.))\)/gu)) {
    // A bare year, "Kitap (2001)", is an imprint with gaps; not after a volume ("Dergisi 37 (1997)") or a quoted title (an article).
    const before = t.slice(0, m.index).trim();
    if (/[:,]/.test(m[1]!) || (!/[“"]/.test(before) && !/\d[\s/]*$/.test(before) && /,/.test(before))) imp = Object.assign([m[0], t.slice(0, m.index).trim(), m[1]!, t.slice(m.index! + m[0].length)], { index: m.index!, input: t }) as unknown as RegExpExecArray;
  }
  if (imp) {
    if (!readImprint(item, imp[2]!)) return null;
    const head = imp[1]!;
    const after = imp[3]!.replace(/^[,\s]+/, "").replace(/\.$/, "");
    const quoted = /^(.*?),?\s*“([^”]+)”,\s*(.+)$/u.exec(head);
    if (quoted) {
      authorsInOrder(item, quoted[1]!);
      item.fields.title = quoted[2]!;
      const parts = readRoles(item, quoted[3]!.split(/,\s*/));
      const container = parts.join(", ").trim();
      if (/Ansiklopedi|Encyclop/i.test(container)) {
        item.itemType = "encyclopediaArticle";
        item.fields.publicationTitle = container;
        const vp = /^(\d+)\/([\d\-–]+)/.exec(after);
        if (vp) item.fields.volume = vp[1]!;
        unsure.push("sayfa aralığı");
      } else {
        item.itemType = "bookSection";
        item.fields.publicationTitle = container;
        unsure.push("sayfa aralığı");
      }
    } else {
      let parts = splitHead(head);
      // A title with a subtitle ("Kutsal Kitap: Tevrat, Zebur, İncil") is not an author.
      if (/:/.test(parts[0]!)) parts = [parts.filter((p) => !ROLE_RE.test(p)).join(", "), ...parts.filter((p) => ROLE_RE.test(p))].filter(Boolean);
      // İSNAD: "Yazar, Başlık[, roller]". With one part only, the work has no author ("Kitâb-ı Mukaddes").
      const roles = readRoles(item, parts.slice(1));
      if (roles.length >= 1) {
        authorsInOrder(item, parts[0]!);
        item.fields.title = roles.join(", ");
        if (!looksLikeName(parts[0]!.replace(/\s*\([^)]*\)$/, "")) && !/\(/.test(parts[0]!)) unsure.push("yazar");
      } else {
        item.fields.title = parts[0]!;
      }
    }
    if (item.itemType === "book" && !item.creators.length) unsure.push("yazar");
    return { item: settle(item), form: "isnad-dipnot", unsure };
  }

  // Web: Ad Soyad, “Başlık”, Site (Erişim 12 Mart 2024) — a quoted title is a page; an italic one a book or portal online.
  if (item.fields.accessDate || item.fields.url) {
    const q = /^(.*?),?\s*“([^”]+)”(?:,\s*(.+))?$/u.exec(t);
    if (q) {
      const site = readRoles(item, (q[3] ?? "").split(/,\s*/)).join(", ");
      item.itemType = /Ansiklopedi|Encyclop/i.test(site) ? "encyclopediaArticle" : "webpage";
      authorsInOrder(item, q[1]!);
      item.fields.title = q[2]!;
      if (site) put(item, "publicationTitle", site);
    } else {
      const parts = splitHead(t);
      if (parts.length > 1) {
        authorsInOrder(item, parts[0]!);
        item.fields.title = parts.slice(1).join(", ");
      } else item.fields.title = t;
    }
    return { item: settle(item), form: "isnad-dipnot", unsure };
  }
  return null;
}

/**
 * Sentences of a kaynakça entry: split at ". " but not after an abbreviation
 * that belongs to the text ("b. Muhammed", "3. Basım", "thk. X", "M. Sait",
 * "s.a.v.") nor inside parentheses or quotes.
 */
function sentencesOf(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "“") quote = true;
    else if (ch === "”") quote = false;
    if (ch === "." && s[i + 1] === " " && depth === 0 && !quote) {
      const word = /(\S+)$/.exec(cur)?.[1] ?? "";
      const abbrev = (/^[IVXLC]{1,5}$/.test(word) && cur.trim() === word) || (/^\d{1,2}-\d{1,2}$/.test(word) && /^ (yüzyıl|yy\.)/.test(s.slice(i + 1))) || /^(b|bin|bnt|\d{1,3}|\p{Lu}|thk|nşr|haz|çev|ed|eds|sad|mlf|Türkçeye|trans|s\.a|r\.a|Hz|St|Dr|Prof|Doç|vol|no|No)$/u.test(word) && !/^\d{4}$/.test(word) && s[i + 2] !== "“";
      if (!abbrev) {
        out.push(cur.trim());
        cur = "";
        i++;
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().replace(/\.$/, ""));
  return out.filter(Boolean);
}

/** "A (B, C), D" → ["A (B, C)", "D"]: commas inside parentheses do not split. */
function splitHead(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0 && s[i + 1] === " ") {
      out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function looksLikeName(s: string): boolean {
  const w = s.trim().split(/\s+/);
  return w.length >= 2 && w.length <= 9 && /^\p{Lu}/u.test(w[0]!) && !/[:“”]/.test(s) && w.filter((x) => /^\p{Lu}|^(b\.|bin|ibn|el-|er-|ez-|es-|et-|en-|ed-|eş-|al-)/u.test(x)).length >= w.length - 1;
}

function authorsInOrder(item: Item, s: string): void {
  let t = s.trim().replace(/,$/, "");
  if (!t) return;
  // "Geoffrey Roper (ed.)", "Ahmet Hamdi Furat vd. (ed.)": editors of the whole book.
  const ed = /\s*\((eds?\.|ed\.|haz\.)\)$/i.exec(t);
  const role = ed ? (/haz/i.test(ed[1]!) ? "hazirlayan" : "editor") : "author";
  if (ed) t = t.slice(0, ed.index).trim();
  for (const n of splitNames(t).names) item.creators.push(nameInOrder(n, role));
}

// ---------------------------------------------------------------- İSNAD kaynakça

/** "Soyad, Ad. Başlık. thk. X. Yer: Yayınevi, Yıl." and the article / chapter / encyclopedia forms. */
function isnadBib(s: string): ParsedReference | null {
  const item = emptyItem("book", "serbest");
  const unsure: string[] = [];
  const t = readUrl(item, s);
  let rest = t;
  const sents = sentencesOf(t);
  const first = sents[0] ?? "";
  // "Soyad, Ad" (and "Soyad, Ad - Soyad2, Ad2", "… vd.", "… (ed.)"); an honorific single name ("Taşköprizâde Ahmed Efendi").
  const ed = /\s*\((eds?\.|haz\.)\)$/i.exec(first);
  const who = ed ? first.slice(0, ed.index) : first;
  const role = ed ? (/haz/i.test(ed[1]!) ? "hazirlayan" : "editor") : "author";
  const enough = sents.length > 2 || (sents.length === 2 && Boolean(item.fields.url || item.fields.accessDate));
  const inverted = /^[^,“”]+,\s*[^,“”]+(\s+[-–]\s+[^,“”]+,\s*[^,“”]+)*(\s+vd\.?)?$/u.test(who) && enough;
  const honour = /^[^,“”]+\s(Efendi|Paşa|Bey|Hanım|Ağa|Çelebi|Hoca|Dede)$/u.test(who) && enough;
  if (inverted || honour) {
    for (const n of splitNames(who).names) item.creators.push(inverted ? nameInverted(n, role) : { creatorType: role, name: n });
    rest = sents.slice(1).join(". ");
  }
  // Article: “Makale”. Dergi 37/1 (1997), 317-331.
  const art = /^“([^”]+)”\.?\s*(.+?)\s+(\d+)(?:\/(\d+))?\s+\(([^)]*?\d{4})\),\s*([\d\-–]+)\.?$/u.exec(rest);
  if (art && !/:\s/.test(art[2]!)) {
    item.itemType = "journalArticle";
    item.fields.title = art[1]!;
    const container = readRoles(item, sentencesOf(art[2]!));
    item.fields.publicationTitle = container.join(". ").replace(/\.$/, "");
    item.fields.volume = art[3]!;
    if (art[4]) item.fields.issue = art[4];
    const d = /(\d{4})$/.exec(art[5]!);
    item.fields.date = d![1]!;
    item.fields.pages = art[6]!.replace("–", "-");
    return { item: settle(item), form: "isnad-kaynakca", unsure };
  }
  // The imprint is the last sentence: "Yer: Yayınevi, Yıl." — a web source may have none.
  const sentences = sentencesOf(rest);
  const last = sentences[sentences.length - 1]!.replace(/\.$/, "");
  let parts: string[];
  if (readImprint(item, last)) parts = sentences.slice(0, -1);
  else if (item.fields.url || item.fields.accessDate) parts = sentences;
  else return null;
  if (!parts.length) return null;
  let title = parts.shift()!;
  const quoted = /^“([^”]+)”$/u.exec(title.trim());
  if (quoted) {
    item.fields.title = quoted[1]!;
    // Roles of the chapter come first ("çev. Ali Dere"), then the book.
    while (parts.length && ROLE_RE.test(parts[0]!.trim())) readRoles(item, [parts.shift()!]);
    let container = (parts.shift() ?? "").replace(/\.$/, "");
    // "The Encyclopaedia of Islam (New Edition)", "Encyclopaedia of Islam (3. Edisyon)": the edition goes to its field.
    const ed = /\s*\(((?:New|\d+\.?)\s*(?:Edition|Edisyon|Baskı|ed\.)|(?:Yeni|İkinci|Üçüncü)\s+(?:Edisyon|Baskı))\)$/i.exec(container);
    if (ed) {
      item.fields.edition = ed[1]!;
      container = container.slice(0, ed.index);
    }
    item.fields.publicationTitle = container;
    item.itemType = /Ansiklopedi|Encyclop/i.test(container) ? "encyclopediaArticle" : "bookSection";
  } else item.fields.title = title.replace(/\.$/, "");
  parts = readRoles(item, parts);
  for (const p of parts) {
    const vols = /^(\d+)\s+(Cilt|Volumes?|vols?\.?)$/i.exec(p.trim());
    const pages = /^(?:(\d+)\/)?(\d+[-–]\d+)$/.exec(p.trim());
    if (vols) item.fields.numberOfVolumes = vols[1]!;
    else if (pages) {
      if (pages[1]) item.fields.volume = pages[1];
      item.fields.pages = pages[2]!.replace("–", "-");
    } else if (/^\d+\.\s*(Basım|bs\.)$/i.test(p.trim())) item.fields.edition = /^\d+/.exec(p.trim())![0];
    else unsure.push(`tanınmayan kısım: "${p.trim()}"`);
  }
  title = item.fields.title ?? "";
  if (!item.creators.length && item.itemType === "book") unsure.push("yazar");
  return { item: settle(item), form: "isnad-kaynakca", unsure };
}

// ---------------------------------------------------------------- APA

function apa(s: string): ParsedReference | null {
  const item = emptyItem("book", "serbest");
  const t = readUrl(item, s);
  const m = /^(.+?)\s+\((\d{4}|n\.d\.|t\.y\.)[a-z]?(?:,\s*[^)]+)?\)\.\s+(.+)$/u.exec(t);
  if (!m) return null;
  for (const n of m[1]!.split(/,\s*(?:&\s*)?(?=\p{Lu}[^,]*,\s*\p{Lu}\.)|\s*&\s*/u)) {
    const c = n.trim().replace(/,$/, "");
    if (c) item.creators.push(nameInverted(c, "author"));
  }
  setDate(item, m[2]!);
  const rest = m[3]!;
  const art = /^(.+?)\.\s+([^.]+?),\s*(\d+)(?:\((\d+)\))?,\s*([\d\-–]+)\.?$/u.exec(rest);
  if (art) {
    item.itemType = "journalArticle";
    item.fields.title = art[1]!;
    item.fields.publicationTitle = art[2]!;
    item.fields.volume = art[3]!;
    if (art[4]) item.fields.issue = art[4];
    item.fields.pages = art[5]!.replace("–", "-");
    return { item: settle(item), form: "apa", unsure: [] };
  }
  const book = /^(.+?)\.\s+(?:\(([^)]+)\)\.\s+)?([^.]+)\.?$/u.exec(rest);
  if (!book) return null;
  item.fields.title = book[1]!;
  item.fields.publisher = book[3]!.trim();
  return { item: settle(item), form: "apa", unsure: ["yer"] };
}

// ---------------------------------------------------------------- eski usul

/** Splits on `sep` outside quotes and parentheses. */
function topSplit(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth) depth--;
    else if (ch === "“") quote = true;
    else if (ch === "”") quote = false;
    if (ch === sep && !depth && !quote) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

const YEAR_END = /^(.*?)[\s,]*\(?((?:1[0-9]|20)\d{2}(?:\s*\/\s*(?:1[0-9]|20)\d{2})?|\d{3,4}\s*\/\s*(?:1[0-9]|20)\d{2})\)?$/;

/**
 * Eski usul, Turkish theses' most common form before İSNAD:
 *   Mustafa Kara, Tasavvuf ve Tarikatlar Tarihi, Dergâh Yay., İstanbul 2005
 *   KARA, Mustafa, Tasavvuf ve Tarikatlar Tarihi, 2. bs., Dergâh Yayınları, İstanbul, 2005
 *   İbn Haldun, Mukaddime, çev. Süleyman Uludağ, Dergâh Yayınları, İstanbul 1982
 *   Ahmet Yaşar Ocak, “Kalenderîler”, Belleten, XLV/1 (1981)          (article)
 */
function oldStyle(s: string): ParsedReference | null {
  const item = emptyItem("book", "serbest");
  const unsure: string[] = [];
  const parts = topSplit(readUrl(item, s).replace(/\.$/, ""), ",");
  if (parts.length < 3) return null;
  let i = 1;
  const first = parts[0]!;
  // "KARA, Mustafa" or "Kara, Mustafa" (surname first) when the next part is a given name.
  const given = parts[1]!;
  if (/^[\p{L}'’ -]+$/u.test(first) && !/\s/.test(first.trim()) && /^(\p{Lu}[\p{Ll}âîûÂÎÛ'’.-]*\s?){1,4}$/u.test(given) && !/^["“]/.test(given) && given.split(" ").length <= 4 && parts.length >= 4) {
    const last = first === first.toLocaleUpperCase("tr") ? first.charAt(0) + first.slice(1).toLocaleLowerCase("tr") : first;
    item.creators.push({ creatorType: "author", lastName: last, firstName: given });
    i = 2;
  } else {
    if (/\d/.test(first) || first.split(" ").length > 7) return null;
    for (const n of splitNames(first).names) item.creators.push(nameInOrder(n, "author"));
  }
  const title = parts[i]!;
  if (!title || /^\d/.test(title)) return null;
  const quoted = /^“(.+)”$/.exec(title);
  item.fields.title = quoted ? quoted[1]! : title;
  const rest = readRoles(item, parts.slice(i + 1));
  if (quoted) {
    // “Makale”, Dergi, XLV/1 (1981)  ·  “Madde”, DİA, XIII, İstanbul 1996
    const journal = rest[0];
    if (!journal) return null;
    const enc = /ansiklopedi|encyclopa?edia|DİA\b/i.test(journal);
    item.itemType = enc ? "encyclopediaArticle" : "journalArticle";
    item.fields.publicationTitle = journal === "DİA" ? "Türkiye Diyanet Vakfı İslâm Ansiklopedisi" : journal;
    const tail = rest.slice(1).join(", ");
    const y = /\b((?:1[0-9]|20)\d{2})\b/.exec(tail);
    if (y) item.fields.date = y[1]!;
    const vi = /^(?:c\.|cilt|vol\.)?\s*([IVXLC]+|\d+)(?:\s*\/\s*|,\s*(?:sy\.|sayı|s\.|no\.?)\s*)(\d+)/i.exec(tail) ?? /^(?:c\.|cilt|vol\.)?\s*([IVXLC]+|\d+)\b/i.exec(tail);
    if (vi) {
      item.fields.volume = vi[1]!;
      if (vi[2] && !enc) item.fields.issue = vi[2];
    }
    if (enc) {
      const pl = /([\p{Lu}][\p{Ll}]+)\s+(?:1[0-9]|20)\d{2}/u.exec(tail);
      if (pl) item.fields.place = pl[1]!;
    }
    if (!item.fields.date) unsure.push("yıl");
    return { item: settle(item), form: "diger", unsure };
  }
  // Book: the imprint is at the end ("İstanbul 2005", "İstanbul, 2005", "2005").
  let k = rest.length - 1;
  const ym = k >= 0 ? YEAR_END.exec(rest[k]!) : null;
  if (!ym) return null;
  setDate(item, ym[2]!.replace(/\s+/g, ""));
  let place = ym[1]!.trim();
  if (!place && k > 0 && /^\p{Lu}[\p{L}\s-]{1,25}$/u.test(rest[k - 1]!) && !/\b(yay|yayın|neşriyat|kitabevi|matbaa|press|vakfı)/i.test(rest[k - 1]!)) place = rest[--k]!;
  if (place) item.fields.place = place;
  const before = rest.slice(0, k);
  for (const p of before) {
    const ed = /^(\d+)\.\s*(?:bs|baskı|basım|ed)\.?$/i.exec(p);
    if (ed) item.fields.edition = ed[1]!;
    else if (/^(?:[IVX]+-[IVX]+|\d+\s*c(?:ilt)?\.?)$/i.test(p)) item.fields.numberOfVolumes = p;
    else if (/\b(tezi|thesis|dissertation)\b/i.test(p)) {
      item.itemType = "thesis";
      item.fields.thesisType = p;
    } else if (!item.fields.publisher) item.fields.publisher = p.replace(/\bYay\.$/, "Yayınları");
    else item.fields.publisher += `, ${p}`;
  }
  if (item.itemType === "thesis" && item.fields.publisher) {
    item.fields.university = item.fields.publisher;
    delete item.fields.publisher;
  }
  if (!item.fields.place) unsure.push("yer");
  if (!item.fields.publisher && item.itemType === "book") unsure.push("yayınevi");
  return { item: settle(item), form: "diger", unsure };
}

// ---------------------------------------------------------------- entry points

/** How sensible a reading is: filled fields count, odd ones (a title of digits, a name with ":" or ".") cost. */
function plausibility(r: ParsedReference): number {
  const f = r.item.fields;
  let p = 0;
  const title = f.title ?? "";
  if (title.length > 3 && !/^\d+$/.test(title)) p += 3;
  if (/^[\d\s/.-]+$/.test(title)) p -= 6;
  for (const c of r.item.creators) {
    const n = `${c.firstName ?? ""} ${c.lastName ?? c.name ?? ""}`;
    p += /[:]|\.\s\p{Lu}\p{Ll}+\s\p{Lu}/u.test(n) || n.length > 80 ? -4 : 1;
  }
  if (f.date) p += 1;
  for (const k of Object.keys(f)) if (/publisher|place|university|Title$|volume|pages/.test(k)) p += 1;
  return p - r.unsure.length * 0.5;
}

/**
 * A newspaper (İSNAD): "Yazar, “Başlık”, Gazete (17 Eylül 1971), 1." or, without
 * an author, "Gazete, “Başlık” (17 Eylül 1971), 1." — a full day, month and year.
 */
function newspaper(s: string): ParsedReference | null {
  const t = s.trim().replace(/\.$/, "");
  const withAuthor = /^([^“”]{2,80}?),\s*“([^”]+)”,\s*([^(),]{2,60}?)\s*\((\d{1,2}\s+\p{L}+\s+\d{4})\)(?:,\s*(\d+(?:-\d+)?))?$/u.exec(t);
  const noAuthor = withAuthor ? null : /^([^“”,]{2,60}),\s*“([^”]+)”\s*\((\d{1,2}\s+\p{L}+\s+\d{4})\)(?:,\s*(\d+(?:-\d+)?))?$/u.exec(t);
  const m = withAuthor ?? noAuthor;
  if (!m) return null;
  const date = dayMonthYear(withAuthor ? m[4]! : m[3]!);
  if (!date) return null;
  // "Yazar, “Başlık”, YouTube (31 Mart 2018)": a video; "…, Diyanet TV (6 Temmuz 2019)": a broadcast.
  if (withAuthor && !m[5] && (VIDEO_SITE.test(m[3]!.trim()) || TV.test(m[3]!))) return screen(emptyItem("videoRecording", "serbest"), m[1]!, false, m[2]!, m[3]!, m[4]!);
  const item = emptyItem("newspaperArticle", "serbest");
  if (withAuthor) {
    for (const n of splitNames(m[1]!).names) item.creators.push(nameInOrder(n, "author"));
    item.fields.title = m[2]!;
    item.fields.publicationTitle = m[3]!.trim();
    if (m[5]) item.fields.pages = m[5];
  } else {
    item.fields.publicationTitle = m[1]!.trim();
    item.fields.title = m[2]!;
    if (m[4]) item.fields.pages = m[4];
  }
  item.fields.date = date;
  return { item, form: "isnad-dipnot", unsure: [] };
}

/**
 * Mevzuat (İSNAD): "Fikir ve Sanat Eserleri Kanunu (FSEK), Resmî Gazete 7981 (13 Aralık 1951), Kanun No. 5846"
 * and "… Yönergesi (YKBAYEY), Yükseköğretim Kurulu (2016)". The abbreviation is the short title.
 */
function legislation(s: string): ParsedReference | null {
  const item = emptyItem("statute", "serbest");
  const t = readUrl(item, s).replace(/\.$/, "");
  // The short title is an abbreviation ("FSEK") or, in the EU's Official Journal, a name ("Stop extremism").
  const rg = /^(.+?)\s*\((\p{Lu}[\p{Lu}\d]{1,11}|\p{Lu}[^()]{2,40})\),\s*(Resm[îi] Gazete|Düstur|Official Journal[^\d(]*?)\s+((?:[A-Z]\s)?[\d/ ]{1,20}?)\s*\(([^()]+)\)(?:,\s*(?:Kanun|Law|KHK)\s*No\.?\s*(\d+))?(?:,\s*(\d+(?:-\d+)?))?$/u.exec(t);
  const other = rg ? null : /^(.+?(?<=\s)(?:Kanunu|Yönetmeliği|Yönergesi|Tüzüğü|Genelgesi|Kararnamesi|İlkeleri|Esasları|Talimatı|Law|Regulation|Directive))\s*\((\p{Lu}[\p{Lu}\d]{1,11})\),\s*([^()]{3,80}?)\s*\((\d{4})\)$/u.exec(t);
  if (rg) {
    item.fields.title = rg[1]!.trim();
    item.fields.shortTitle = rg[2]!;
    item.fields.code = rg[3]!.trim();
    item.fields.codeNumber = rg[4]!.trim();
    item.fields.date = dayMonthYear(rg[5]!) ?? rg[5]!.trim();
    if (rg[6]) item.fields.publicLawNumber = rg[6];
    if (rg[7]) item.fields.pages = rg[7];
  } else if (other) {
    item.fields.title = other[1]!.trim();
    item.fields.shortTitle = other[2]!;
    item.fields.date = other[4]!;
    item.fields.extra = `authority: ${other[3]!.trim()}\npublisher-place: Türkiye`;
  } else return null;
  return { item, form: "isnad-dipnot", unsure: [] };
}

/** A court decision (İSNAD): "Yargıtay 11. Hukuk Dairesi (Yargıtay), K. 2019/1204 (22 Ağustos 2019)". */
function courtCase(s: string): ParsedReference | null {
  const item = emptyItem("case", "serbest");
  const t = readUrl(item, s).replace(/\.$/, "");
  const m = /^(.+?)\s*\(([^()]{2,40})\),?\s*(?:K|E|Karar|Esas)\.\s*(?:No\.?\s*)?([\d/.-]+)\s*\(([^()]+)\)$/u.exec(t);
  if (!m || !/(mahkeme|yargıtay|danıştay|daire|kurul|court|sayıştay)/i.test(`${m[1]} ${m[2]}`)) return null;
  item.creators.push({ creatorType: "author", lastName: m[2]!.trim(), firstName: m[1]!.trim() });
  item.fields.court = m[2]!.trim();
  item.fields.docketNumber = m[3]!;
  item.fields.dateDecided = dayMonthYear(m[4]!) ?? m[4]!.trim();
  return { item, form: "isnad-dipnot", unsure: [] };
}

/**
 * A body as author, with its abbreviation (İSNAD): "Hazine ve Maliye Bakanlığı (HMB), Aylık Bütçe
 * Bülteni (Haziran 2019)", "… Komisyonu (MAK), … Raporu (Ankara: TBMM, 2016)". The abbreviation
 * is the surname (İSNAD's Zotero rule), so later notes read "HMB, Aylık Bütçe Bülteni".
 */
function institution(s: string): ParsedReference | null {
  const item = emptyItem("report", "serbest");
  const t = readUrl(item, s).replace(/\.$/, "");
  const m = /^([^(),“”]{3,140}?)\s*\((\p{Lu}[\p{Lu}\d.]{1,11})\),?\s+([^()]{3,300}?)(?:\s*\(([^()]+)\))?$/u.exec(t);
  if (!m) return null;
  item.creators.push({ creatorType: "author", lastName: m[2]!, firstName: m[1]!.trim() });
  item.fields.title = m[3]!.trim().replace(/,$/, "");
  // "Yale University (YU), “About Yale”": a page of the body's site, its title in quotes.
  const quoted = /^“([^”]+)”$/u.exec(item.fields.title);
  if (quoted) {
    item.fields.title = quoted[1]!;
    item.itemType = "webpage";
  }
  const inside = m[4]?.trim() ?? "";
  if (inside) {
    // A bulletin is dated by its month ("Haziran 2019"), a statistic by its day.
    const d = dayMonthYear(inside);
    const my = /^(\p{L}+)\s+(\d{4})$/u.exec(inside);
    const mo = my ? MONTHS[my[1]!.toLocaleLowerCase("tr")] : undefined;
    if (d) item.fields.date = d;
    else if (my && mo) item.fields.date = `${my[2]}-${String(mo).padStart(2, "0")}`;
    else if (/^\d{4}$/.test(inside)) item.fields.date = inside;
    else if (!readImprint(item, inside)) return null;
  }
  if (!item.fields.date && !item.fields.accessDate && !item.fields.publisher) return null;
  // Read online without a date of its own: a quoted title is a page, an unquoted one a portal or book (İSNAD 11.3, 20.4).
  if (item.fields.accessDate && !item.fields.date) item.itemType = quoted ? "webpage" : "book";
  if (item.itemType === "webpage" && !item.fields.accessDate && !item.fields.url && !quoted) item.itemType = "report";
  if (item.itemType === "report" && item.fields.publisher) {
    item.fields.institution = item.fields.publisher;
    delete item.fields.publisher;
  }
  return { item: settle(item), form: "isnad-dipnot", unsure: [] };
}

/**
 * The bibliography form of a body with its abbreviation (İSNAD): "HMB, Hazine ve Maliye Bakanlığı. Aylık Bütçe
 * Bülteni (Haziran 2019). https://…", "TASAM, …. Rapor. Ankara: TASAM, 2018.", "DAVET, …. “Aranan: Oruç İbadeti”. Erişim ….".
 */
function institutionBib(s: string): ParsedReference | null {
  const item = emptyItem("report", "serbest");
  const t = readUrl(item, s).replace(/\.$/, "");
  const m = /^(\p{Lu}[\p{Lu}\d.\s]{1,11}),\s+([^.“”()]{3,140}?)\.\s+(.+)$/u.exec(t);
  if (!m || /\p{Ll}/u.test(m[1]!) || !(BODY_WORD.test(m[2]!) || abbreviates(m[1]!, m[2]!))) return null;
  // Only a body: "KARA, Mustafa Ahmet." is a person written in capitals.
  if (!BODY_WORD.test(m[2]!) && m[2]!.split(" ").length < 3) return null;
  item.creators.push({ creatorType: "author", lastName: m[1]!.trim(), firstName: m[2]!.trim() });
  let rest = m[3]!.trim();
  const quoted = /^“([^”]+)”(?:\.\s*(.*))?$/u.exec(rest);
  if (quoted) {
    item.itemType = "webpage";
    item.fields.title = quoted[1]!;
    if (quoted[2]) item.fields.websiteTitle = quoted[2].replace(/\.$/, "");
    return { item: settle(item), form: "isnad-kaynakca", unsure: [] };
  }
  const paren = /^(.+?)\s*\(([^()]+)\)$/u.exec(rest);
  if (paren) {
    rest = paren[1]!;
    const inside = paren[2]!.trim();
    const d = dayMonthYear(inside);
    const my = /^(\p{L}+)\s+(\d{4})$/u.exec(inside);
    const mo = my ? MONTHS[my[1]!.toLocaleLowerCase("tr")] : undefined;
    if (d) item.fields.date = d;
    else if (my && mo) item.fields.date = `${my[2]}-${String(mo).padStart(2, "0")}`;
    else if (/^\d{4}$/.test(inside)) item.fields.date = inside;
    else return null;
    item.fields.title = rest;
  } else {
    const ss = sentencesOf(rest);
    item.fields.title = ss[0]!;
    const imp = ss.slice(1).join(". ");
    if (imp && !readImprint(item, imp)) return null;
  }
  if (!item.fields.date && !item.fields.accessDate && !item.fields.publisher) return null;
  if (item.fields.accessDate && !item.fields.date) item.itemType = "book";
  if (item.itemType === "report" && item.fields.publisher) {
    item.fields.institution = item.fields.publisher;
    delete item.fields.publisher;
  }
  return { item: settle(item), form: "isnad-kaynakca", unsure: [] };
}

const SOCIAL = /^(Facebook|Twitter|X|Instagram|LinkedIn|TikTok|Threads|Bluesky|Mastodon|Telegram)$/i;

/** A post (İSNAD 29): "Ad Soyad, “Metin”, Twitter (8 Eylül 2019, 23:32)." / "Soyad, Ad. “Metin”. Twitter. 8 Eylül 2019, 23:32. Erişim …". */
function socialPost(s: string): ParsedReference | null {
  const item = emptyItem("webpage", "serbest");
  const t = readUrl(item, s).replace(/\.$/, "");
  const when = String.raw`(\d{1,2}\s+\p{L}+\s+\d{4}(?:,\s*\d{1,2}[:.]\d{2})?)`;
  const note = new RegExp(String.raw`^(.+?),\s*“([^”]+)”,\s*([^(),]{1,30}?)\s*\(${when}\)$`, "u").exec(t);
  const bib = note ? null : new RegExp(String.raw`^(.+?)\.\s+“([^”]+)”\.\s+([^.]{1,30})\.\s+${when}$`, "u").exec(t);
  const m = note ?? bib;
  if (!m || !SOCIAL.test(m[3]!.trim())) return null;
  if (note) for (const n of splitNames(m[1]!).names) item.creators.push(nameInOrder(n, "author"));
  else headCreator(item, m[1]!, "author", true);
  item.fields.title = m[2]!;
  item.fields.websiteTitle = m[3]!.trim();
  item.fields.date = m[4]!;
  return { item, form: note ? "isnad-dipnot" : "isnad-kaynakca", unsure: [] };
}

const LIBRARY = /(Kütüphane\w*|Library|Bibliothe\w*|Arşiv\w*|Archiv\w*|Müze\w*|Museum)/i;

/**
 * A manuscript (İSNAD): "Müellif, Eser (Şehir: Kütüphane, Koleksiyon, No), 77b."
 * — the parenthesis holds a library and a shelf mark, not a publisher and a year.
 */
function manuscript(s: string): ParsedReference | null {
  const m = /^(.+?)\s*\((?:([^:()]{2,40}):\s*)?([^,()]{3,80}),\s*([^()]{1,80})\)\.?$/u.exec(s.trim());
  if (!m || !LIBRARY.test(m[3]!) || /\b(yayın\w*|press|verlag)\b/i.test(m[3]!)) return null;
  const item = emptyItem("manuscript", "serbest");
  const parts = topSplit(m[1]!, ",");
  let titleParts = parts;
  // An author when the first part reads as a name and something is left for the title.
  if (parts.length >= 2 && /^\p{Lu}/u.test(parts[0]!) && parts[0]!.split(" ").length <= 9 && !/[“"]/.test(parts[0]!)) {
    for (const n of splitNames(parts[0]!).names) item.creators.push(nameInOrder(n, "author"));
    titleParts = parts.slice(1);
  }
  const rest = readRoles(item, titleParts.slice(1));
  item.fields.title = [titleParts[0]!, ...rest].join(", ").trim();
  if (m[2]) item.fields.place = m[2].trim();
  item.fields.archive = m[3]!.trim();
  item.fields.archiveLocation = m[4]!.trim();
  return { item: settle(item), form: "isnad-dipnot", unsure: [] };
}

/** "1957", "1880-1893", "20. yüzyıl", "17-18. yüzyıl", "Ağustos 2019", "20 Mart 2019", "ts.". */
const LOOSE_DATE = String.raw`(?:\d{1,2}(?:-\d{1,2})?\.\s*(?:yüzyıl|yy\.?|century)|(?:\d{1,2}\s+)?(?:\p{L}+\s+)?\d{3,4}(?:-\d{2,4})?(?:\/\d{3,4})?|ts\.|n\.d\.)`;
/** A document's kind written in its parenthesis (İSNAD 30, 34, 35, 37 …). */
const DOC_GENRE = /^(Fotoğraf|Plastik Ambalaj|Ambalaj|Sınav K[aâ][ğg]ıdı|Nota K[aâ][ğg]ıdı|Afiş|Broşür|Mektup|Belge|Kartpostal|Davetiye|Etiket|Harita|Poster|Photograph|Letter)$/iu;
const ART_MEDIUM = /^(Tasvir|Fotoğraf|Ahşap|Porselen|Halı|Kilim|Afiş|Karakalem|Yağlı Boya|Suluboya|Sulu Boya|Akrilik|Minyatür|Hat|Tezhip|Ebru|Çini|Seramik|Cam|Maden|Gümüş|Altın|Bronz|Mermer|Taş|Kumaş|Dokuma|İşleme|Kağıt|Kâğıt|Tuval|Gravür|Litografi|Heykel|Kabartma|Mozaik|Fresk|Oil on canvas|Photograph|Painting|Drawing)(?!\p{L})/iu;

/** "Hayali Küçük Ali" or "Direnoğlu, Şefik" before the title; an artist or an author. */
function headCreator(item: Item, head: string, creatorType: string, inverted: boolean): void {
  const h = head.trim().replace(/[.,]$/, "");
  if (!h) return;
  // "Öğrenci 1": a numbered, anonymous person (İSNAD 35) is a name as a whole.
  if (/^(Öğrenci|Katılımcı|Görüşmeci|Student|Participant)\s+\d+$/u.test(h)) {
    item.creators.push({ creatorType, name: h });
    return;
  }
  // In the bibliography a person is "Soyad, Ad"; without a comma the name is kept whole ("Hayali Küçük Ali").
  item.creators.push(inverted ? (/,/.test(h) ? nameInverted(h, creatorType) : { creatorType, name: h }) : nameInOrder(h, creatorType));
}

/** "Ankara: Milli Kütüphane, Koleksiyon, No. 000116" → archive fields. */
function readHolding(item: Item, s: string): boolean {
  const m = /^(?:([^:,]{2,40}):\s*)?(.+?)(?:,\s*((?:No|Seri No|Envanter No|Inv)\.?\s*.+))?$/u.exec(s.trim().replace(/\.$/, ""));
  if (!m) return false;
  if (m[1]) item.fields.archiveLocation = m[1].trim();
  const parts = m[2]!.split(/,\s*/);
  item.fields.archive = parts[0]!.trim();
  if (parts.length > 1) item.fields.libraryCatalog = parts.slice(1).join(", ").trim();
  if (m[3]) item.fields.callNumber = m[3].trim();
  return true;
}

/** Splits "Yazar, Başlık" (dipnot) or "Yazar. Başlık" (kaynakça) in front of a typed parenthesis. */
function headParts(before: string, bib: boolean): { creator: string; title: string } {
  const b = before.trim().replace(/[.,]$/, "");
  const numbered = /^((?:Öğrenci|Katılımcı|Görüşmeci|Student|Participant)\s+\d+)[.,]\s+(.+)$/u.exec(b);
  if (numbered) return { creator: numbered[1]!, title: numbered[2]! };
  if (bib) {
    const ss = sentencesOf(b);
    return ss.length >= 2 ? { creator: ss.slice(0, -1).join(". "), title: ss[ss.length - 1]! } : { creator: "", title: b };
  }
  const parts = topSplit(b, ",");
  if (parts.length >= 2 && parts[0]!.split(" ").length <= 6 && /^\p{Lu}/u.test(parts[0]!) && !/[“"]/.test(parts[0]!)) return { creator: parts[0]!, title: parts.slice(1).join(", ") };
  return { creator: "", title: b };
}

/**
 * Works that name their kind (İSNAD 27-40): software "Microsoft Word 16.29 (Yazılım, ABD: Microsoft
 * Corporation, 2019)", a patent "(Patent, Türk Patent ve Marka Kurumu, No. 2019/07502, Tarih 17 Mayıs 2019)",
 * an art work "Abdal (Tasvir, 1957, Ankara: Milli Kütüphane), No. 000116", a document "(Fotoğraf, 2019),
 * Anadolu Ajansı", a film "(Film, 1995)", a text message "(Kısa Mesaj 2 Eylül 2019, Alıcı Sami Şahin)" and
 * an interview "“Başlık” (Görüşmeci: İlber Ortaylı, Video Kaydı, Görüşme 3 Mart 1985)". Both the note and the
 * bibliography form are read.
 */
function labeled(s: string): ParsedReference | null {
  const probe = emptyItem("document", "serbest");
  const t = readUrl(probe, s).replace(/\.$/, "");
  const carry = (item: Item) => {
    if (probe.fields.url) item.fields.url = probe.fields.url;
    if (probe.fields.accessDate) item.fields.accessDate = probe.fields.accessDate;
    if (probe.fields.DOI) item.fields.DOI = probe.fields.DOI;
    return item;
  };
  const unsure: string[] = [];
  const bibForm = (sentencesOf(t).length >= 3 && /^[^,.]+,\s[^.]+\.\s/u.test(t)) || false;

  // Software and patents in the bibliography: "Başlık. Yazılım. ABD: Şirket, 2019." / "Soyad, Ad. Başlık. Patent. Kurum, No. X, Tarih …".
  const ss = sentencesOf(t);
  const kindAt = ss.findIndex((x) => /^(Yazılım|Software|Patent)$/i.test(x));
  if (kindAt >= 1 && kindAt + 1 < ss.length) {
    const head = ss.slice(0, kindAt);
    const rest = ss.slice(kindAt + 1).join(". ");
    if (/^patent$/i.test(ss[kindAt]!)) {
      const item = emptyItem("patent", "serbest");
      if (head.length >= 2) headCreator(item, head.slice(0, -1).join(". "), "inventor", true);
      item.fields.title = head[head.length - 1]!;
      if (!readPatent(item, rest)) return null;
      return { item: carry(item), form: "isnad-kaynakca", unsure };
    }
    const item = emptyItem("computerProgram", "serbest");
    item.fields.programmingLanguage = ss[kindAt]!;
    setTitleVersion(item, head.join(". "));
    if (!readCompany(item, rest)) return null;
    return { item: carry(item), form: "isnad-kaynakca", unsure };
  }

  // Art works in the bibliography: "[Sanatçı.] Başlık. Malzeme, Tarih. Yer: Müze, Koleksiyon, No. X."
  const medAt = ss.findIndex((x, i) => i >= 1 && new RegExp(String.raw`^([^,]{2,30}),\s*(${LOOSE_DATE})$`, "iu").test(x) && ART_MEDIUM.test(x));
  if (medAt >= 1 && medAt + 1 < ss.length && /:|No\./.test(ss.slice(medAt + 1).join(". "))) {
    const item = emptyItem("artwork", "serbest");
    const head = ss.slice(0, medAt);
    if (head.length >= 2) headCreator(item, head.slice(0, -1).join(". "), "artist", true);
    item.fields.title = head[head.length - 1]!;
    const md = /^([^,]+),\s*(.+)$/u.exec(ss[medAt]!)!;
    item.fields.artworkMedium = md[1]!.trim();
    setDate(item, md[2]!);
    readHolding(item, ss.slice(medAt + 1).join(". "));
    return { item: carry(item), form: "isnad-kaynakca", unsure };
  }

  // A text message in the bibliography: "Soyad, Ad. Konu hk. Kısa Mesaj 2 Eylül 2019, Alıcı Ad Soyad."
  const smsBib = /^(.+?)\.\s+(.+?)\.\s+(Kısa Mesaj|E-?posta|SMS|WhatsApp Mesajı)\s+([^,]+),\s*Alıcı:?\s+(.+)$/iu.exec(t);
  if (smsBib) return message(carry(emptyItem(/posta/i.test(smsBib[3]!) ? "email" : "instantMessage", "serbest")), smsBib[1]!, true, smsBib[2]!, smsBib[3]!, smsBib[4]!, smsBib[5]!);

  // A video or a broadcast in the bibliography: "Soyad, Ad. “Başlık”. YouTube. Yayın Tarihi 31 Mart 2018."
  const aired = /^(.+?)\.\s+“([^”]+)”\.\s+([^.]{2,60})\.\s+Yayın Tarihi\s+(.+)$/u.exec(t);
  if (aired) return screen(carry(emptyItem("videoRecording", "serbest")), aired[1]!, true, aired[2]!, aired[3]!, aired[4]!);

  // A recording (İSNAD 33): "Sanatçı, “Parça”, Albüm (2001)." / "Soyad, Ad. “Parça”. Albüm, 2001." — no imprint, no page.
  const track = /^([^“”,]{3,60}),\s*“([^”]+)”,\s*([^(),“”:]{2,80}?)\s*\((\d{4}|ts\.)\)$/u.exec(t) ?? /^([^“”.,]{2,40},\s*[^“”.]{2,60})\.\s+“([^”]+)”\.\s+([^.,:“”]{2,80}),\s*(\d{4}|ts\.)$/u.exec(t);
  if (track && !/\d[\d/\s-]*$/.test(track[3]!.trim()) && !/(dergi|journal|review|studies|bülten|yıllı[gğ]ı|mecmua|ansiklopedi)/i.test(track[3]!)) {
    const item = emptyItem("audioRecording", "serbest");
    const bibTrack = /\.\s+“/.test(t);
    if (bibTrack) headCreator(item, track[1]!, "performer", true);
    else for (const n of splitNames(track[1]!).names) headCreator(item, n, "performer", false);
    item.fields.title = track[2]!;
    item.fields.seriesTitle = track[3]!.trim();
    setDate(item, track[4]!);
    return { item: carry(item), form: /\.\s+“/.test(t) ? "isnad-kaynakca" : "isnad-dipnot", unsure: ["tür (ses kaydı mı, makale mi?)"] };
  }

  // The parenthesis forms: "Önce (İçerik)[, veya .] Sonra".
  const m = /^(.+?)\s*\(([^()]+)\)\s*(?:[.,]\s*(.+))?$/u.exec(t);
  if (!m) return null;
  const before = m[1]!;
  const inside = m[2]!.split(/,\s*/);
  const after = m[3]?.trim() ?? "";
  const label = inside[0]!.trim();
  // "Öğrenci 1. Başlık": a numbered anonymous person (İSNAD 35) is a sentence of its own.
  const numbered = /^((?:Öğrenci|Katılımcı|Görüşmeci|Student|Participant)\s+\d+)\.\s+(.+)$/u.exec(before);
  const bib = bibForm || !!numbered || (/^[^,]+,\s[^.,]+\.\s/u.test(before) && sentencesOf(before).length >= 2) || (!/,/.test(before) && sentencesOf(before).length >= 2);

  const sms = /^(Kısa Mesaj|E-?posta|SMS|WhatsApp Mesajı)\s+(.+)$/iu.exec(label);
  if (sms && inside[1] && /^Alıcı:?\s/i.test(inside[1])) {
    const { creator, title } = headParts(before, bib);
    return message(carry(emptyItem(/posta/i.test(sms[1]!) ? "email" : "instantMessage", "serbest")), creator, bib, title, sms[1]!, sms[2]!, inside[1].replace(/^Alıcı:?\s+/i, ""));
  }

  if (/^Görüşmeci:/i.test(label)) {
    const q = /^(.*?)[,.]?\s*“([^”]+)”\s*$/u.exec(before.trim());
    if (!q || after) return null;
    const item = emptyItem("interview", "serbest");
    if (q[1]) headCreator(item, q[1], "interviewee", /,/.test(q[1]));
    item.fields.title = q[2]!;
    for (const n of splitNames(label.replace(/^Görüşmeci:\s*/i, "")).names) item.creators.push(nameInOrder(n, "interviewer"));
    for (const x of inside.slice(1)) {
      const g = /^Görüşme\s+(.+)$/i.exec(x);
      if (g) item.fields.date = dayMonthYear(g[1]!) ?? g[1]!.trim();
      else if (!/Transkripsiyon/i.test(x)) item.fields.interviewMedium = x.trim();
      else return null;
    }
    return { item: carry(item), form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure };
  }

  if (/^(Yazılım|Software)$/i.test(label) && inside.length >= 2) {
    const item = emptyItem("computerProgram", "serbest");
    item.fields.programmingLanguage = label;
    setTitleVersion(item, before);
    // "(Yazılım, ABD: Şirket, 16.29, 2019)": the version may be written inside, before the year.
    const parts = inside.slice(1);
    const year = parts[parts.length - 1]!;
    if (parts.length >= 3 && /^(v?\d[\w.]*|[A-Z]+\d[\w.]*)$/.test(parts[parts.length - 2]!.trim())) item.fields.versionNumber = parts.splice(parts.length - 2, 1)[0]!.trim();
    if (!readCompany(item, parts.join(", "))) return null;
    void year;
    return { item: carry(item), form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure };
  }

  if (/^Patent$/i.test(label) && inside.length >= 2) {
    const item = emptyItem("patent", "serbest");
    const { creator, title } = headParts(before, bib);
    if (creator) headCreator(item, creator, "inventor", bib);
    item.fields.title = title;
    if (!readPatent(item, inside.slice(1).join(", "))) return null;
    if (after && /^\d+(?:-\d+)?$/.test(after)) item.fields.pages = after;
    return { item: carry(item), form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure };
  }

  if (/^(Film|Belgesel|Documentary)$/i.test(label) && inside.length === 2 && /^\d{4}$/.test(inside[1]!.trim()) && !after) {
    const item = emptyItem("film", "serbest");
    const { creator, title } = headParts(before, bib);
    if (creator) headCreator(item, creator, "director", bib);
    item.fields.title = title;
    item.fields.genre = label;
    item.fields.date = inside[1]!.trim();
    const short = /^(.+?)\s*\[[^\]]+\]$/.exec(title);
    if (short) item.fields.shortTitle = short[1]!;
    return { item: carry(item), form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure };
  }

  // An art work: "(Malzeme, Tarih, Yer: Müze[, Koleksiyon]), No. X".
  if (inside.length >= 3 && new RegExp(String.raw`^${LOOSE_DATE}$`, "iu").test(inside[1]!.trim()) && /:/.test(inside.slice(2).join(", ")) && (!after || /^No\.?\s/.test(after)) && !placeIn(label)) {
    const item = emptyItem("artwork", "serbest");
    const { creator, title } = headParts(before, bib);
    if (creator) headCreator(item, creator, "artist", bib);
    item.fields.title = title;
    item.fields.artworkMedium = label;
    setDate(item, inside[1]!);
    readHolding(item, [inside.slice(2).join(", "), after].filter(Boolean).join(", "));
    if (!ART_MEDIUM.test(label)) unsure.push("tür (sanat eseri mi?)");
    return { item: carry(item), form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure };
  }

  // A document of a named kind: "(Fotoğraf, 2019), Anadolu Ajansı", "(Sınav Kağıdı, 20 Mart 2019), Üniversite, Fakülte, Öğretici 1".
  if (inside.length === 2 && DOC_GENRE.test(label) && new RegExp(String.raw`^${LOOSE_DATE}$`, "iu").test(inside[1]!.trim())) {
    const item = emptyItem("document", "serbest");
    const { creator, title } = headParts(before, bib);
    if (creator) headCreator(item, creator, "author", bib);
    item.fields.title = title;
    setDate(item, inside[1]!);
    item.fields.extra = `genre: ${label}`;
    if (after) {
      const place = /^([^:,]{2,40}):\s*(.+)$/u.exec(after);
      if (place) {
        // "İstanbul: BİM, Seri No. 291 …" (a maker) or "İstanbul: İSAM Kütüphanesi, Arşiv, No. …" (a holding).
        item.fields.archiveLocation = place[1]!.trim();
        const parts = place[2]!.split(/,\s*/);
        const no = parts.findIndex((x) => /^(No|Seri No|Barkod No)\.?\s/i.test(x));
        const named = no < 0 ? parts : parts.slice(0, no);
        if (no >= 0) item.fields.callNumber = parts.slice(no).join(", ");
        if (LIBRARY.test(named[0] ?? "")) {
          item.fields.archive = named[0]!;
          if (named.length > 1) item.fields.libraryCatalog = named.slice(1).join(", ");
        } else item.fields.publisher = named.join(", ");
      } else {
        const parts = after.split(/,\s*/);
        // A last part without a capitalised name is the teacher's code ("Öğretici 1") or similar.
        if (parts.length >= 3) {
          item.fields.archive = parts.slice(0, -1).join(", ");
          item.fields.libraryCatalog = parts[parts.length - 1]!;
        } else item.fields.publisher = after;
      }
    }
    return { item: carry(item), form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure };
  }
  return null;
}

const VIDEO_SITE = /^(YouTube|Vimeo|Dailymotion|Facebook|Instagram|TikTok|Twitch)$/i;
const TV = /(\bTV\b|Televizyon|TRT|\bKanal\b|Channel|\bNTV\b|\bATV\b|\bCNN|\bBBC\b|Al ?Jazeera)/i;

/** A video ("YouTube") or a broadcast ("Diyanet TV"): who made it, the title, where, the day. */
function screen(item: Item, creator: string, bib: boolean, title: string, where: string, date: string): ParsedReference {
  const w = where.trim();
  if (!VIDEO_SITE.test(w) && TV.test(w)) item.itemType = "tvBroadcast";
  if (creator) headCreator(item, creator, "director", bib);
  item.fields.title = title.trim();
  if (item.itemType === "tvBroadcast") item.fields.network = w;
  else item.fields.place = w;
  item.fields.date = dayMonthYear(date) ?? date.trim();
  return { item, form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure: [] };
}

function message(item: Item, creator: string, bib: boolean, title: string, kind: string, date: string, to: string): ParsedReference {
  if (creator) headCreator(item, creator, "author", bib);
  item.fields.title = title.trim().replace(/\s(hk|vb|vs)$/u, " $1.");
  item.fields.date = date.trim();
  item.fields.extra = `genre: ${kind}`;
  for (const n of splitNames(to).names) item.creators.push(nameInOrder(n, "recipient"));
  return { item, form: bib ? "isnad-kaynakca" : "isnad-dipnot", unsure: [] };
}

/** "Microsoft Word 16.29" → title and version; a last word with a digit is the version. */
function setTitleVersion(item: Item, s: string): void {
  const t = s.trim().replace(/[.,]$/, "");
  const v = /^(.+?)\s+(v?\d+(?:\.\d+)+|v\d+|[A-Z]{1,3}\d{1,4}|\d{4})$/.exec(t);
  if (v && !/^\d{4}$/.test(v[2]!)) {
    item.fields.title = v[1]!;
    item.fields.versionNumber = v[2]!;
  } else item.fields.title = t;
}

/** "Rolla, ABD: Şirket, 1995" / "Şirket, 2019". */
function readCompany(item: Item, s: string): boolean {
  const m = /^(?:(.+?):\s*)?(.+?),\s*(\d{4})$/u.exec(s.trim());
  if (!m) return false;
  if (m[1]) item.fields.place = m[1].trim();
  item.fields.company = m[2]!.trim();
  item.fields.date = m[3]!;
  return true;
}

/** "Türk Patent ve Marka Kurumu, No. 2019/07502, Tarih 17 Mayıs 2019". */
function readPatent(item: Item, s: string): boolean {
  const m = /^(.+?),\s*(?:Patent\s+)?No\.?\s*([^,]+?)(?:,\s*Tarih\s+(.+))?$/iu.exec(s.trim());
  if (!m) return false;
  item.fields.issuingAuthority = m[1]!.trim();
  item.fields.patentNumber = m[2]!.trim();
  if (m[3]) item.fields.issueDate = m[3].trim();
  item.fields.legalStatus = "Patent";
  return true;
}

/**
 * Archive documents and manuscripts written without the "(Şehir: Kütüphane, …)" parenthesis (İSNAD 7, 8):
 *   "Osmanlı Arşivi (BOA), Mühimme-i Asâkir Defterleri [A.DVNS.ASK.MHM.d], No. 989, Gömlek No. 7."
 *   "BOA, Osmanlı Arşivi. Mühimme-i Asâkir Defterleri [A.DVNS.ASK.MHM.d]. No. 989, Gömlek No. 7."
 *   "Kayseri Sancağı Şer’îye Sicil Defteri (1334-1336), Milli Kütüphane, No. 06 Mil Yz C 39/3."
 *   "Siğnâkī, Hüsâmeddin Hüseyin b. Ali. et-Tesdîd …. İstanbul: Süleymaniye Kütüphanesi, Esad Efendi, 3893, 1a-215a."
 */
function archiveRecord(s: string): ParsedReference | null {
  const item = emptyItem("manuscript", "serbest");
  const t = readUrl(item, s).replace(/\.$/, "");
  const NO = String.raw`((?:No|Nr|Env|Inv)\.?\s*.+)`;
  const fonds = (acr: string, body: string, title: string, no: string, form: ParsedReference["form"]) => {
    item.creators.push({ creatorType: "author", lastName: acr, firstName: body.trim() });
    item.fields.title = title.trim();
    const code = /\[([^\]]+)\]$/.exec(title.trim());
    if (code) item.fields.shortTitle = code[1]!;
    item.fields.callNumber = no.trim();
    item.fields.extra = `authority: ${acr}`;
    return { item, form, unsure: [] };
  };
  const fn = new RegExp(String.raw`^([^(),]{3,80}?)\s*\((\p{Lu}[\p{Lu}.]{1,11})\),\s*([^,\[\]]+\[[^\]]+\]),\s*${NO}$`, "u").exec(t);
  if (fn && LIBRARY.test(fn[1]!)) return fonds(fn[2]!, fn[1]!, fn[3]!, fn[4]!, "isnad-dipnot");
  const fb = new RegExp(String.raw`^(\p{Lu}[\p{Lu}.]{1,11}),\s*([^.]{3,80})\.\s+(.+?\[[^\]]+\])\.\s+${NO}$`, "u").exec(t);
  if (fb && LIBRARY.test(fb[2]!)) return fonds(fb[1]!, fb[2]!, fb[3]!, fb[4]!, "isnad-kaynakca");

  // "Başlık (1334-1336), Kütüphane, No. …" and its bibliography form "Başlık (1334-1336). Kütüphane, No. …".
  const dated = new RegExp(String.raw`^(.+?\((\d{3,4}(?:-\d{2,4})?)\))[.,]\s*([^,:]{3,80}),\s*${NO}$`, "u").exec(t);
  if (dated && LIBRARY.test(dated[3]!)) {
    item.fields.title = dated[1]!.trim();
    item.fields.shortTitle = dated[1]!.replace(/\s*\([^()]+\)$/, "").trim();
    item.fields.date = dated[2]!;
    item.fields.archive = dated[3]!.trim();
    item.fields.callNumber = dated[4]!.trim();
    return { item, form: /\)\./.test(t) ? "isnad-kaynakca" : "isnad-dipnot", unsure: [] };
  }

  // The bibliography form of a manuscript: "[Soyad, Ad.] Başlık. Şehir: Kütüphane, Koleksiyon, Numara, 1a-215a."
  const at = /(?:^|\.\s)([^.:]{2,40}):\s*([^,]{3,80}),\s*(.+)$/u.exec(t);
  if (!at || !LIBRARY.test(at[2]!) || /\b(yayın\w*|press|verlag)\b/i.test(at[2]!)) return null;
  // "Ankara: Milli Kütüphane, 1990": a book the library printed.
  if (new RegExp(String.raw`^(?:\d+\.\s*Basım,\s*)?${DATE}$`, "iu").test(at[3]!.trim())) return null;
  const head = t.slice(0, at.index).trim();
  if (!head) return null;
  const ss = sentencesOf(head);
  item.fields.title = ss[ss.length - 1]!;
  if (ss.length >= 2) headCreator(item, ss.slice(0, -1).join(". "), "author", true);
  item.fields.place = at[1]!.trim();
  item.fields.archive = at[2]!.trim();
  const parts = at[3]!.split(/,\s*/);
  if (parts.length >= 2 && /^\d+[ab]?(?:\s*[-–]\s*\d+[ab]?)?$/.test(parts[parts.length - 1]!)) item.fields.numPages = parts.pop()!;
  if (parts.length >= 2) {
    item.fields.archiveLocation = parts[0]!;
    item.fields.callNumber = parts.slice(1).join(", ");
  } else item.fields.archiveLocation = parts.join(", ");
  return { item, form: "isnad-kaynakca", unsure: [] };
}

/** "Topaloğlu vd." names only the first of three or more authors: the record says so, the others are to be added. */
function withOthers(r: ParsedReference, s: string): ParsedReference {
  const head = s.split(/[“"(]/)[0] ?? "";
  const authors = r.item.creators.filter((c) => c.creatorType === "author" || c.creatorType === "editor").length;
  return /\s(vd\.|et al\.?)(?=[\s,(])/i.test(head) && authors < 3 ? { ...r, unsure: [...r.unsure, "diğer yazarlar (vd.)"] } : r;
}

const PROCEEDINGS = /(Sempozyum|Kongre|Bildiri|Konferans|Çalıştay|Kolokyum|Symposium|Conference|Congress|Proceedings|Colloquium|Workshop)/i;

const BODY_WORD = /(Arşivi|Nezâreti|Nezareti|Başkanlığı|Bakanlığı|Kurumu|Kurulu|Enstitüsü|Üniversitesi|Sistemi|Dizini|Veri Taban|Kütüphanesi|Müdürlüğü|Vakfı|Derneği|Merkezi|Cumhurbaşkanlığı|University|Institute|Archive|Library|Ministry|Office|Foundation|Association|Organization|Database)/u;

/** The letters of an abbreviation, in order, among the initials of the name ("YU" ← "Yale University"). */
function abbreviates(acr: string, name: string): boolean {
  const ini = name.split(/[\s-]+/).map((w) => w[0] ?? "").join("").toLocaleUpperCase("tr");
  let i = 0;
  for (const ch of acr.replace(/[.\s]/g, "")) {
    i = ini.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

/**
 * A body named with its abbreviation ("Yale University (YU)", "BOA, Osmanlı Arşivi."): İSNAD's rule keeps
 * the abbreviation as the surname and says so in "authority", which prints it in parentheses in notes.
 */
function markAuthority(r: ParsedReference, s: string): ParsedReference {
  const it = r.item;
  if (/^authority:/m.test(it.fields.extra ?? "")) return r;
  const c = it.creators.find((x) => x.lastName && x.firstName && /^\p{Lu}[\p{Lu}\d.\s]{1,11}$/u.test(x.lastName) && !/\p{Ll}/u.test(x.lastName));
  if (!c) return r;
  const acr = c.lastName!;
  const inParens = s.includes(`(${acr})`);
  const inverted = s.startsWith(`${acr}, ${c.firstName}`) && /\s/.test(c.firstName!) && (BODY_WORD.test(c.firstName!) || abbreviates(acr, c.firstName!));
  if (!inParens && !inverted) return r;
  it.fields.extra = [`authority: ${acr}`, it.fields.extra].filter(Boolean).join("\n");
  return r;
}

/** One reference (a line) → a record, or null when it cannot be read. Every reading is tried; the most sensible wins. */
export function parseReference(raw: string): ParsedReference | null {
  const r = readReference(raw);
  return r ? markAuthority(r, stripLeading(raw)) : r;
}

function readReference(raw: string): ParsedReference | null {
  const s = stripLeading(raw);
  if (s.length < 8) return null;
  const ms = labeled(s) ?? socialPost(s) ?? manuscript(s) ?? archiveRecord(s) ?? newspaper(s) ?? legislation(s) ?? courtCase(s) ?? institution(s) ?? institutionBib(s);
  if (ms) return withOthers(ms, s);
  let best: ParsedReference | null = null;
  let bestScore = -Infinity;
  for (const f of [isnadBib, isnadNote, apa, oldStyle]) {
    let r: ParsedReference | null = null;
    try {
      r = f(s);
    } catch {
      r = null;
    }
    if (!r?.item.fields.title) continue;
    // The old form is a fallback: an İSNAD or APA reading of the same line wins on a tie and a bit more.
    const score = plausibility(r) - (f === oldStyle ? 3 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  // A chapter in a symposium's book is a paper (İSNAD 15): "…, IV. Uluslararası … Sempozyumu, ed. … (Yer: Yayınevi, Yıl)".
  if (best?.item.itemType === "bookSection" && PROCEEDINGS.test(best.item.fields.bookTitle ?? "")) {
    const f = best.item.fields;
    best.item.itemType = "conferencePaper";
    f.proceedingsTitle = f.bookTitle!;
    delete f.bookTitle;
  }
  return best ? withOthers(best, s) : best;
}

/** "———.", "----,", "a.mlf.", "aynı müellif" at the head of a bibliography line: the author of the line before. */
const SAME_AUTHOR = /^(?:[—–_-]{2,}|a\.\s?mlf\.?|aynı\s+müellif|aynı\s+yazar|idem|id\.)\s*[.,]?\s+/i;

/**
 * A bibliography typed by hand writes a repeated author as "———." or "a.mlf.":
 * the line gets the author of the line before it ("Kara, Mustafa."), as the
 * reader would read it.
 */
export function expandSameAuthor(lines: readonly string[]): string[] {
  let author = "";
  return lines.map((line) => {
    const m = SAME_AUTHOR.exec(line.trim());
    if (m && author) return `${author} ${line.trim().slice(m[0].length)}`;
    // The author part of a kaynakça line: up to the first ". " after "Soyad, Ad" (or the "Ad Soyad," of a dipnot form).
    const a = /^([^.,]{2,60},\s*[^.]{2,80}?\.)\s+\S/u.exec(line.trim()) ?? /^((?:\p{Lu}[\p{L}’'-]*\s?){2,6},)\s/u.exec(line.trim());
    if (a) author = a[1]!;
    return line;
  });
}

/** A pasted list: one reference per line (a reference broken over lines is joined back when a line does not end a sentence). */
export function splitReferences(text: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const out: string[] = [];
  for (const l of lines) {
    if (!l) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && !/[.)\]]$/.test(prev) && !/^(\[\d+\]|\d+[.)])\s/.test(l)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
}

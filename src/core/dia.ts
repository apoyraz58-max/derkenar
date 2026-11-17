/**
 * TDV İslâm Ansiklopedisi (DİA): the "Atıf" box of a madde gives
 *   MUSTAFA ÇAĞRICI, "GAZZÂLÎ", TDV İslâm Ansiklopedisi, https://islamansiklopedisi.org.tr/gazzali#1 (17.11.2026).
 * and the page says where the printed madde is:
 *   Maddenin bu bölümü TDV İslâm Ansiklopedisi’nin 1996 yılında İstanbul’da basılan 13. cildinde, 489-505 numaralı sayfalarda yer almıştır.
 * Pasted together (or the first alone), they make an İSNAD record: the printed
 * madde when the second is there (guide s. 95), else the web one (s. 97).
 * The site itself cannot be read from Word (it does not allow it), so the text is pasted.
 */
import { isnadName } from "./isnadstyle.js";
import { type Item, emptyItem, newKey, now } from "./zotero.js";

const CITE = /([^"“\n]+?),\s*["“]([^"”]+)["”],\s*TDV İsl[âa]m Ansiklopedisi,\s*(https?:\/\/\S+?)\s*\((\d{1,2})\.(\d{1,2})\.(\d{4})\)/i;
const PRINT = /(\d{4})\s+yılında\s+([\p{L}]+?)[’']?(?:da|de|ta|te)\s+basılan\s+(EK-?\s*\d+|\d+)\.?\s*cildinde,?\s*([\d\-–]+)\s+numaralı\s+sayfa/iu;

export function isDia(text: string): boolean {
  return CITE.test(text) || (/İsl[âa]m Ansiklopedisi/i.test(text) && PRINT.test(text));
}

/** A madde heading in capitals ("GAZZÂLÎ", "İBN SÎNÂ", "EŞ‘ARİYYE") as İSNAD writes it. */
function headword(s: string): string {
  const t = s.trim();
  return t === t.toLocaleUpperCase("tr") ? isnadName(t) : t;
}

export function parseDia(text: string): Item | null {
  const c = CITE.exec(text);
  const p = PRINT.exec(text);
  if (!c && !p) return null;
  const item = emptyItem("encyclopediaArticle", "dia");
  if (c) {
    const authors = c[1]!.split(/\s*[,;]\s*|\s+-\s+/).map((a) => a.trim()).filter(Boolean);
    item.creators = authors.map((a) => {
      const words = isnadName(a).split(/\s+/);
      const lastName = words.pop()!;
      return { creatorType: "author", lastName, firstName: words.join(" ") };
    });
    item.fields.title = headword(c[2]!);
    item.fields.url = c[3]!.replace(/[).,]+$/, "");
    item.fields.accessDate = `${c[6]}-${c[5]!.padStart(2, "0")}-${c[4]!.padStart(2, "0")}`;
  }
  if (p) {
    // The printed madde: İSNAD cites the print, with the year and place it gives.
    item.fields.publicationTitle = "Türkiye Diyanet Vakfı İslâm Ansiklopedisi";
    item.fields.date = p[1]!;
    item.fields.place = p[2]!.replace(/[’']$/, "");
    item.fields.publisher = "TDV Yayınları";
    item.fields.volume = p[3]!.replace(/\s+/g, "").toLocaleUpperCase("tr").replace(/^EK(\d)/, "EK-$1");
    item.fields.pages = p[4]!.replace("–", "-");
    // İSNAD cites the print without its address; the address stays as a link attachment.
    if (item.fields.url) item.attachments = [{ key: newKey(), kind: "link", title: "TDV İslâm Ansiklopedisi (web)", url: item.fields.url, dateAdded: now() }];
    delete item.fields.url;
    delete item.fields.accessDate;
  } else {
    item.fields.publicationTitle = "TDV İslâm Ansiklopedisi";
  }
  if (!item.fields.title) return null;
  return item;
}

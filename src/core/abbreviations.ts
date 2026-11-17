/**
 * Kısaltmalar listesi: the İSNAD abbreviations a thesis actually uses, with
 * their meanings, as theses list them before the text. The table is the
 * İSNAD one (ISNAD Citation Style 2nd Edition, Turkish ↔ English).
 */

/** [Turkish, its meaning, English, its meaning] */
export const ABBREVIATIONS: readonly (readonly [string, string, string, string])[] = [
  ["a.mlf.", "Aynı müellif", "Id.", "The same person"],
  ["akt.", "Aktaran", "narrator", "Narrator"],
  ["b.", "bin, ibn (oğlu)", "b.", "bin, ibn (son)"],
  ["b.y.", "Basım yeri yok", "s.l.", "Sine loco (no place)"],
  ["bk.", "Bakınız", "See", "See"],
  ["bnt.", "binti", "bint", "bint (daughter)"],
  ["bs.", "Basım", "ed.", "Edition"],
  ["çev.", "Çeviren", "trans.", "Translator"],
  ["drl.", "Derleyen", "comp.", "Compiler"],
  ["ed.", "Editör", "ed.", "Editor, edited by"],
  ["haz.", "Hazırlayan", "ed.", "Editor"],
  ["Hz.", "Hazreti", "Hazrat", "Hazrat"],
  ["krş.", "Karşılaştırınız", "cf.", "Confer, compare"],
  ["md.", "Madde", "art.", "Article (law)"],
  ["mlf.", "Müellif, yazar", "Auth.", "Author"],
  ["No.", "Numara", "no.", "Number"],
  ["nşr.", "Neşreden", "ed.", "Editor, edited by"],
  ["ö.", "Ölümü", "d.", "Died"],
  ["r.a.", "Radıyallahu anh", "RA", "Raḍiy-Allāhu ʿanhu"],
  ["s.", "Sayfa", "p.", "Page"],
  ["s.a.s.", "Sallallahu aleyhi ve sellem", "PBUH", "Peace be upon him"],
  ["s.a.v.", "Sallallahu aleyhi ve sellem", "PBUH", "Peace be upon him"],
  ["sad.", "Sadeleştiren", "Simplifier", "Simplifier"],
  ["ss.", "Sayfalar", "pp.", "Pages"],
  ["thk.", "Tahkik eden", "critical ed.", "Critical edition"],
  ["Tıpkıbs.", "Tıpkıbasım", "repr.", "Reprint edition"],
  ["ts.", "Tarihsiz", "n.d.", "No date"],
  ["tsh.", "Tashih eden", "Proofreader", "Proofreader"],
  ["vd.", "Ve diğerleri", "et al.", "Et alii (and others)"],
  ["vr.", "Varak", "fol.", "Folio"],
  ["y.y.", "Yayıncı yok", "s.n.", "Sine nomine (no publisher)"],
  ["Yay.", "Yayınları", "Pub.", "Publications"],
  ["yy.", "Yüzyıl", "c.", "Century"],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The first letter either way: a footnote may begin with it ("Bk. Râzî"). */
const either = (s: string) => {
  const c = s.charAt(0);
  const up = c.toLocaleUpperCase("tr");
  const low = c.toLocaleLowerCase("tr");
  return (up === low ? escape(c) : `[${up}${low}]`) + escape(s.slice(1));
};

/**
 * The abbreviations that occur in a text, sorted as Turkish (or English) does:
 * each as [abbreviation, meaning]. A one-letter one ("b.", "s.") counts only
 * where İSNAD uses it: "b." between names, "s." before a page number.
 */
export function usedAbbreviations(text: string, lang = "tr-TR"): [string, string][] {
  const en = /^en/.test(lang);
  const found = new Map<string, string>();
  for (const [tr, trm, eng, engm] of ABBREVIATIONS) {
    const abbr = en ? eng : tr;
    const meaning = en ? engm : trm;
    if (found.has(abbr)) continue;
    let re: RegExp;
    if (abbr === "b.") re = /\p{L}\s+b\.\s+\p{Lu}/u;
    else if (abbr === "s." || abbr === "p.") re = new RegExp(`(^|[\\s(,;])${escape(abbr)}\\s*\\d`, "u");
    else if (abbr === "ö." || abbr === "d.") re = new RegExp(`\\(${escape(abbr)}\\s*\\d`, "u");
    else re = new RegExp(`(^|[\\s(“"‘'„,;:/\\[])${either(abbr)}(?=$|[\\s,;:)\\]”"’.])`, "u");
    if (re.test(text)) found.set(abbr, meaning);
  }
  return [...found].sort((a, b) => a[0].replace(/[^\p{L}]/gu, "").localeCompare(b[0].replace(/[^\p{L}]/gu, ""), en ? "en" : "tr"));
}

/** The list for the document: what the citations use plus what the last scan of its own text found. */
export function abbreviationList(text: string, fromDocument: readonly string[], lang = "tr-TR"): [string, string][] {
  const en = /^en/.test(lang);
  const map = new Map(usedAbbreviations(text, lang));
  for (const a of fromDocument) {
    const row = ABBREVIATIONS.find((r) => (en ? r[2] : r[0]) === a);
    if (row && !map.has(a)) map.set(a, en ? row[3] : row[1]);
  }
  return [...map].sort((a, b) => a[0].replace(/[^\p{L}]/gu, "").localeCompare(b[0].replace(/[^\p{L}]/gu, ""), en ? "en" : "tr"));
}

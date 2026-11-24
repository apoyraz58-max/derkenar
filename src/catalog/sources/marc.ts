import { DOMParser } from "@xmldom/xmldom";
import type { Creator } from "../../core/zotero.js";
import { type Attribution, type Claim, type RecordInput } from "../model.js";
import { inputStream } from "./files.js";
import { StringDecoder } from "node:string_decoder";

const MARC_NAMESPACE = "http://www.loc.gov/MARC21/slim";
const relators: Record<string, string> = {
  aut: "author", edt: "editor", trl: "translator", ill: "illustrator", pht: "photographer",
  aui: "introduction", aqt: "quotationAuthor", ann: "annotator", ctb: "contributor",
  com: "compiler", bkd: "bookDesigner", prf: "proofreader",
};
const strip = (value: string) => value.trim().replace(/\s+[/:;,=]+\s*$/, "").trim();
const imprint = (value: string) => strip(value).replace(/^\[([^\]]+)\](?:[.,])?$/, "$1").replace(/[,:;]+$/, "").trim();
const elements = (node: Node, name: string) => Array.from(node.childNodes)
  .filter((child): child is Element => child.nodeType === 1 && (child as Element).localName === name);

function roles(field: Element): string[] {
  const terms = elements(field, "subfield")
    .filter(s => ["e", "4"].includes(s.getAttribute("code") ?? ""))
    .map(s => (s.textContent ?? "").toLocaleLowerCase("tr").trim().replace(/[.,]+$/, ""));
  const known = terms.flatMap(t => {
    const code = /^https?:.*\/([a-z]{3})$/.exec(t)?.[1] ?? t;
    if (relators[code]) return [relators[code]];
    if (/tahkik|muhakkik|critical edit/.test(t)) return ["muhakkik"];
    if (/neşreden|nâşir|\bnşr\b/.test(t)) return ["nasir"];
    if (/sadeleştir/.test(t)) return ["sadelestiren"];
    if (/hazırlayan|\bhaz\b/.test(t)) return ["hazirlayan"];
    if (/yazar|verfasser|author/.test(t)) return ["author"];
    if (/editör|editor|herausgeber/.test(t)) return ["editor"];
    if (/çevir|mütercim|translat|übersetz/.test(t)) return ["translator"];
    return [];
  });
  if (known.includes("editor") && known.some(r => ["nasir", "muhakkik", "hazirlayan", "sadelestiren"].includes(r))) {
    return [...new Set(known.filter(r => r !== "editor"))];
  }
  if (known.length) return [...new Set(known)];
  if (terms.length) return ["contributor"];
  return /^(100|110|111)$/.test(field.getAttribute("tag") ?? "") ? ["author"] : ["contributor"];
}

export function marcRecord(raw: string, source: "k10plus" | "doab"): RecordInput | null {
  let malformed = false;
  // MARC collection and SRU files may declare the record prefix on an ancestor.
  const prefix = /^<([\w.-]+):record\b/.exec(raw)?.[1];
  const xml = prefix && !raw.slice(0, raw.indexOf(">")).includes(`xmlns:${prefix}=`)
    ? raw.replace(/^<[^\s>]+/, root => `${root} xmlns:${prefix}="${MARC_NAMESPACE}"`)
    : raw;
  const doc = new DOMParser({ errorHandler: { warning() {}, error() { malformed = true; }, fatalError() { malformed = true; } } }).parseFromString(xml, "application/xml");
  const record = doc.documentElement;
  if (malformed || record.localName !== "record" || (record.namespaceURI && record.namespaceURI !== MARC_NAMESPACE)) {
    throw new Error("Geçersiz MARCXML kaydı.");
  }
  const leader = elements(record, "leader")[0]?.textContent ?? "";
  if (leader[6] !== "a" || leader[7] !== "m") return null;
  const control = (tag: string) => elements(record, "controlfield").find(e => e.getAttribute("tag") === tag)?.textContent ?? "";
  const id = control("001").trim();
  if (!id) throw new Error("MARCXML 001 alanı boş.");
  const df = (tag: string) => elements(record, "datafield").filter(e => e.getAttribute("tag") === tag);
  const sub = (field: Element | undefined, code: string) => field
    ? elements(field, "subfield").filter(e => e.getAttribute("code") === code).map(e => (e.textContent ?? "").trim())
    : [];
  const first = (tag: string, code: string) => sub(df(tag)[0], code)[0] ?? "";
  const fields: Claim[] = [];
  const add = (field: string, value: string, path: string) => {
    if (value && !/^(?:\[?s\.\s?[ln]\.\]?|\[?(?:basım yeri|yayıncı|yayın tarihi) yok\]?)$/i.test(value)) fields.push({ field, value, path });
  };
  const title = [strip(first("245", "a")), strip(first("245", "b"))].filter(Boolean).join(": ");
  const part = [strip(first("245", "n")), strip(first("245", "p"))].filter(Boolean).join(" ");
  add("title", [title, part].filter(Boolean).join(". "), "245$a$b$n$p");
  for (const tag of ["130", "240"]) {
    const uniform = strip(first(tag, "a"));
    if (!uniform) continue;
    add("workTitle", [uniform, strip(first(tag, "n")), strip(first(tag, "p"))].filter(Boolean).join(". "), `${tag}$a$n$p`);
    break;
  }
  const pub = df("264").find(e => e.getAttribute("ind2") === "1") ?? df("260")[0];
  const pubTag = pub?.getAttribute("tag") ?? "264";
  const fixed = control("008");
  const date = imprint(sub(pub, "c")[0] ?? "").replace(/\.$/, "");
  const fixedYear = /^[st]$/.test(fixed[6] ?? "") && /^\d{4}$/.test(fixed.slice(7, 11)) ? fixed.slice(7, 11) : "";
  add("place", imprint(sub(pub, "a")[0] ?? ""), `${pubTag}$a`);
  add("publisher", imprint(sub(pub, "b")[0] ?? ""), `${pubTag}$b`);
  add("date", date || fixedYear, date ? `${pubTag}$c` : "008/06–10");
  const country = fixed.slice(15, 18).trim();
  const explicitTr = df("044").some(e => sub(e, "c").some(c => /^(TR|XB-TR)$/i.test(c)));
  if (explicitTr) add("country", "TR", "044$c");
  if (/^[a-z]{2,3}$/.test(country) && !/^(xx|vp|xxu)$/.test(country)) add("country", country, "008/15–17");
  if (country === "xxu") add("country", "US", "008/15–17");
  const language = first("041", "a") || fixed.slice(35, 38);
  if (/^[a-z]{3}$/.test(language) && !["und", "zxx", "mul"].includes(language)) add("language", language, first("041", "a") ? "041$a" : "008/35–37");
  add("edition", imprint(first("250", "a")).replace(/\.$/, ""), "250$a");
  const physical = first("300", "a");
  add("numPages", /(?:^|\s)(\d+)\s*(?:sayfa|Seiten|pages|p\.|s\.)/i.exec(physical)?.[1] ?? "", "300$a");
  add("numberOfVolumes", /^(\d+)\s*(?:cilt|vol\.|c\.|v\.)/i.exec(physical)?.[1] ?? "", "300$a");
  const carriers = df("338").flatMap(e => sub(e, "b"));
  if (carriers.includes("nc")) add("format", "Basılı", "338$b");
  if (carriers.includes("cr")) add("format", "Elektronik", "338$b");
  for (const [i, e] of df("020").entries()) {
    for (const isbn of sub(e, "a")) {
      const q = [...sub(e, "q"), /\((.*?)\)/.exec(isbn)?.[1] ?? ""].join(" ");
      if (carriers.includes("nc") && /ebook|e-book|online|elektron|pdf|epub/i.test(q)) continue;
      if (carriers.includes("cr") && /print|paperback|hardcover|brosch|karton/i.test(q)) continue;
      add("ISBN", isbn.replace(/\s*\([^)]*\)\s*$/, ""), `020[${i}]$a`);
    }
  }
  for (const [i, e] of df("024").entries()) {
    if (sub(e, "2").includes("doi")) add("DOI", sub(e, "a")[0] ?? "", `024[${i}]$a`);
  }
  const creators: Attribution[] = [];
  for (const tag of ["100", "110", "111", "700", "710", "711"]) {
    for (const [i, e] of df(tag).entries()) {
      const value = imprint(sub(e, "a")[0] ?? "").replace(/,\s*$/, "");
      if (!value) continue;
      const personal = tag.endsWith("00");
      const comma = value.indexOf(",");
      const name: Omit<Creator, "creatorType"> = personal && comma > 0
        ? { lastName: value.slice(0, comma).trim(), firstName: value.slice(comma + 1).trim() }
        : { name: value };
      for (const role of roles(e)) creators.push({
        creator: { creatorType: role, ...name },
        kind: personal ? "person" : "organization",
        path: `${tag}[${i}]$a$e$4`,
      });
    }
  }
  const url = source === "k10plus"
    ? `https://kxp.k10plus.de/DB=2.1/PPNSET?PPN=${encodeURIComponent(id)}`
    : df("856").flatMap(e => sub(e, "u")).find(u => /^https:\/\/directory\.doabooks\.org\//.test(u))
      ?? `https://memo.doabooks.org/file/oapen/DOAB_MARCXML.xml#${encodeURIComponent(id)}`;
  return { id, url, raw, fields, creators };
}

/** Frame MARC records in a collection or SRU response with bounded memory. */
export async function* marcFile(file: string, source: "k10plus" | "doab") {
  const stream = inputStream(file);
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const start = /<((?:[\w.-]+:)?record)(?=[\s>])[^>]*>\s*<(?:[\w.-]+:)?leader(?=[\s>])/;
  try {
    for await (const chunk of stream) {
      buffer += decoder.write(chunk);
      while (buffer) {
        const match = start.exec(buffer);
        if (!match) {
          buffer = buffer.slice(-8192);
          break;
        }
        const end = buffer.indexOf(`</${match[1]}>`, match.index + match[0].length);
        if (end < 0) {
          buffer = buffer.slice(match.index);
          if (buffer.length > 8 * 1024 * 1024) throw new Error("MARCXML kaydı çok büyük veya eksik.");
          break;
        }
        const next = end + match[1]!.length + 3;
        const raw = buffer.slice(match.index, next);
        const record = marcRecord(raw, source);
        buffer = buffer.slice(next);
        if (record) yield record;
      }
    }
    if (start.test(buffer) || /<\/?(?:[\w.-]+:)?record\b[^>]*$/.test(buffer)) throw new Error("MARCXML dosyasının son kaydı eksik.");
  } finally {
    stream.destroy();
  }
}

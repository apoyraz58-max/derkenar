import { type Claim, type RecordInput } from "../model.js";
import { lines } from "./files.js";

const columns = [
  "publication_type", "publication_title", "publisher_name", "title_url", "title_id",
  "print_identifier", "online_identifier", "date_monograph_published_print",
  "date_monograph_published_online", "monograph_volume", "monograph_edition",
  "first_author", "first_editor",
] as const;
type Column = typeof columns[number];

const media = [
  { key: "online", format: "Elektronik", isbn: "online_identifier", date: "date_monograph_published_online" },
  { key: "print", format: "Basılı", isbn: "print_identifier", date: "date_monograph_published_print" },
] as const;

export async function* ozgurKbart(file: string) {
  let header: string[] | undefined;
  let positions: Map<string, number> | undefined;
  let lineNumber = 0;
  for await (const raw of lines(file)) {
    lineNumber++;
    if (!raw.trim()) continue;
    const parts = raw.split("\t");
    if (!positions) {
      header = parts.map(value => value.replace(/^\uFEFF/, "").trim().toLowerCase());
      positions = new Map(header.map((value, i) => [value, i]));
      if (positions.size !== header.length || columns.some(name => !positions!.has(name))) {
        throw new Error("KBART üstbilgi sütunları eksik veya yinelenmiş.");
      }
      continue;
    }
    if (parts.length !== header!.length) throw new Error(`KBART ${lineNumber}. satırda sütun sayısı uyuşmuyor.`);
    const get = (column: Column) => parts[positions!.get(column)!]?.trim() ?? "";
    if (get("publication_type") !== "monograph") continue;
    const url = get("title_url");
    if (!/^https:\/\/(?:www\.)?ozguryayinlari\.com\/site\/(?:tr\/|en\/)?catalog\/book\/\d+(?:[/?#]|$)/i.test(url)) {
      throw new Error(`KBART ${lineNumber}. satırın yayınevi kayıt adresi geçersiz.`);
    }
    const identifier = get("title_id");
    const doi = /^10\.\d{4,9}\/\S+$/i.test(identifier) ? identifier : undefined;
    const field = (column: Column, name: string): Claim => ({ field: name, value: get(column), path: column });
    const common = [
      field("publication_title", "title"), field("publisher_name", "publisher"),
      field("title_url", "url"), field("monograph_edition", "edition"), field("monograph_volume", "volume"),
      // KBART reports the first name entry in each role, with no guarantee of a full name or list.
      field("first_author", "firstAuthor"), field("first_editor", "firstEditor"),
    ];
    const formats = media.filter(m => get(m.isbn) || get(m.date));
    const base = identifier || url.replace(/[?#].*$/, "");
    if (!formats.length) {
      if (doi) common.push({ field: "workDOI", value: doi, path: "title_id" });
      yield { id: `${base}:unknown`, url, raw, fields: common, creators: [] } satisfies RecordInput;
      continue;
    }
    for (const m of formats) {
      const fields = [...common, field(m.isbn, "ISBN"), field(m.date, "date"),
        { field: "format", value: m.format, path: get(m.isbn) ? m.isbn : m.date }];
      // A single work-level DOI can describe both formats. Keep it as evidence
      // while avoiding a false DOI-based merge across carriers.
      if (doi) fields.push({ field: formats.length === 1 ? "DOI" : "workDOI", value: doi, path: "title_id" });
      yield { id: `${base}:${m.key}`, url, raw, fields, creators: [] } satisfies RecordInput;
    }
  }
  if (!header) throw new Error("KBART dosyasında üstbilgi satırı bulunamadı.");
}

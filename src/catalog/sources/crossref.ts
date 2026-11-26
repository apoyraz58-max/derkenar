import { createWriteStream } from "node:fs";
import { link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { type Attribution, type Claim, type RecordInput } from "../model.js";
import { lines } from "./files.js";

const API = "https://api.crossref.org";
const BOOK_TYPES = ["book", "monograph", "edited-book", "reference-book"];
// The works route does not allow selecting isbn-type, language or edition-number, so whole records are kept.
const KEEP = ["DOI", "type", "title", "subtitle", "publisher", "publisher-location", "language", "ISBN", "isbn-type",
  "issued", "published-print", "published-online", "author", "editor", "translator", "edition-number", "URL", "member"] as const;
type Fetch = typeof fetch;

interface CrossrefName { given?: string; family?: string; name?: string; sequence?: string }
interface CrossrefWork {
  DOI: string; type: string; member?: string; title?: string[]; subtitle?: string[]; publisher?: string;
  "publisher-location"?: string; language?: string; "isbn-type"?: { value: string; type: string }[]; ISBN?: string[];
  issued?: { "date-parts"?: (number | null)[][] }; "published-print"?: { "date-parts"?: (number | null)[][] };
  "published-online"?: { "date-parts"?: (number | null)[][] };
  author?: CrossrefName[]; editor?: CrossrefName[]; translator?: CrossrefName[]; "edition-number"?: string;
}

async function getJson(url: string, fetchFn: Fetch) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(120_000),
      headers: { Accept: "application/json", "User-Agent": "Derkenar-Catalog/0.1" } }).catch(() => undefined);
    if (response?.ok) return response.json() as Promise<{ message: Record<string, unknown> }>;
    await response?.body?.cancel();
    if (attempt === 4) throw new Error(`Crossref yanıt vermedi (${response?.status ?? "ağ hatası"}): ${url}`);
    await setTimeout(2000 * 2 ** attempt);
  }
}

/**
 * Collects the book-level works of Crossref members whose registered location
 * is Türkiye into a JSONL snapshot. Member location only selects candidates;
 * it is not treated as evidence of the place of publication.
 */
export async function collectCrossref(file: string, options: { limit?: number; delayMs?: number; members?: string[] } = {}, fetchFn: Fetch = fetch) {
  if (!file.endsWith(".jsonl")) throw new Error("Crossref anlık görüntüsü için .jsonl uzantısı kullanın.");
  const members: { id: string; name: string }[] = [];
  if (options.members) members.push(...options.members.map(id => ({ id, name: id })));
  else {
    for (let cursor = "*"; cursor;) {
      const page = await getJson(`${API}/members?rows=1000&cursor=${encodeURIComponent(cursor)}`, fetchFn);
      const items = (page.message.items ?? []) as { id: number; "primary-name": string; location?: string; "counts-type"?: { all?: Record<string, number> } }[];
      for (const m of items) {
        const books = BOOK_TYPES.reduce((sum, t) => sum + (m["counts-type"]?.all?.[t] ?? 0), 0);
        if (/t[uü]rk/i.test(m.location ?? "") && books > 0) members.push({ id: String(m.id), name: m["primary-name"] });
      }
      cursor = items.length ? String(page.message["next-cursor"] ?? "") : "";
    }
  }
  const temp = `${file}.${randomUUID()}.part`;
  const out = createWriteStream(temp, { flags: "wx" });
  const write = (text: string) => new Promise<void>((resolve, reject) => out.write(text, e => e ? reject(e) : resolve()));
  let written = 0;
  try {
    outer: for (const member of members) {
      const filter = BOOK_TYPES.map(t => `type:${t}`).join(",");
      for (let cursor = "*"; cursor;) {
        const page = await getJson(`${API}/members/${member.id}/works?rows=1000&filter=${filter}&cursor=${encodeURIComponent(cursor)}`, fetchFn);
        const items = (page.message.items ?? []) as CrossrefWork[];
        for (const item of items) {
          if (written === options.limit) break outer;
          const kept = Object.fromEntries(KEEP.filter(k => k in item).map(k => [k, item[k as keyof CrossrefWork]]));
          await write(`${JSON.stringify({ ...kept, member: member.id })}\n`);
          written++;
        }
        cursor = items.length ? String(page.message["next-cursor"] ?? "") : "";
        if (options.delayMs) await setTimeout(options.delayMs);
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => e ? reject(e) : resolve()));
    await link(temp, file);
    return { members: members.length, written };
  } finally {
    out.destroy();
    await unlink(temp).catch(() => undefined);
  }
}

const year = (date?: { "date-parts"?: (number | null)[][] }) => {
  const y = date?.["date-parts"]?.[0]?.[0];
  return typeof y === "number" && y > 1400 && y < 2100 ? String(y) : "";
};

function names(list: CrossrefName[] | undefined, role: "author" | "editor" | "translator", path: string): Attribution[] {
  const sorted = [...(list ?? [])].map((n, i) => ({ n, i }))
    .sort((a, b) => Number(b.n.sequence === "first") - Number(a.n.sequence === "first") || a.i - b.i);
  return sorted.flatMap(({ n, i }): Attribution[] => {
    if (n.family?.trim()) {
      return [{ creator: { creatorType: role, lastName: n.family.trim(), ...(n.given?.trim() ? { firstName: n.given.trim() } : {}) },
        path: `${path}[${i}]`, kind: "person" }];
    }
    const name = (n.name ?? n.given ?? "").trim();
    return name ? [{ creator: { creatorType: role, name }, path: `${path}[${i}]`, kind: "organization" }] : [];
  });
}

/** Reads a Crossref JSONL snapshot; a print and an electronic ISBN become separate carriers, as in KBART. */
export async function* crossrefFile(file: string): AsyncGenerator<RecordInput> {
  let lineNumber = 0;
  for await (const raw of lines(file)) {
    lineNumber++;
    if (!raw.trim()) continue;
    let work: CrossrefWork;
    try { work = JSON.parse(raw) as CrossrefWork; } catch { throw new Error(`Crossref ${lineNumber}. satır geçersiz JSON.`); }
    if (!work.DOI || !BOOK_TYPES.includes(work.type)) continue;
    const doi = work.DOI.toLowerCase();
    const url = `https://doi.org/${work.DOI}`;
    const title = [work.title?.[0]?.trim(), work.subtitle?.[0]?.trim()].filter(Boolean).join(": ");
    const common: Claim[] = [
      { field: "title", value: title, path: work.subtitle?.[0] ? "title[0]+subtitle[0]" : "title[0]" },
      { field: "publisher", value: work.publisher?.trim() ?? "", path: "publisher" },
      { field: "place", value: work["publisher-location"]?.trim() ?? "", path: "publisher-location" },
      { field: "language", value: work.language ?? "", path: "language" },
      { field: "edition", value: /^\d+$/.test(work["edition-number"] ?? "") ? work["edition-number"]! : "", path: "edition-number" },
      { field: "url", value: url, path: "DOI" },
    ];
    const creators = [...names(work.author, "author", "author"), ...names(work.editor, "editor", "editor"),
      ...names(work.translator, "translator", "translator")];
    const typed = (work["isbn-type"] ?? []).filter(i => i.value);
    const print = typed.filter(i => i.type === "print");
    const online = typed.filter(i => i.type === "electronic");
    const carriers = [
      ...print.map(i => ({ key: "print", isbn: i.value, format: "Basılı", date: year(work["published-print"]) || year(work.issued) })),
      ...online.map(i => ({ key: "online", isbn: i.value, format: "Elektronik", date: year(work["published-online"]) || year(work.issued) })),
    ];
    if (!carriers.length) {
      const isbn = work.ISBN?.length === 1 ? work.ISBN[0]! : "";
      yield { id: doi, url, raw, creators, fields: [...common, { field: "DOI", value: doi, path: "DOI" },
        { field: "ISBN", value: isbn, path: "ISBN[0]" }, { field: "date", value: year(work["published-print"]) || year(work.issued), path: "issued" }] };
      continue;
    }
    for (const c of carriers) {
      // One DOI can describe both carriers; keep it as work-level evidence to avoid a false merge.
      const doiField: Claim = { field: carriers.length === 1 ? "DOI" : "workDOI", value: doi, path: "DOI" };
      yield { id: carriers.length === 1 ? doi : `${doi}:${c.key}:${c.isbn}`, url, raw, creators, fields: [...common, doiField,
        { field: "ISBN", value: c.isbn, path: `isbn-type[${c.key}]` }, { field: "format", value: c.format, path: `isbn-type[${c.key}]` },
        { field: "date", value: c.date, path: c.key === "print" ? "published-print" : "published-online" }] };
    }
  }
}

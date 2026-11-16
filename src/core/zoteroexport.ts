/**
 * Exports Zotero reads back without loss: Zotero RDF (with collections, child
 * notes, tags, relations, link attachments) and Zotero's CSV columns; plus an
 * HTML report like Zotero's "Generate Report from Items".
 */
import { type Collection, type Creator, type Item, creatorFull, creatorTypeLabel, fieldLabel, isNoteItem, itemTypeLabel, noteText, titleOf, toZoteroData } from "./zotero.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fields written as their own RDF elements; everything else goes in z:* elements by name. */
const SIMPLE: Record<string, string> = {
  title: "dc:title",
  date: "dc:date",
  accessDate: "dcterms:dateSubmitted",
  abstractNote: "dcterms:abstract",
  pages: "bib:pages",
  volume: "prism:volume",
  edition: "prism:edition",
  rights: "dc:rights",
  extra: "dc:description",
  archiveLocation: "dc:coverage",
  numberOfVolumes: "z:numberOfVolumes",
  numPages: "z:numPages",
  shortTitle: "z:shortTitle",
  language: "z:language",
  libraryCatalog: "z:libraryCatalog",
  callNumber: "z:callNumber",
  archive: "z:archive",
  originalDate: "z:originalDate",
  originalPublisher: "z:originalPublisher",
  originalPlace: "z:originalPlace",
  citationKey: "z:citationKey",
};
const PUBLISHER_FIELDS = new Set(["publisher", "university", "institution", "label", "company", "studio", "network", "distributor"]);
const CONTAINER_FIELDS = new Set(["publicationTitle", "bookTitle", "encyclopediaTitle", "dictionaryTitle", "proceedingsTitle", "websiteTitle", "blogTitle", "forumTitle", "programTitle", "seriesTitle"]);

function people(tag: string, list: Creator[]): string {
  if (!list.length) return "";
  const lis = list
    .map((c) => (c.name !== undefined ? `<rdf:li><foaf:Person><foaf:surname>${esc(c.name)}</foaf:surname></foaf:Person></rdf:li>` : `<rdf:li><foaf:Person><foaf:surname>${esc(c.lastName ?? "")}</foaf:surname><foaf:givenName>${esc(c.firstName ?? "")}</foaf:givenName></foaf:Person></rdf:li>`))
    .join("");
  return `<${tag}><rdf:Seq>${lis}</rdf:Seq></${tag}>`;
}

export function zoteroRdf(items: readonly Item[], collections: readonly Collection[]): string {
  const out: string[] = [];
  const memoIds: string[] = [];
  for (const item of items) {
    if (isNoteItem(item)) {
      out.push(`<bib:Memo rdf:about="#item_${item.key}"><rdf:value>${esc(item.notes[0]?.note ?? "")}</rdf:value>${item.tags.map((t) => `<dc:subject>${esc(t.tag)}</dc:subject>`).join("")}</bib:Memo>`);
      continue;
    }
    const z = toZoteroData(item) as Record<string, unknown> & { creators: Creator[] };
    const parts: string[] = [`<z:itemType>${item.itemType}</z:itemType>`];
    const byType = new Map<string, Creator[]>();
    for (const c of z.creators) byType.set(c.creatorType, [...(byType.get(c.creatorType) ?? []), c]);
    for (const [type, list] of byType) parts.push(people(type === "author" ? "bib:authors" : type === "editor" ? "bib:editors" : type === "contributor" ? "bib:contributors" : `z:${type}s`, list));
    let publisher = "";
    let place = "";
    let container = "";
    for (const [k, v] of Object.entries(z)) {
      if (typeof v !== "string" || !v || ["key", "itemType", "dateAdded", "dateModified"].includes(k)) continue;
      if (PUBLISHER_FIELDS.has(k)) publisher = v;
      else if (k === "place") place = v;
      else if (CONTAINER_FIELDS.has(k)) container = v;
      else if (k === "DOI" || k === "ISBN" || k === "ISSN") parts.push(`<dc:identifier>${k} ${esc(v)}</dc:identifier>`);
      else if (k === "url") parts.push(`<dc:identifier><dcterms:URI><rdf:value>${esc(v)}</rdf:value></dcterms:URI></dc:identifier>`);
      else if (k === "issue" || k === "number") parts.push(`<prism:number>${esc(v)}</prism:number>`);
      else parts.push(SIMPLE[k] ? `<${SIMPLE[k]}>${esc(v)}</${SIMPLE[k]}>` : `<z:${k}>${esc(v)}</z:${k}>`);
    }
    if (publisher || place) parts.push(`<dc:publisher><foaf:Organization>${place ? `<vcard:adr><vcard:Address><vcard:locality>${esc(place)}</vcard:locality></vcard:Address></vcard:adr>` : ""}${publisher ? `<foaf:name>${esc(publisher)}</foaf:name>` : ""}</foaf:Organization></dc:publisher>`);
    if (container) parts.push(`<dcterms:isPartOf><bib:Periodical><dc:title>${esc(container)}</dc:title></bib:Periodical></dcterms:isPartOf>`);
    for (const t of item.tags) parts.push(t.type === 1 ? `<dc:subject><z:AutomaticTag><rdf:value>${esc(t.tag)}</rdf:value></z:AutomaticTag></dc:subject>` : `<dc:subject>${esc(t.tag)}</dc:subject>`);
    for (const r of item.relations) parts.push(`<dc:relation rdf:resource="#item_${r}"/>`);
    item.notes.forEach((n, i) => {
      const id = `#item_${item.key}_n${i}`;
      parts.push(`<dcterms:isReferencedBy rdf:resource="${id}"/>`);
      memoIds.push(`<bib:Memo rdf:about="${id}"><rdf:value>${esc(n.note)}</rdf:value></bib:Memo>`);
    });
    for (const a of item.attachments ?? []) if (a.kind === "link" && a.url) parts.push(`<link:link rdf:resource="#item_${a.key}"/>`), memoIds.push(`<z:Attachment rdf:about="#item_${a.key}"><z:itemType>attachment</z:itemType><dc:identifier><dcterms:URI><rdf:value>${esc(a.url)}</rdf:value></dcterms:URI></dc:identifier><dc:title>${esc(a.title)}</dc:title><z:linkMode>3</z:linkMode></z:Attachment>`);
    out.push(`<bib:Document rdf:about="#item_${item.key}">${parts.join("")}</bib:Document>`);
  }
  for (const c of collections) {
    const kids = collections.filter((x) => x.parentKey === c.key).map((x) => `<dcterms:hasPart rdf:resource="#collection_${x.key}"/>`);
    const its = items.filter((i) => i.collections.includes(c.key)).map((i) => `<dcterms:hasPart rdf:resource="#item_${i.key}"/>`);
    out.push(`<z:Collection rdf:about="#collection_${c.key}"><dc:title>${esc(c.name)}</dc:title>${kids.join("")}${its.join("")}</z:Collection>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:z="http://www.zotero.org/namespaces/export#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:bib="http://purl.org/net/biblio#" xmlns:foaf="http://xmlns.com/foaf/0.1/" xmlns:vcard="http://nwalsh.com/rdf/vCard#" xmlns:prism="http://prismstandard.org/namespaces/1.2/basic/" xmlns:link="http://purl.org/rss/1.0/modules/link/">
${[...out, ...memoIds].join("\n")}
</rdf:RDF>
`;
}

// ---------------------------------------------------------------- CSV (Zotero's columns)

const CSV_COLUMNS: [string, (i: Item) => string][] = [
  ["Key", (i) => i.key],
  ["Item Type", (i) => i.itemType],
  ["Publication Year", (i) => /\d{4}/.exec(i.fields.date ?? "")?.[0] ?? ""],
  ["Author", (i) => creatorsOf(i, "author")],
  ["Title", (i) => titleOf(i)],
  ["Publication Title", (i) => i.fields.publicationTitle ?? i.fields.bookTitle ?? i.fields.encyclopediaTitle ?? ""],
  ["ISBN", (i) => i.fields.ISBN ?? ""],
  ["ISSN", (i) => i.fields.ISSN ?? ""],
  ["DOI", (i) => i.fields.DOI ?? ""],
  ["Url", (i) => i.fields.url ?? ""],
  ["Abstract Note", (i) => i.fields.abstractNote ?? ""],
  ["Date", (i) => i.fields.date ?? ""],
  ["Date Added", (i) => i.dateAdded],
  ["Date Modified", (i) => i.dateModified],
  ["Pages", (i) => i.fields.pages ?? ""],
  ["Num Pages", (i) => i.fields.numPages ?? ""],
  ["Issue", (i) => i.fields.issue ?? ""],
  ["Volume", (i) => i.fields.volume ?? ""],
  ["Number Of Volumes", (i) => i.fields.numberOfVolumes ?? ""],
  ["Short Title", (i) => i.fields.shortTitle ?? ""],
  ["Series", (i) => i.fields.series ?? ""],
  ["Publisher", (i) => i.fields.publisher ?? i.fields.university ?? ""],
  ["Place", (i) => i.fields.place ?? ""],
  ["Language", (i) => i.fields.language ?? ""],
  ["Archive", (i) => i.fields.archive ?? ""],
  ["Loc. in Archive", (i) => i.fields.archiveLocation ?? ""],
  ["Extra", (i) => String((toZoteroData(i) as { extra?: string }).extra ?? "")],
  ["Notes", (i) => i.notes.map((n) => noteText(n.note)).join("; ")],
  ["Manual Tags", (i) => i.tags.filter((t) => t.type !== 1).map((t) => t.tag).join("; ")],
  ["Automatic Tags", (i) => i.tags.filter((t) => t.type === 1).map((t) => t.tag).join("; ")],
  ["Editor", (i) => creatorsOf(i, "editor")],
  ["Series Editor", (i) => creatorsOf(i, "muhakkik")],
  ["Translator", (i) => creatorsOf(i, "translator")],
  ["Contributor", (i) => creatorsOf(i, "contributor")],
];

function creatorsOf(i: Item, type: string): string {
  return i.creators.filter((c) => c.creatorType === type).map((c) => c.name ?? [c.lastName, c.firstName].filter(Boolean).join(", ")).join("; ");
}

export function zoteroCsv(items: readonly Item[]): string {
  const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return "﻿" + [CSV_COLUMNS.map(([h]) => cell(h)).join(","), ...items.map((i) => CSV_COLUMNS.map(([, f]) => cell(f(i))).join(","))].join("\r\n");
}

// ---------------------------------------------------------------- report

export function report(items: readonly Item[], collections: readonly Collection[]): string {
  const collName = new Map(collections.map((c) => [c.key, c.name]));
  const body = items
    .map((i) => {
      const rows: string[] = [`<tr><th>Tür</th><td>${esc(itemTypeLabel(i.itemType))}</td></tr>`];
      for (const c of i.creators) rows.push(`<tr><th>${esc(creatorTypeLabel(c.creatorType))}</th><td>${esc(creatorFull(c))}</td></tr>`);
      for (const [k, v] of Object.entries(i.fields)) if (v && k !== "title") rows.push(`<tr><th>${esc(fieldLabel(k))}</th><td>${esc(v)}</td></tr>`);
      if (i.collections.length) rows.push(`<tr><th>Koleksiyonlar</th><td>${esc(i.collections.map((k) => collName.get(k) ?? k).join(", "))}</td></tr>`);
      if (i.tags.length) rows.push(`<tr><th>Etiketler</th><td>${esc(i.tags.map((t) => t.tag).join(", "))}</td></tr>`);
      rows.push(`<tr><th>Eklendi</th><td>${esc(new Date(i.dateAdded).toLocaleString("tr-TR"))}</td></tr>`);
      const notes = i.notes.map((n) => `<div class="note">${n.note}</div>`).join("");
      return `<section><h2>${esc(titleOf(i))}</h2><table>${rows.join("")}</table>${notes ? `<h3>Notlar</h3>${notes}` : ""}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Derkenar raporu</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem}section{border-top:1px solid #ccc;padding:1rem 0}th{text-align:left;vertical-align:top;color:#555;padding-right:1rem;white-space:nowrap}h2{font-size:1.15rem}.note{background:#f6f6f2;padding:.5rem .8rem;border-radius:4px;margin:.4rem 0}</style></head><body><h1>Derkenar raporu</h1><p>${items.length} kaynak · ${esc(new Date().toLocaleString("tr-TR"))}</p>${body}</body></html>`;
}

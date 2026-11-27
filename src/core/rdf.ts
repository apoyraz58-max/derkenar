/**
 * Zotero RDF import: Zotero's own export format, the one that keeps
 * collections (with sub-collections), child notes, tags, related items and
 * every field. Follows the element names Zotero's "Zotero RDF" translator writes.
 */
import { DOMParser } from "@xmldom/xmldom";
import { type Collection, type Creator, type Item, emptyItem, liftExtraRoles, typeField, creatorTypesOf, now } from "./zotero.js";

const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  z: "http://www.zotero.org/namespaces/export#",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  bib: "http://purl.org/net/biblio#",
  foaf: "http://xmlns.com/foaf/0.1/",
  vcard: "http://nwalsh.com/rdf/vCard#",
  prism: "http://prismstandard.org/namespaces/1.2/basic/",
  link: "http://purl.org/rss/1.0/modules/link/",
};

type El = Element;

function children(el: El): El[] {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El);
  return out;
}

function is(el: El, ns: string, local: string): boolean {
  return el.namespaceURI === ns && (el.localName ?? el.nodeName.split(":").pop()) === local;
}

function local(el: El): string {
  return el.localName ?? el.nodeName.split(":").pop() ?? "";
}

function text(el: El | undefined): string {
  return (el?.textContent ?? "").trim();
}

function child(el: El, ns: string, name: string): El | undefined {
  return children(el).find((c) => is(c, ns, name));
}

function about(el: El): string {
  return el.getAttributeNS(NS.rdf, "about") || el.getAttribute("rdf:about") || "";
}

function resource(el: El): string {
  return el.getAttributeNS(NS.rdf, "resource") || el.getAttribute("rdf:resource") || "";
}

/** z:itemType of the element, or a guess from its class (bib:Book …). */
function itemTypeOf(el: El): string | null {
  const t = text(child(el, NS.z, "itemType"));
  if (t) return t;
  const guess: Record<string, string> = { Book: "book", BookSection: "bookSection", Article: "journalArticle", Thesis: "thesis", Manuscript: "manuscript", Letter: "letter", Report: "report", Document: "document" };
  return el.namespaceURI === NS.bib ? guess[local(el)] ?? null : null;
}

/** Simple elements → base field names (Zotero RDF translator, export side). */
const SIMPLE: [string, string, string][] = [
  [NS.dc, "title", "title"],
  [NS.dc, "date", "date"],
  [NS.dcterms, "dateSubmitted", "accessDate"],
  [NS.dcterms, "abstract", "abstractNote"],
  [NS.bib, "pages", "pages"],
  [NS.prism, "volume", "volume"],
  [NS.prism, "number", "number"],
  [NS.prism, "edition", "edition"],
  [NS.prism, "section", "section"],
  [NS.z, "numberOfVolumes", "numberOfVolumes"],
  [NS.z, "numPages", "numPages"],
  [NS.z, "shortTitle", "shortTitle"],
  [NS.z, "language", "language"],
  [NS.z, "libraryCatalog", "libraryCatalog"],
  [NS.z, "type", "type"],
  [NS.z, "medium", "medium"],
  [NS.z, "archive", "archive"],
  [NS.z, "callNumber", "callNumber"],
  [NS.z, "originalDate", "originalDate"],
  [NS.z, "originalPublisher", "originalPublisher"],
  [NS.z, "originalPlace", "originalPlace"],
  [NS.z, "runningTime", "runningTime"],
  [NS.z, "meetingName", "meetingName"],
  [NS.z, "conferenceName", "conferenceName"],
  [NS.z, "citationKey", "citationKey"],
  [NS.dc, "rights", "rights"],
  [NS.dc, "description", "extra"],
  [NS.dc, "coverage", "archiveLocation"],
  [NS.dcterms, "alternative", "journalAbbreviation"],
];

const CREATOR_ELEMENTS: Record<string, string> = { authors: "author", editors: "editor", contributors: "contributor" };

function setBase(item: Item, base: string, value: string, extra: string[]): void {
  if (!value) return;
  const f = typeField(item.itemType, base);
  if (f) {
    if (!item.fields[f]) item.fields[f] = value;
  } else if ((base !== "number" && base !== "issue") || !setNumberLike(item, value)) {
    extra.push(`${base}: ${value}`);
  }
}

/** prism:number means issue for articles, number elsewhere. */
function setNumberLike(item: Item, value: string): boolean {
  // A court decision's number ("K. 2019/1204") comes as the court reporter's number.
  for (const b of ["issue", "seriesNumber", "reportNumber", "billNumber", "docketNumber"]) {
    const f = typeField(item.itemType, b);
    if (f && !item.fields[f]) {
      item.fields[f] = value;
      return true;
    }
  }
  return false;
}

function people(seqParent: El, creatorType: string): Creator[] {
  const out: Creator[] = [];
  const seq = child(seqParent, NS.rdf, "Seq") ?? seqParent;
  for (const li of children(seq)) {
    const person = children(li)[0] ?? li;
    const surname = text(child(person, NS.foaf, "surname"));
    const given = text(child(person, NS.foaf, "givenName") ?? child(person, NS.foaf, "givenname"));
    const name = text(child(person, NS.foaf, "name"));
    if (surname && given) out.push({ creatorType, lastName: surname, firstName: given });
    else if (surname || name) out.push({ creatorType, name: surname || name });
  }
  return out;
}

function creatorTypeFromElement(el: El): string | null {
  const name = local(el);
  if (el.namespaceURI === NS.bib && CREATOR_ELEMENTS[name]) return CREATOR_ELEMENTS[name]!;
  if (el.namespaceURI === NS.z && name.endsWith("s")) return name.slice(0, -1);
  return null;
}

function identifier(item: Item, el: El, extra: string[]): void {
  const uri = child(el, NS.dcterms, "URI");
  if (uri) {
    setBase(item, "url", text(child(uri, NS.rdf, "value")) || text(uri), extra);
    return;
  }
  const v = text(el);
  const m = /^(ISBN|ISSN|DOI)\s+(.+)$/i.exec(v);
  if (m) setBase(item, m[1]!.toUpperCase(), m[2]!, extra);
  else if (/^10\.\d{4,}/.test(v)) setBase(item, "DOI", v, extra);
  else if (/^https?:/.test(v)) setBase(item, "url", v, extra);
}

function publisher(item: Item, el: El, extra: string[]): void {
  const org = children(el)[0];
  if (!org) {
    setBase(item, "publisher", text(el), extra);
    return;
  }
  setBase(item, "publisher", text(child(org, NS.foaf, "name")), extra);
  const adr = child(org, NS.vcard, "adr");
  const address = adr ? children(adr)[0] : undefined;
  if (address) setBase(item, "place", text(child(address, NS.vcard, "locality")), extra);
}

function tags(item: Item, el: El): void {
  const inner = children(el)[0];
  if (!inner) {
    const t = text(el);
    if (t) item.tags.push({ tag: t });
    return;
  }
  if (is(inner, NS.z, "AutomaticTag")) item.tags.push({ tag: text(child(inner, NS.rdf, "value")) || text(inner), type: 1 });
  else if (local(inner) === "LCC" || local(inner) === "DDC" || local(inner) === "UDC") item.fields.callNumber ||= text(child(inner, NS.rdf, "value"));
  else item.tags.push({ tag: text(child(inner, NS.rdf, "value")) || text(inner) });
}

export interface RdfResult {
  items: Item[];
  collections: Collection[];
}

export function parseZoteroRdf(xml: string, source: string): RdfResult {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement as unknown as El;
  if (!root || local(root) !== "RDF") throw new Error("Bu dosya bir RDF kütüphane dosyası değil.");
  const nodes = children(root);
  const byAbout = new Map<string, El>();
  for (const n of nodes) {
    const a = about(n);
    if (a) byAbout.set(a, n);
  }
  const resolve = (el: El): El | undefined => {
    const r = resource(el);
    return r ? byAbout.get(r) : children(el)[0];
  };

  const items: Item[] = [];
  const itemByAbout = new Map<string, Item>();
  const usedAsContainer = new Set<El>();
  // First pass: which elements are only containers (journals, books of sections, series).
  for (const n of nodes) {
    for (const c of children(n)) {
      if (is(c, NS.dcterms, "isPartOf")) {
        const target = resolve(c);
        if (target && !text(child(target, NS.z, "itemType"))) usedAsContainer.add(target);
      }
    }
  }
  for (const n of nodes) {
    if (usedAsContainer.has(n) || is(n, NS.z, "Collection") || is(n, NS.bib, "Memo") || is(n, NS.z, "Attachment")) continue;
    const itemType = itemTypeOf(n);
    if (!itemType || itemType === "attachment" || itemType === "note") continue;
    const item = emptyItem(itemType, source);
    item.dateAdded = item.dateModified = now();
    // Künye's own RDF export keeps Zotero keys ("#item_ABCD2345").
    const ownKey = /^#item_([23456789A-Z]{8})$/.exec(about(n))?.[1];
    if (ownKey) item.key = ownKey;
    const extra: string[] = [];
    const allowed = new Set(creatorTypesOf(itemType));
    const containers: El[] = [];
    for (const c of children(n)) {
      const simple = SIMPLE.find(([ns, name]) => is(c, ns, name));
      if (simple) {
        // Zotero writes a program's version as prism:edition.
        const base = simple[2] === "edition" && !typeField(itemType, "edition") && typeField(itemType, "versionNumber") ? "versionNumber" : simple[2];
        setBase(item, base, text(c), extra);
        continue;
      }
      // Any other z:field Zotero exports under its own name (issuingAuthority, legalStatus, programmingLanguage…).
      if (c.namespaceURI === NS.z && !children(c).length && typeField(itemType, local(c))) {
        setBase(item, local(c), text(c), extra);
        continue;
      }
      const ct = creatorTypeFromElement(c);
      if (ct) {
        for (const p of people(c, ct)) item.creators.push(allowed.has(p.creatorType) || ct === "seriesEditor" ? { ...p, creatorType: ct === "seriesEditor" ? "muhakkik" : ct } : { ...p, creatorType: "contributor" });
        continue;
      }
      if (is(c, NS.dc, "identifier")) identifier(item, c, extra);
      else if (is(c, NS.dc, "publisher")) publisher(item, c, extra);
      else if (is(c, NS.dc, "subject")) tags(item, c);
      else if (is(c, NS.dcterms, "isPartOf")) containers.push(c);
      else if (is(c, NS.dcterms, "isReferencedBy")) {
        const memo = byAbout.get(resource(c));
        const html = memo ? text(child(memo, NS.rdf, "value")) : "";
        if (html) item.notes.push({ key: about(memo!).replace(/^#item_/, "N"), note: html, dateModified: now() });
      } else if (is(c, NS.dc, "relation")) item.relations.push(resource(c));
    }
    // Container last: its editors come after the item's own authors.
    for (const c of containers) container(item, resolve(c), extra);
    if (extra.length) item.fields.extra = [item.fields.extra, ...extra].filter(Boolean).join("\n");
    liftExtraRoles(item);
    items.push(item);
    itemByAbout.set(about(n), item);
  }
  // Relations point at rdf:about values; turn them into item keys.
  for (const item of items) item.relations = item.relations.map((r) => itemByAbout.get(r)?.key).filter((k): k is string => Boolean(k));

  const collections: Collection[] = [];
  const collKey = new Map<string, string>();
  for (const n of nodes) {
    if (!is(n, NS.z, "Collection")) continue;
    const a = about(n);
    collKey.set(a, /^#collection_([23456789A-Z]{8})$/.exec(a)?.[1] ?? a.replace(/^#collection_/, "C").slice(0, 8).padEnd(8, "0"));
  }
  for (const n of nodes) {
    if (!is(n, NS.z, "Collection")) continue;
    const key = collKey.get(about(n))!;
    collections.push({ key, name: text(child(n, NS.dc, "title")) || "Adsız koleksiyon" });
    for (const part of children(n).filter((c) => is(c, NS.dcterms, "hasPart"))) {
      const r = resource(part);
      const sub = collKey.get(r);
      if (sub) {
        const s = collections.find((x) => x.key === sub);
        if (s) s.parentKey = key;
        else collections.push({ key: sub, name: "", parentKey: key });
      }
      const it = itemByAbout.get(r);
      if (it && !it.collections.includes(key)) it.collections.push(key);
    }
  }
  // Sub-collections listed before their parent got a placeholder; merge.
  const merged = new Map<string, Collection>();
  for (const c of collections) merged.set(c.key, { ...merged.get(c.key), ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== "" && v !== undefined)) } as Collection);
  return { items, collections: [...merged.values()].map((c) => ({ ...c, name: c.name || "Adsız koleksiyon" })) };

  function container(item: Item, el: El | undefined, extra: string[]): void {
    if (!el) return;
    const cls = local(el);
    if (cls === "Series") {
      setBase(item, "series", text(child(el, NS.dc, "title")), extra);
      setBase(item, "seriesNumber", text(child(el, NS.dc, "identifier")), extra);
      const alt = text(child(el, NS.dcterms, "alternative"));
      if (typeField(item.itemType, "seriesText")) setBase(item, "seriesText", alt, extra);
      else if (alt && typeField(item.itemType, "seriesTitle") && !item.fields.seriesTitle) item.fields.seriesTitle = alt;
      else setBase(item, "seriesText", alt, extra);
      return;
    }
    for (const c of children(el)) {
      if (is(c, NS.dc, "title")) setBase(item, "publicationTitle", text(c), extra);
      else if (is(c, NS.prism, "volume")) setBase(item, "volume", text(c), extra);
      else if (is(c, NS.prism, "number")) setBase(item, "issue", text(c), extra);
      else if (is(c, NS.dcterms, "alternative")) setBase(item, "journalAbbreviation", text(c), extra);
      else if (is(c, NS.dc, "identifier")) identifier(item, c, extra);
      else if (is(c, NS.dc, "publisher")) publisher(item, c, extra);
      else if (is(c, NS.dcterms, "isPartOf")) container(item, resolve(c), extra);
      else {
        const ct = creatorTypeFromElement(c);
        if (ct) for (const p of people(c, ct)) item.creators.push(ct === "seriesEditor" ? { ...p, creatorType: "muhakkik" } : p);
      }
    }
  }
}

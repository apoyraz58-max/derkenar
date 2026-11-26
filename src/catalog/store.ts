import { createRequire } from "node:module";
import type { DatabaseSync as SqliteDatabase, StatementSync, SupportedValueType } from "node:sqlite";
import type { Authority } from "./authority.js";
import { authorKey, cleanClaim, digest, equivalent, otherVolume, parseEditionNumber, publicationScope, SOURCES, validIsbn, type PartInput, type RecordInput, type SourceId } from "./model.js";
import { checkItem } from "../core/isnad.js";
import { emptyItem, type Creator, type Item } from "../core/zotero.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, license TEXT NOT NULL, policy TEXT NOT NULL, priority INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS jobs (
  source TEXT NOT NULL REFERENCES sources, snapshot TEXT NOT NULL, label TEXT NOT NULL, authority_snapshot TEXT,
  cursor INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source, snapshot)
) STRICT;
CREATE TABLE IF NOT EXISTS exchange_files (
  sha256 TEXT PRIMARY KEY, payload TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE IF NOT EXISTS editions (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL REFERENCES works, title_key TEXT NOT NULL,
  author_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS edition_title ON editions(title_key, author_key);
CREATE INDEX IF NOT EXISTS edition_work ON editions(work_id);
CREATE TABLE IF NOT EXISTS raw_records (
  id INTEGER PRIMARY KEY, source TEXT NOT NULL REFERENCES sources, external_id TEXT NOT NULL,
  url TEXT NOT NULL, sha256 TEXT NOT NULL, payload TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, state TEXT NOT NULL,
  edition_id INTEGER REFERENCES editions, UNIQUE(source, external_id, sha256)
) STRICT;
CREATE INDEX IF NOT EXISTS raw_edition ON raw_records(edition_id, source);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY, raw_id INTEGER NOT NULL REFERENCES raw_records, field TEXT NOT NULL,
  position INTEGER NOT NULL, observed TEXT NOT NULL, value TEXT NOT NULL, path TEXT NOT NULL,
  authority TEXT, UNIQUE(raw_id, field, position)
) STRICT;
CREATE TABLE IF NOT EXISTS edition_fields (
  edition_id INTEGER NOT NULL REFERENCES editions, field TEXT NOT NULL, claim_id INTEGER NOT NULL REFERENCES claims,
  PRIMARY KEY(edition_id, field)
) STRICT;
CREATE INDEX IF NOT EXISTS fields_by_name ON edition_fields(field, edition_id);
CREATE TABLE IF NOT EXISTS contributions (
  edition_id INTEGER NOT NULL REFERENCES editions, role TEXT NOT NULL, position INTEGER NOT NULL,
  claim_id INTEGER NOT NULL REFERENCES claims, PRIMARY KEY(edition_id, role, position)
) STRICT;
CREATE TABLE IF NOT EXISTS identifiers (
  edition_id INTEGER NOT NULL REFERENCES editions, scheme TEXT NOT NULL, value TEXT NOT NULL,
  claim_id INTEGER NOT NULL REFERENCES claims, PRIMARY KEY(edition_id, scheme, value)
) STRICT;
CREATE INDEX IF NOT EXISTS identifier_lookup ON identifiers(scheme, value, edition_id);
CREATE TABLE IF NOT EXISTS validation (
  id INTEGER PRIMARY KEY, raw_id INTEGER REFERENCES raw_records, edition_id INTEGER REFERENCES editions,
  target_id INTEGER REFERENCES editions, code TEXT NOT NULL, level TEXT NOT NULL, detail TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS validation_raw ON validation(raw_id);
CREATE INDEX IF NOT EXISTS validation_code_raw ON validation(code, raw_id);
CREATE INDEX IF NOT EXISTS validation_edition ON validation(edition_id, raw_id);
CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY, source TEXT NOT NULL REFERENCES sources, doi TEXT NOT NULL, title TEXT NOT NULL,
  creators TEXT NOT NULL, pages TEXT, container_title TEXT, container_isbns TEXT NOT NULL,
  edition_id INTEGER REFERENCES editions, url TEXT NOT NULL, raw TEXT NOT NULL, sha256 TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(source, doi)
) STRICT;
CREATE INDEX IF NOT EXISTS parts_edition ON parts(edition_id);
`;

type Scalar = Record<string, string>;
type EditionRow = { id: number; work_id: number; title_key: string; author_key: string; created_at: string };
type ClaimRow = { id: number; field: string; position: number; value: string; priority: number };
type PreviousRecord = { edition_id: number | null; state: string };
type Identity = { scheme: "ISBN" | "DOI"; claimId: number };
const isbnTokens = (value: string) => value.split(/[,;|]+|\s+(?=(?:ISBN\b|[0-9-]{10,}))/iu);
const CHOICES = ["title", "publisher", "place", "country", "date", "edition", "format", "language", "numPages", "numberOfVolumes", "volume", "series", "seriesNumber", "shortTitle", "url", "citationKey", "workTitle"];
const REQUIRED = ["title", "publisher", "place", "date", "language", "edition", "format", "numPages"];
const localFields = new Set(["country", "format"]);
const rank = (a: string) => (/^\d{4}(?:[-/]\d{2}(?:[-/]\d{2})?)?$/.test(a) ? a.slice(0, 4) : a);
const editionNumber = (value?: string) => parseEditionNumber(value ?? "");
const print = new Set(["Basılı", "Paperback", "Hardcover"]);
const creatorKey = (value: string) => {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return JSON.stringify(Object.keys(parsed).sort().map(key => [key, parsed[key]]));
};
const different = (a?: string, b?: string) => Boolean(a && b && equivalent(a) !== equivalent(b));
const diffFormat = (a?: string, b?: string) => different(a, b) &&
  !((a === "Basılı" || b === "Basılı") && print.has(a!) && print.has(b!)) &&
  !((a === "Elektronik" || b === "Elektronik") && ["Elektronik", "Epub", "PDF"].includes(a!) && ["Elektronik", "Epub", "PDF"].includes(b!));
const comparableDate = (a?: string, b?: string) => different(rank(a ?? ""), rank(b ?? ""));
const doiKey = (value: string) => /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s]+)$/i.exec(value)?.[1]?.toLowerCase() ?? null;

function readIdentities(claims: readonly ClaimRow[], invalidIsbn?: (value: string) => void) {
  const identities = new Map<string, Identity>();
  for (const claim of claims) {
    if (claim.field === "ISBN") {
      for (const token of isbnTokens(claim.value)) {
        const isbn = validIsbn(token);
        if (isbn && !identities.has(isbn)) identities.set(isbn, { scheme: "ISBN", claimId: claim.id });
        else if (!isbn) invalidIsbn?.(token.trim());
      }
    }
    if (claim.field === "DOI") {
      const doi = doiKey(claim.value);
      if (doi && !identities.has(doi)) identities.set(doi, { scheme: "DOI", claimId: claim.id });
    }
  }
  return identities;
}

function readClaims(claims: readonly ClaimRow[]) {
  const fields: Scalar = Object.create(null);
  const creators = new Set<string>();
  for (const claim of claims) {
    if (claim.field.startsWith("creator:")) creators.add(claim.value);
    else fields[claim.field] ??= claim.value;
  }
  return { fields, authors: authorKey([...creators].map(value => JSON.parse(value) as Creator)) };
}

function imprintConflict(fresh: Scalar, known: Scalar) {
  return different(fresh.place, known.place) || different(fresh.country, known.country) || comparableDate(fresh.date, known.date) ||
    different(editionNumber(fresh.edition), editionNumber(known.edition)) || diffFormat(fresh.format, known.format) ||
    different(fresh.volume, known.volume);
}

export class Catalog {
  private readonly db: SqliteDatabase;
  private readonly statements = new Map<string, StatementSync>();

  constructor(file: string, readOnly = false) {
    // Node 22 supports readOnly although the pinned Node types predate it.
    const options = { open: true, readOnly };
    this.db = new DatabaseSync(file, options);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=8000;");
    if (readOnly) return;
    this.db.exec("PRAGMA journal_mode=WAL;");
    const version = Number(this.row<{user_version: number}>("PRAGMA user_version")?.user_version);
    if (version > 1) throw new Error("Katalog şeması bu sürümden daha yeni.");
    this.transaction(() => {
      this.db.exec(SCHEMA);
      for (const [id, s] of Object.entries(SOURCES)) {
        this.put("INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?)", id, s.name, s.license, s.policy, s.priority);
      }
      this.db.exec("PRAGMA user_version=1;");
    });
  }

  close() { this.db.close(); }
  private statement(sql: string) {
    let prepared = this.statements.get(sql);
    if (!prepared) {
      prepared = this.db.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }
  private rows<T>(sql: string, ...args: SupportedValueType[]) { return this.statement(sql).all(...args) as T[]; }
  private row<T>(sql: string, ...args: SupportedValueType[]) { return this.statement(sql).get(...args) as T | undefined; }
  private put(sql: string, ...args: SupportedValueType[]) { return this.statement(sql).run(...args); }

  private transaction<T>(fn: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  archiveExchange(hash: string, content: string) {
    this.put("INSERT OR IGNORE INTO exchange_files VALUES (?,?)", hash, content);
  }

  job(source: SourceId, snapshot: string, label: string, authority?: Authority) {
    const authoritySnapshot = authority?.snapshot ?? null;
    this.put("INSERT OR IGNORE INTO jobs(source,snapshot,label,authority_snapshot) VALUES (?,?,?,?)", source, snapshot, label, authoritySnapshot);
    const job = this.row<{cursor: number; state: string; authority_snapshot: string | null}>(
      "SELECT cursor,state,authority_snapshot FROM jobs WHERE source=? AND snapshot=?", source, snapshot)!;
    if (job.state !== "completed" && job.authority_snapshot !== authoritySnapshot) {
      throw new Error("Devam etmek için aynı Vefeyât anlık görüntüsünü kullanın.");
    }
    return { cursor: job.cursor, state: job.state };
  }

  batch(source: SourceId, snapshot: string, cursor: number, entries: readonly RecordInput[], complete: boolean, authority?: Authority,
    keep?: (entry: RecordInput) => boolean) {
    this.transaction(() => {
      const state = this.row<{cursor: number; state: string}>("SELECT cursor,state FROM jobs WHERE source=? AND snapshot=?", source, snapshot);
      if (!state || state.cursor !== cursor || state.state === "completed") throw new Error("Toplama konumu başka bir işlem tarafından değiştirildi.");
      // Filtered entries still advance the cursor so that a resumed job skips them too.
      for (const entry of entries) if (!keep || keep(entry)) this.ingest(source, entry, authority);
      this.put("UPDATE jobs SET cursor=?,state=?,updated_at=CURRENT_TIMESTAMP WHERE source=? AND snapshot=?",
        cursor + entries.length, complete ? "completed" : "paused", source, snapshot);
    });
  }

  private issue(raw: number | null, edition: number | null, code: string, detail: string, target: number | null = null, level = "warning") {
    this.put("INSERT INTO validation(raw_id,edition_id,target_id,code,detail,level) VALUES (?,?,?,?,?,?)", raw, edition, target, code, detail, level);
  }

  private fields(id: number): Scalar {
    return Object.fromEntries(this.rows<{field: string; value: string}>(`
      SELECT f.field,c.value FROM edition_fields f JOIN claims c ON c.id=f.claim_id WHERE f.edition_id=?`, id).map(r => [r.field, r.value]));
  }

  private ingest(source: SourceId, input: RecordInput, authority?: Authority) {
    const sha = digest(input.raw);
    if (this.row("SELECT id FROM raw_records WHERE source=? AND external_id=? AND sha256=?", source, input.id, sha)) return;
    const previous = this.row<{id: number; edition_id: number | null; state: string}>(
      "SELECT id,edition_id,state FROM raw_records WHERE source=? AND external_id=? ORDER BY id DESC LIMIT 1", source, input.id);
    const raw = Number(this.put("INSERT INTO raw_records(source,external_id,url,sha256,payload,state) VALUES (?,?,?,?,?,'review')",
      source, input.id, input.url, sha, input.raw).lastInsertRowid);
    const claims: ClaimRow[] = [];
    const keys = new Map<string, number>();
    const add = (field: string, observed: string, value: string, path: string, match: string | null = null) => {
      const position = keys.get(field) ?? 0;
      keys.set(field, position + 1);
      const id = Number(this.put("INSERT INTO claims(raw_id,field,position,observed,value,path,authority) VALUES (?,?,?,?,?,?,?)",
        raw, field, position, observed, value, path, match).lastInsertRowid);
      claims.push({ id, field, position, value, priority: SOURCES[source].priority });
    };

    for (const observed of input.fields) {
      const claim = cleanClaim(observed);
      if (claim.value) add(claim.field, observed.value, claim.value, claim.path);
    }
    for (const contribution of input.creators) {
      const match = authority?.(contribution);
      const creator = match?.creator ?? contribution.creator;
      add(`creator:${creator.creatorType}`, JSON.stringify(contribution.creator), JSON.stringify(creator), contribution.path,
        match ? JSON.stringify(match) : null);
    }
    this.resolve(source, input.id, raw, claims, previous);
  }

  recheckScope(source: SourceId, after: number, limit: number) {
    return this.transaction(() => {
      const candidates = this.rows<{ id: number; external_id: string }>(`
        SELECT r.id,r.external_id FROM validation v JOIN raw_records r ON r.id=v.raw_id
        WHERE v.code='scope-unknown' AND r.state='review' AND r.source=? AND v.raw_id>?
        ORDER BY v.raw_id LIMIT ?`, source, after, limit);
      const report = { examined: candidates.length, matched: 0, stillUnknown: 0, changedIssue: 0, after: candidates.at(-1)?.id ?? null };
      for (const candidate of candidates) {
        this.resolve(source, candidate.external_id, candidate.id, this.claims(candidate.id), undefined, true);
        const state = this.row<{state: string}>("SELECT state FROM raw_records WHERE id=?", candidate.id)?.state;
        if (state === "matched") report.matched++;
        else if (this.row("SELECT id FROM validation WHERE raw_id=? AND code='scope-unknown'", candidate.id)) report.stillUnknown++;
        else report.changedIssue++;
      }
      return report;
    });
  }

  private claims(raw: number) {
    return this.rows<ClaimRow>(`
      SELECT c.id,c.field,c.position,c.value,s.priority FROM claims c
      JOIN raw_records r ON r.id=c.raw_id JOIN sources s ON s.id=r.source
      WHERE c.raw_id=? ORDER BY c.id`, raw);
  }

  approveTitleVariant(raw: number, edition: number, reason: string) {
    if (!reason.trim()) throw new Error("Başlık varyantı için karar gerekçesi gerekli.");
    return this.transaction(() => {
      const record = this.row<PreviousRecord>("SELECT state,edition_id FROM raw_records WHERE id=?", raw);
      if (record?.state === "matched" && record.edition_id === edition &&
        this.row("SELECT id FROM validation WHERE raw_id=? AND edition_id=? AND code='review:title-variant'", raw, edition)) {
        return { raw, edition, changed: false };
      }
      const target = this.row<EditionRow>("SELECT * FROM editions WHERE id=?", edition);
      if (!target || record?.state !== "review" ||
        !this.row("SELECT id FROM validation WHERE raw_id=? AND target_id=? AND code='identifier-conflict'", raw, edition)) {
        throw new Error("Ham kayıt ve hedef baskı için açık bir kimlik çelişkisi bulunamadı.");
      }
      const claims = this.claims(raw);
      const identities = readIdentities(claims);
      const isbn = [...identities].find(([, i]) => i.scheme === "ISBN")?.[0];
      const doi = [...identities].find(([, i]) => i.scheme === "DOI")?.[0];
      const agreed = this.rows<{edition_id: number}>(`
        SELECT i.edition_id FROM identifiers i JOIN identifiers d ON d.edition_id=i.edition_id
        WHERE i.scheme='ISBN' AND i.value=? AND d.scheme='DOI' AND d.value=?`, isbn ?? "", doi ?? "");
      const canonical = this.rows<{value: string}>("SELECT value FROM identifiers WHERE edition_id=?", edition);
      if (!isbn || !doi || identities.size !== 2 || agreed.length !== 1 || agreed[0]?.edition_id !== edition ||
        canonical.some(i => !identities.has(i.value))) {
        throw new Error("Hedef baskı için aynı geçerli ISBN ve DOI birlikte ve tekil olarak doğrulanamadı.");
      }
      const { fields, authors } = readClaims(claims);
      const scope = publicationScope(fields);
      const selected = this.fields(edition);
      if (!fields.title || !different(fields.title, selected.title) ||
        scope === "outside" || scope === "conflict" || different(authors, target.author_key) ||
        imprintConflict(fields, selected)) {
        throw new Error("Kayıt başlık varyantı olarak bağlanamadı. Yayın ve katkı alanlarını inceleyin.");
      }
      this.attach(raw, edition, claims, identities, "matched", true);
      this.put("DELETE FROM validation WHERE raw_id=? AND code='identifier-conflict'", raw);
      this.issue(raw, edition, "review:title-variant", reason.trim(), null, "info");
      return { raw, edition, changed: true };
    });
  }

  private resolve(source: SourceId, externalId: string, raw: number, claims: readonly ClaimRow[],
    previous?: PreviousRecord, recheckingScope = false) {
    const { fields: effective, authors } = readClaims(claims);
    const identities = readIdentities(claims, recheckingScope ? undefined :
      value => this.issue(raw, null, "invalid-isbn", value));
    const scope = publicationScope(effective);
    const countries = new Set(claims.filter(c => c.field === "country").map(c => equivalent(c.value)));
    if (countries.size > 1 || scope === "conflict") {
      this.issue(raw, null, "scope-conflict", "Yayın ülkesi ve yayın yeri kanıtları uyuşmuyor.");
      return;
    }
    if (scope === "outside") { this.put("UPDATE raw_records SET state='outside' WHERE id=?", raw); return; }
    const title = equivalent(effective.title ?? "");
    if (!title) { this.issue(raw, null, "missing-title", "Başlık bulunamadı.", null, "error"); return; }
    // A changed snapshot of a source ID needs review before it can override or split a published record.
    if (previous?.edition_id || previous?.state === "review") {
      this.issue(raw, null, "source-revision", "Kaynak kaydının yeni sürümü.", previous.edition_id);
      return;
    }
    const allHits = new Map<number, EditionRow>();
    if ([...identities.values()].filter(i => i.scheme === "ISBN").length > 1) {
      this.issue(raw, null, "multiple-isbn", "Birden çok ISBN-13 eşdeğeri tek baskıya güvenle bağlanamadı.");
      return;
    }
    for (const [value, { scheme }] of identities) {
      for (const hit of this.rows<EditionRow>(`SELECT e.* FROM editions e JOIN identifiers i ON e.id=i.edition_id
        WHERE i.scheme=? AND i.value=?`, scheme, value)) allHits.set(hit.id, hit);
    }
    const hits = [...allHits.values()].map(hit => ({ hit, fields: this.fields(hit.id) }));
    const identifierConflict = (id: number) => this.rows<{ scheme: Identity["scheme"]; value: string }>(
      "SELECT scheme,value FROM identifiers WHERE edition_id=?", id).some(existing =>
        !identities.has(existing.value) && [...identities.values()].some(i => i.scheme === existing.scheme));
    const compatible = hits.filter(({ hit, fields }) => title === hit.title_key && !identifierConflict(hit.id) &&
      !different(authors, hit.author_key) && !different(effective.publisher, fields.publisher) && !imprintConflict(effective, fields));
    const distinct = ({ hit, fields }: typeof hits[number]) => {
      const sameAgent = !different(authors, hit.author_key) && !different(effective.publisher, fields.publisher);
      if (sameAgent && otherVolume(effective.title ?? "", fields.title ?? "")) return true;
      return hit.title_key === title && sameAgent &&
        (different(editionNumber(effective.edition), editionNumber(fields.edition)) || diffFormat(effective.format, fields.format) ||
          different(effective.volume, fields.volume));
    };
    const clearScopeIssue = () => {
      if (recheckingScope) this.put("DELETE FROM validation WHERE raw_id=? AND code='scope-unknown'", raw);
    };
    if (compatible.length > 1 || hits.some(h => !compatible.includes(h) && !distinct(h))) {
      clearScopeIssue();
      for (const { hit } of hits) this.issue(raw, null, "identifier-conflict", "Kimlik eşleşmesi tek bir baskıyı doğrulamıyor.", hit.id);
      return;
    }
    if (scope !== "TR" && !compatible.length) {
      if (!recheckingScope) this.issue(raw, null, "scope-unknown", "Türkiye’de yayımlandığına ilişkin yayın yeri veya ülke kanıtı eksik.");
      return;
    }
    clearScopeIssue();
    let edition = compatible[0]?.hit.id;
    const wasMerged = edition !== undefined;
    if (edition === undefined) {
      const candidates = this.rows<EditionRow>("SELECT * FROM editions WHERE title_key=? AND author_key=? LIMIT 51", title, authors);
      const incomingIsbn = [...identities].find(([, i]) => i.scheme === "ISBN")?.[0];
      const possible = candidates.filter(candidate => {
        const existing = this.row<{value: string}>("SELECT value FROM identifiers WHERE edition_id=? AND scheme='ISBN' LIMIT 1", candidate.id)?.value;
        if (incomingIsbn && existing && incomingIsbn !== existing) return false;
        const f = this.fields(candidate.id);
        return !comparableDate(effective.date, f.date) && !different(editionNumber(effective.edition), editionNumber(f.edition)) &&
          !diffFormat(effective.format, f.format) && !different(effective.publisher, f.publisher);
      });
      if (possible.length || candidates.length > 50) {
        for (const candidate of possible) this.issue(raw, null, "possible-duplicate", "Başlık ve baskı ipuçları aynı, ortak güvenilir kimlik yok.", candidate.id);
        if (candidates.length > 50) this.issue(raw, null, "too-many-candidates", "Aynı başlık için ayrıntılı inceleme gerekli.");
        return;
      }
      const workKey = effective.workId ? `${source}:${effective.workId}` :
        authors ? `title-author:${equivalent(effective.workTitle || title)}:${authors}` : `${source}:${externalId}`;
      const existingWork = hits.find(distinct)?.hit.work_id;
      this.put("INSERT OR IGNORE INTO works(identity_key) VALUES (?)", existingWork ? this.row<{identity_key: string}>("SELECT identity_key FROM works WHERE id=?", existingWork)!.identity_key : workKey);
      const work = existingWork ?? this.row<{id: number}>("SELECT id FROM works WHERE identity_key=?", workKey)!.id;
      edition = Number(this.put("INSERT INTO editions(work_id,title_key,author_key) VALUES (?,?,?)", work, title, authors).lastInsertRowid);
      for (const { hit } of hits) this.issue(raw, edition, "shared-identifier", "Farklı baskı, taşıyıcı veya cilt için aynı kimlik bildirildi.", hit.id);
    }
    this.attach(raw, edition, claims, identities, wasMerged ? "matched" : "accepted");
  }

  private attach(raw: number, edition: number, claims: readonly ClaimRow[], identities: ReadonlyMap<string, Identity>,
    state: "matched" | "accepted", keepSelected = false) {
    this.put("UPDATE raw_records SET state=?, edition_id=? WHERE id=?", state, edition, raw);
    for (const field of CHOICES) {
      const fresh = claims.find(c => c.field === field);
      if (!fresh) continue;
      const current = this.row<ClaimRow>(`SELECT c.id,c.value,s.priority FROM edition_fields f
        JOIN claims c ON c.id=f.claim_id JOIN raw_records r ON r.id=c.raw_id JOIN sources s ON s.id=r.source
        WHERE f.edition_id=? AND f.field=?`, edition, field);
      // Different landing pages (publisher page, DOI link) for one edition are evidence, not a conflict.
      if (current && field !== "url" && different(fresh.value, current.value) &&
        (field !== "format" || diffFormat(fresh.value, current.value))) this.issue(raw, edition, "field-conflict", field);
      if (!current || (!keepSelected &&
        ((field === "format" && ["Basılı", "Elektronik"].includes(current.value) && !diffFormat(fresh.value, current.value)) ||
        (fresh.priority > current.priority && !(field === "format" && ["Basılı", "Elektronik"].includes(fresh.value) && !diffFormat(fresh.value, current.value)))))) {
        this.put("INSERT OR REPLACE INTO edition_fields VALUES (?,?,?)", edition, field, fresh.id);
      }
    }
    for (const [value, { scheme, claimId }] of identities) {
      this.put("INSERT OR IGNORE INTO identifiers VALUES (?,?,?,?)", edition, scheme, value, claimId);
    }
    for (const field of new Set(claims.filter(c => c.field.startsWith("creator:")).map(c => c.field))) {
      const role = field.slice(8);
      const group = claims.filter(c => c.field === field).filter((c, i, list) => list.findIndex(x => creatorKey(x.value) === creatorKey(c.value)) === i);
      const old = this.rows<ClaimRow>(`SELECT c.id,c.value,s.priority FROM contributions k
        JOIN claims c ON c.id=k.claim_id JOIN raw_records r ON r.id=c.raw_id JOIN sources s ON s.id=r.source
        WHERE k.edition_id=? AND k.role=? ORDER BY k.position`, edition, role);
      if (old.length && JSON.stringify(old.map(c => creatorKey(c.value))) !== JSON.stringify(group.map(c => creatorKey(c.value)))) {
        this.issue(raw, edition, "contributor-conflict", role);
      }
      if (!old.length || (!keepSelected && group[0]!.priority > old[0]!.priority)) {
        this.put("DELETE FROM contributions WHERE edition_id=? AND role=?", edition, role);
        group.forEach((c, i) => this.put("INSERT INTO contributions VALUES (?,?,?,?)", edition, role, i, c.id));
      }
    }
    const canonical = this.item(edition)!;
    const updatedAuthors = authorKey(canonical.creators);
    this.put("UPDATE editions SET author_key=? WHERE id=?", updatedAuthors, edition);
    this.put("DELETE FROM validation WHERE raw_id IS NULL AND edition_id=?", edition);
    for (const issue of checkItem(canonical)) this.issue(null, edition, `isnad:${issue.code}`, issue.message, null, issue.level);
  }

  item(id: number): Item | null {
    const edition = this.row<EditionRow>("SELECT * FROM editions WHERE id=?", id);
    if (!edition) return null;
    const fields = this.fields(id);
    const format = fields.format;
    for (const key of localFields) delete fields[key];
    delete fields.workTitle;
    if (format && ["Epub", "PDF", "Elektronik"].includes(format) && format !== "Elektronik") fields.extra = `Medium: ${format}`;
    const identifiers = this.rows<{scheme: string; value: string}>("SELECT scheme,value FROM identifiers WHERE edition_id=? ORDER BY value", id);
    for (const scheme of ["ISBN", "DOI"]) {
      const values = identifiers.filter(i => i.scheme === scheme).map(i => i.value);
      if (values.length) fields[scheme] = values.join("; ");
    }
    const creators = this.rows<{value: string}>(`SELECT c.value FROM contributions k JOIN claims c ON c.id=k.claim_id
      WHERE k.edition_id=? ORDER BY k.role!='author', k.role, k.position`, id).map(r => JSON.parse(r.value) as Creator);
    return { ...emptyItem("book", "catalog"), key: `DK${id}`, fields, creators, dateAdded: edition.created_at, dateModified: edition.created_at };
  }

  ids(after: number, limit: number) {
    return this.rows<{id: number; work_id: number}>(`SELECT id,work_id FROM editions WHERE id>? ORDER BY id LIMIT ?`, after, limit);
  }

  details(id: number) {
    const item = this.item(id);
    if (!item) return null;
    return {
      item, fields: this.fields(id),
      work: this.row("SELECT work_id FROM editions WHERE id=?", id),
      evidence: this.rows(`SELECT c.field,c.position,c.observed,c.value,c.path,c.authority,
        r.source,r.external_id,r.url,r.sha256,r.observed_at,
        EXISTS(SELECT 1 FROM edition_fields f WHERE f.claim_id=c.id AND f.edition_id=r.edition_id)
          OR EXISTS(SELECT 1 FROM contributions t WHERE t.claim_id=c.id AND t.edition_id=r.edition_id)
          OR EXISTS(SELECT 1 FROM identifiers i WHERE i.claim_id=c.id AND i.edition_id=r.edition_id) AS selected
        FROM claims c JOIN raw_records r ON r.id=c.raw_id WHERE r.edition_id=? ORDER BY c.field,r.id,c.position`, id),
      validation: this.rows(`SELECT code,level,detail,target_id FROM validation
        WHERE edition_id=? OR target_id=? OR raw_id IN(SELECT id FROM raw_records WHERE edition_id=?) ORDER BY id`, id, id, id),
      parts: this.parts(id),
    };
  }

  review(after: number, limit: number) {
    return this.rows(`SELECT v.id,v.code,v.level,v.detail,v.target_id,r.id AS raw_id,r.source,r.external_id,r.url,
      (SELECT c.value FROM claims c WHERE c.raw_id=r.id AND c.field='title' ORDER BY c.position LIMIT 1) AS title
      FROM validation v JOIN raw_records r ON r.id=v.raw_id WHERE r.state='review' AND v.id>? ORDER BY v.id LIMIT ?`, after, limit);
  }

  /**
   * Stores book parts (chapters) without creating editions. A part is linked
   * to an edition only when its container ISBNs point to exactly one edition.
   */
  addParts(source: SourceId, parts: readonly PartInput[]) {
    return this.transaction(() => {
      let linked = 0;
      for (const part of parts) {
        const isbns = [...new Set(part.containerIsbns.map(v => validIsbn(v)).filter((v): v is string => Boolean(v)))];
        const edition = this.linkPart(isbns);
        if (edition) linked++;
        this.put(`INSERT INTO parts(source,doi,title,creators,pages,container_title,container_isbns,edition_id,url,raw,sha256)
          VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,doi) DO UPDATE SET title=excluded.title,creators=excluded.creators,
          pages=excluded.pages,container_title=excluded.container_title,container_isbns=excluded.container_isbns,
          edition_id=excluded.edition_id,url=excluded.url,raw=excluded.raw,sha256=excluded.sha256`,
        source, part.doi.toLowerCase(), part.title, JSON.stringify(part.creators), part.pages || null, part.containerTitle || null,
        JSON.stringify(isbns), edition, part.url, part.raw, digest(part.raw));
      }
      return { parts: parts.length, linked };
    });
  }

  /** Links parts whose book edition arrived after them. */
  relinkParts() {
    return this.transaction(() => {
      let linked = 0;
      for (const part of this.rows<{ id: number; container_isbns: string }>("SELECT id,container_isbns FROM parts WHERE edition_id IS NULL")) {
        const edition = this.linkPart(JSON.parse(part.container_isbns) as string[]);
        if (edition) { this.put("UPDATE parts SET edition_id=? WHERE id=?", edition, part.id); linked++; }
      }
      return { linked };
    });
  }

  private linkPart(isbns: readonly string[]) {
    const editions = new Set<number>();
    for (const isbn of isbns) {
      for (const hit of this.rows<{ edition_id: number }>("SELECT edition_id FROM identifiers WHERE scheme='ISBN' AND value=?", isbn)) editions.add(hit.edition_id);
    }
    return editions.size === 1 ? [...editions][0]! : null;
  }

  parts(edition: number) {
    return this.rows<{ doi: string; title: string; creators: string; pages: string | null; source: string; url: string }>(
      "SELECT doi,title,creators,pages,source,url FROM parts WHERE edition_id=? ORDER BY CAST(pages AS INTEGER),pages,title", edition)
      .map(p => ({ ...p, creators: JSON.parse(p.creators) as unknown[] }));
  }

  stats() {
    const counts = this.row<{works: number; editions: number; raw: number; parts: number; linkedParts: number; authority: number}>(`SELECT
      (SELECT count(*) FROM works) AS works, (SELECT count(*) FROM editions) AS editions,
      (SELECT count(*) FROM raw_records) AS raw,
      (SELECT count(*) FROM parts) AS parts, (SELECT count(*) FROM parts WHERE edition_id IS NOT NULL) AS linkedParts,
      (SELECT count(*) FROM contributions k JOIN claims c ON k.claim_id=c.id WHERE c.authority IS NOT NULL) AS authority`)!;
    const missing = REQUIRED.map(field => ({ field, count: counts.editions - this.row<{n:number}>(
      "SELECT count(*) AS n FROM edition_fields WHERE field=?", field)!.n }));
    missing.push({ field: "ISBN", count: counts.editions - this.row<{n:number}>("SELECT count(DISTINCT edition_id) AS n FROM identifiers WHERE scheme='ISBN'")!.n });
    return {
      counts,
      sources: this.rows(`SELECT s.id,s.name,s.license,s.policy,count(r.id) AS raw,count(DISTINCT r.edition_id) AS editions,
        count(*) FILTER(WHERE r.state='matched') AS matched,
        count(*) FILTER(WHERE r.state='review') AS review,
        count(*) FILTER(WHERE r.state='outside') AS outside
        FROM sources s LEFT JOIN raw_records r ON r.source=s.id GROUP BY s.id ORDER BY s.priority DESC`),
      missing: missing.map(r => ({ ...r, rate: counts.editions ? r.count / counts.editions : null })),
      validation: this.rows("SELECT code,level,count(*) AS count FROM validation GROUP BY code,level ORDER BY count DESC,code"),
      jobs: this.rows("SELECT source,label,cursor,state,updated_at FROM jobs ORDER BY updated_at DESC,source LIMIT 100"),
    };
  }
}

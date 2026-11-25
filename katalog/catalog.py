#!/usr/bin/env python3
"""Derkenar makale kataloğu: DergiPark, TR Dizin ve İSAM'dan İSNAD 2 künyeli katalog.

Kullanım (katalog/ klasöründen ya da herhangi bir yerden):
    python3 catalog.py init                         # veritabanını oluştur / şemayı güncelle
    python3 catalog.py harvest dergipark --pages 20 # N sayfa aktar (kaldığı yerden)
    python3 catalog.py harvest trdizin   --pages 20
    python3 catalog.py harvest isam      --pages 20
    python3 catalog.py verify --limit 500           # DOI'leri kayıt ajansında doğrula
    python3 catalog.py historical-add dosya.txt     # tarihsel DergiPark bağlantılarını ekle
    python3 catalog.py export                       # UTF-8 CSV
    python3 catalog.py report                       # durum raporu
    python3 catalog.py run --group-pages 20 --groups 0  # sürekli toplu aktarım (0 = sınırsız)

Kurallar:
- Her makale DOI'den bağımsız bir katalog kimliği (DKR0000001) alır.
- Aynı normalleştirilmiş DOI'li kaynak kayıtları tek makalede birleşir (başlık tutarlıysa).
- DOI yoksa başlık + yazar + dergi/ISSN + yıl + sayfa karşılaştırılır; belirsizler denetime düşer.
- DOI durumu: "Doğrulandı" (makalenin kendi yayın kaydı = DergiPark, ya da kayıt ajansı),
  "Bulunamadı", "Doğrulama bekliyor". Künyede yalnız doğrulanmış DOI gösterilir.
- Her kaynak sayfası tek işlemde kaydedilir; durum (token/sayfa) aynı işlemde ilerler.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import difflib
import html
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DERKENAR_DB", os.path.join(HERE, "derkenar.sqlite3"))
RAW_DB_PATH = os.environ.get("DERKENAR_RAW_DB", os.path.join(HERE, "ham-sayfalar.sqlite3"))
CSV_PATH = os.environ.get("DERKENAR_CSV", os.path.join(HERE, "derkenar-uc-kaynak.csv"))
REPORT_DIR = os.path.join(HERE, "rapor")
TARGET = 1_000_000
UA = "bibliographic-harvester/0.1 (python-urllib)"

SOURCES = ("dergipark", "trdizin", "isam")
SOURCE_LABEL = {"dergipark": "DergiPark", "trdizin": "TR Dizin", "isam": "İSAM"}

# Kaynakların yayımladığı ya da ihtiyatla seçilen istekler arası en kısa süre (saniye).
#  - TR Dizin: Türkiye dışı IP için dakikada 60 istek (aşımda IP engeli) -> 1.25 sn (48/dk).
#  - Crossref: public havuz 5 istek/sn, eşzamanlılık 1 -> 0.34 sn (~3/sn; 0.25 sn'de 429 alındı).
#  - DergiPark ve İSAM sınır yayımlamıyor -> 1 sn.
MIN_INTERVAL = {
    "dergipark.org.tr": 1.0,
    "search.trdizin.gov.tr": 1.25,
    "makale.isam.org.tr": 1.0,
    "api.crossref.org": 0.34,
    "doi.org": 0.5,
}

DOI_OK, DOI_NONE, DOI_PENDING = "Doğrulandı", "Bulunamadı", "Doğrulama bekliyor"
TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
             "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

# TR Dizin yayın türlerinden makale sayılmayanlar (kaynak kaydı yine saklanır).
TRDIZIN_OUT_OF_SCOPE = {"CORRECTION", "EDITORIAL"}

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS article (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog_id TEXT UNIQUE,
    doi TEXT,                       -- seçilen (normalleştirilmiş) DOI
    doi_status TEXT NOT NULL DEFAULT 'Bulunamadı',
    doi_method TEXT,                -- doğrulama yolu
    doi_claimed TEXT,               -- kaynaklarda geçen bütün DOI'ler (JSON)
    title TEXT, title_lang TEXT,
    authors TEXT,                   -- JSON [[soyad, ad], ...] yayın sırasıyla
    journal TEXT, issn TEXT, eissn TEXT,
    pub_date TEXT, year INTEGER, month INTEGER,
    volume TEXT, issue TEXT, spage TEXT, epage TEXT, article_no TEXT,
    iz TEXT,
    isnad2 TEXT, isnad_ready INTEGER NOT NULL DEFAULT 0,
    missing TEXT,                   -- eksik alanlar (virgülle)
    conflicts TEXT,                 -- kaynak farkları (JSON)
    review TEXT,                    -- denetim işaretleri (virgülle)
    n_sources INTEGER NOT NULL DEFAULT 0,
    created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS article_doi ON article(doi);
CREATE INDEX IF NOT EXISTS article_status ON article(doi_status);

CREATE TABLE IF NOT EXISTS source_record (
    source TEXT NOT NULL, source_id TEXT NOT NULL,
    article_id INTEGER REFERENCES article(id),
    in_scope INTEGER NOT NULL DEFAULT 1, scope_note TEXT,
    url TEXT, doi TEXT, iz TEXT,
    title TEXT, titles TEXT, lang TEXT, authors TEXT,
    journal TEXT, journals TEXT, issn TEXT, eissn TEXT,
    pub_date TEXT, year INTEGER, month INTEGER,
    volume TEXT, issue TEXT, spage TEXT, epage TEXT, article_no TEXT,
    doc_type TEXT, extra TEXT,
    match_method TEXT, match_score REAL,
    partition TEXT, page_no INTEGER,
    fetched_at TEXT, updated_at TEXT,
    PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS sr_article ON source_record(article_id);
CREATE INDEX IF NOT EXISTS sr_doi ON source_record(doi);

-- Eşleştirme için bloklama anahtarları
CREATE TABLE IF NOT EXISTS match_key (
    kind TEXT NOT NULL, key TEXT NOT NULL, article_id INTEGER NOT NULL,
    PRIMARY KEY (kind, key, article_id)
);

CREATE TABLE IF NOT EXISTS match_review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT, source_id TEXT, article_id INTEGER, candidate_id INTEGER,
    score REAL, reason TEXT, status TEXT NOT NULL DEFAULT 'açık', created_at TEXT,
    UNIQUE (source, source_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS doi_check (
    doi TEXT PRIMARY KEY,
    status TEXT,                    -- var / yok / hata
    agency TEXT, http INTEGER, meta TEXT, checked_at TEXT
);

CREATE TABLE IF NOT EXISTS harvest_state (
    source TEXT NOT NULL, partition TEXT NOT NULL,
    next_token TEXT, next_page INTEGER NOT NULL DEFAULT 1,
    done INTEGER NOT NULL DEFAULT 0, total INTEGER,
    pages INTEGER NOT NULL DEFAULT 0, records INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (source, partition)
);

CREATE TABLE IF NOT EXISTS harvest_page (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT, partition TEXT, page_no INTEGER, request TEXT,
    n_records INTEGER, n_new_articles INTEGER, n_merged INTEGER,
    run_id TEXT, fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT, host TEXT, url TEXT, http INTEGER, error TEXT, at TEXT
);

-- Eski DergiPark kopyasından gelen ve DOI eşleştirmesi bekleyen tarihsel bağlantılar
CREATE TABLE IF NOT EXISTS historical_link (
    url TEXT PRIMARY KEY,
    dergipark_article TEXT,         -- /article/NNN kimliği
    status TEXT NOT NULL DEFAULT 'bekliyor',   -- bekliyor / eşleşti / tekrar / geçersiz
    article_id INTEGER, note TEXT, added_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS hl_art ON historical_link(dergipark_article);

CREATE TABLE IF NOT EXISTS run (
    run_id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT,
    articles_before INTEGER, articles_after INTEGER, note TEXT
);
"""


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=120, isolation_level=None)
    conn.execute("PRAGMA busy_timeout=120000")
    conn.executescript(SCHEMA)
    return conn


def raw_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(RAW_DB_PATH, timeout=120)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS raw_page (
        source TEXT, partition TEXT, page_no INTEGER, request TEXT,
        body BLOB, fetched_at TEXT, PRIMARY KEY (source, partition, page_no))""")
    return conn


# ---------------------------------------------------------------------------
# Normalleştirme
# ---------------------------------------------------------------------------
DOI_RE = re.compile(r"10\.\d{4,9}/\S+", re.I)


def norm_doi(s: str | None) -> str | None:
    if not s:
        return None
    s = html.unescape(str(s)).strip()
    s = urllib.parse.unquote(s)
    m = DOI_RE.search(s)
    if not m:
        return None
    d = m.group(0).rstrip(".,;)]}>\"'").lower()
    return d


def fold(s: str | None) -> str:
    """Türkçe duyarlı küçük harf + işaretsiz + yalnız harf/rakam."""
    if not s:
        return ""
    s = html.unescape(s).replace("İ", "i").replace("I", "ı").lower()
    s = s.replace("ı", "i")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^0-9a-z]+", "", s)


def fold_words(s: str | None) -> list[str]:
    if not s:
        return []
    return [w for w in (fold(x) for x in re.split(r"\s+", s)) if w]


JOURNAL_STOP = {"dergisi", "dergi", "journal", "of", "the", "and", "ve", "jurnal",
                "international", "uluslararasi", "turkish", "turk", "e", "online"}


def journal_key(s: str | None) -> str:
    w = [x for x in fold_words(re.sub(r"[-:/.,()]", " ", s or "")) if x not in JOURNAL_STOP]
    return "".join(w)


def norm_issn(s: str | None) -> str | None:
    if not s:
        return None
    m = re.search(r"(\d{4})-?(\d{3}[\dXx])", s)
    return f"{m.group(1)}-{m.group(2).upper()}" if m else None


def clean(s) -> str | None:
    if s is None:
        return None
    s = html.unescape(str(s))
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def parse_pages(s: str | None) -> tuple[str | None, str | None]:
    s = clean(s)
    if not s:
        return None, None
    m = re.match(r"^\D*?(\w+)\s*[-–—]\s*(\w+)", s)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^\D*?(\w+)", s)
    return (m.group(1), None) if m else (None, None)


def norm_page(p: str | None) -> str | None:
    if not p:
        return None
    p = p.strip().lstrip("0") or "0"
    return p.lower()


def split_name(full: str) -> tuple[str, str]:
    """'Ad Soyad' -> (soyad, ad). 'Soyad, Ad' -> (soyad, ad)."""
    full = clean(full) or ""
    if "," in full:
        fam, giv = full.split(",", 1)
        return clean(fam) or "", clean(giv) or ""
    parts = full.split(" ")
    if len(parts) == 1:
        return parts[0], ""
    return parts[-1], " ".join(parts[:-1])


def smart_case(s: str) -> str:
    """Tamamı büyük harf soyadını 'Yıldız' biçimine getirir (Türkçe i/ı)."""
    if not s or not s.isupper():
        return s
    out = []
    for w in re.split(r"(\s+|-)", s):
        if not w or w.isspace() or w == "-":
            out.append(w)
            continue
        first, rest = w[0], w[1:]
        rest = rest.replace("I", "ı").replace("İ", "i").lower()
        out.append(first + rest)
    return "".join(out)


def title_sim(a: str | None, b: str | None) -> float:
    fa, fb = fold(a), fold(b)
    if not fa or not fb:
        return 0.0
    if fa == fb:
        return 1.0
    return difflib.SequenceMatcher(None, fa, fb, autojunk=False).ratio()


def best_title_sim(ta: list[str], tb: list[str]) -> float:
    best = 0.0
    for a in ta:
        for b in tb:
            best = max(best, title_sim(a, b))
            if best == 1.0:
                return best
    return best


# ---------------------------------------------------------------------------
# HTTP (hızlandırma sınırı, yeniden deneme, erişim günlüğü)
# ---------------------------------------------------------------------------
_last_call: dict[str, float] = {}
RUN_ID = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S") + f"-{os.getpid()}"


class AccessError(Exception):
    def __init__(self, url, http, msg):
        super().__init__(f"{http} {msg} {url}")
        self.url, self.http, self.msg = url, http, msg


def log_access(conn, url, http_code, err):
    host = urllib.parse.urlparse(url).hostname
    conn.execute("INSERT INTO access_log(run_id,host,url,http,error,at) VALUES (?,?,?,?,?,?)",
                 (RUN_ID, host, url[:500], http_code, (err or "")[:500], now()))


def http_get(conn, url: str, accept: str | None = None, tries: int = 5,
             ok_404: bool = False) -> tuple[int, bytes]:
    host = urllib.parse.urlparse(url).hostname or ""
    gap = MIN_INTERVAL.get(host, 1.0)
    delay = 5.0
    for attempt in range(1, tries + 1):
        wait = _last_call.get(host, 0) + gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call[host] = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Accept": accept} if accept else {})})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            body = e.read()[:300]
            if e.code == 404 and ok_404:
                return 404, body
            retry_after = e.headers.get("Retry-After") if e.headers else None
            log_access(conn, url, e.code, f"deneme {attempt}: {body[:120]!r}")
            if e.code in (429, 500, 502, 503, 504) and attempt < tries:
                time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else delay)
                delay = min(delay * 2, 300)
                continue
            raise AccessError(url, e.code, body[:120])
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            log_access(conn, url, None, f"deneme {attempt}: {e}")
            if attempt < tries:
                time.sleep(delay)
                delay = min(delay * 2, 300)
                continue
            raise AccessError(url, None, str(e))
    raise AccessError(url, None, "deneme sınırı")


# ---------------------------------------------------------------------------
# Kaynak ayrıştırıcıları -> ortak kayıt sözlüğü
# ---------------------------------------------------------------------------
def blank_rec(source, sid):
    return dict(source=source, source_id=str(sid), in_scope=1, scope_note=None, url=None,
                doi=None, iz=None, title=None, titles=[], lang=None, authors=[],
                journal=None, journals=[], issn=None, eissn=None, pub_date=None,
                year=None, month=None, volume=None, issue=None, spage=None, epage=None,
                article_no=None, doc_type=None, extra={})


def year_of(s) -> int | None:
    """Dört haneli yıl; Rumi/Hicri yıllar (ör. 1335) da kaynaktaki gibi korunur."""
    m = re.search(r"(?<!\d)(1[2-9]\d\d|20\d\d)(?!\d)", str(s or ""))
    return int(m.group(1)) if m else None


PLACEHOLDER_NAMES = {"admin", "editor", "editör", "yonetici", "mulkiye", "anonim", "anonymous"}


def drop_placeholder_authors(authors: list) -> tuple[list, bool]:
    out, dropped = [], False
    for fam, giv in authors:
        f, g = fold(fam), fold(giv)
        if f in PLACEHOLDER_NAMES or (f and f == g):   # "Admin Admin", "Mulkiye Mulkiye"
            dropped = True
            continue
        out.append([fam, giv])
    return out, dropped


NS_OAI = "{http://www.openarchives.org/OAI/2.0/}"
NS_MODS = "{http://www.loc.gov/mods/v3}"
NS_DIM = "{http://www.dspace.org/xmlns/dspace/dim}"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


def oai_check_error(root):
    err = root.find(f"{NS_OAI}error")
    if err is not None:
        return err.get("code"), (err.text or "").strip()
    return None


def oai_token(root):
    tok = root.find(f".//{NS_OAI}resumptionToken")
    if tok is None:
        return None, None
    return (tok.text or "").strip() or None, tok.get("completeListSize")


_XML_ILLEGAL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff\ud800-\udfff]")


def xml_root(body: bytes):
    """XML'de geçersiz karakterleri (ör. U+FFFE) atarak ayrıştırır; kaynaklarda arada bir görülüyor."""
    try:
        return ET.fromstring(body)
    except ET.ParseError:
        text = body.decode("utf-8", errors="replace")
        return ET.fromstring(_XML_ILLEGAL.sub("", text).encode("utf-8"))


def parse_dergipark(body: bytes):
    root = xml_root(body)
    err = oai_check_error(root)
    if err:
        if err[0] == "noRecordsMatch":
            return [], None, None
        raise ValueError(f"OAI hata {err}")
    recs = []
    for r in root.iter(f"{NS_OAI}record"):
        h = r.find(f"{NS_OAI}header")
        ident = h.findtext(f"{NS_OAI}identifier") or ""
        sid = ident.rsplit("/", 1)[-1]
        rec = blank_rec("dergipark", sid)
        if h.get("status") == "deleted":
            rec["in_scope"], rec["scope_note"] = 0, "silinmiş kayıt"
            recs.append(rec)
            continue
        m = r.find(f".//{NS_MODS}mods")
        if m is None:
            continue
        lang = (m.findtext(f"{NS_MODS}language/{NS_MODS}languageTerm") or "").strip().lower() or None
        rec["lang"] = lang
        titles = []
        for ti in m.findall(f"{NS_MODS}titleInfo"):
            t = clean(ti.findtext(f"{NS_MODS}title"))
            if t:
                titles.append((ti.get(XML_LANG) or "", t))
        rec["titles"] = [t for _, t in titles]
        orig = [t for l, t in titles if lang and l.lower().startswith(lang)]
        rec["title"] = orig[0] if orig else (titles[0][1] if titles else None)
        for n in m.findall(f"{NS_MODS}name"):
            role = (n.findtext(f"{NS_MODS}role/{NS_MODS}roleTerm") or "author").strip().lower()
            if role not in ("author", "aut"):
                continue
            fam = giv = ""
            for p in n.findall(f"{NS_MODS}namePart"):
                if p.get("type") == "family":
                    fam = clean(p.text) or ""
                elif p.get("type") == "given":
                    giv = clean(p.text) or ""
                elif not p.get("type"):
                    fam, giv = split_name(p.text or "")
            if fam or giv:
                rec["authors"].append([fam, giv])
        rec["authors"], ph = drop_placeholder_authors(rec["authors"])
        if ph:
            rec["extra"]["yer_tutucu_yazar"] = True
        di = m.findtext(f"{NS_MODS}originInfo/{NS_MODS}dateIssued")
        rec["pub_date"] = clean(di)
        rec["year"] = year_of(di)
        rec["extra"]["publisher"] = clean(m.findtext(f"{NS_MODS}originInfo/{NS_MODS}publisher"))
        for idf in m.findall(f"{NS_MODS}identifier"):
            v = clean(idf.text) or ""
            if idf.get("type") == "doi":
                rec["doi"] = norm_doi(v)
            elif "izlik.org" in v:
                rec["iz"] = v
            elif "/article/" in v and not rec["url"]:
                rec["url"] = v
        rec["url"] = clean(m.findtext(f"{NS_MODS}location/{NS_MODS}url")) or rec["url"]
        host = m.find(f"{NS_MODS}relatedItem[@type='host']")
        if host is not None:
            rec["journal"] = clean(host.findtext(f"{NS_MODS}titleInfo/{NS_MODS}title"))
            rec["journals"] = [rec["journal"]] if rec["journal"] else []
            for idf in host.findall(f"{NS_MODS}identifier"):
                t = (idf.get("type") or "").lower()
                if t in ("issn", "eissn", "e-issn"):
                    v = norm_issn(idf.text)
                    if t == "issn":
                        rec["issn"] = v
                    else:
                        rec["eissn"] = v
            part = host.find(f"{NS_MODS}part")
            if part is not None:
                for d in part.findall(f"{NS_MODS}detail"):
                    num = clean(d.findtext(f"{NS_MODS}number"))
                    if d.get("type") == "volume":
                        rec["volume"] = num
                    elif d.get("type") == "issue":
                        rec["issue"] = num
                    elif d.get("type") in ("article", "articlenumber", "article-number"):
                        rec["article_no"] = num
                ext = part.find(f"{NS_MODS}extent")
                if ext is not None:
                    rec["spage"] = clean(ext.findtext(f"{NS_MODS}start"))
                    rec["epage"] = clean(ext.findtext(f"{NS_MODS}end"))
        rec["doc_type"] = clean(m.findtext(f"{NS_MODS}genre")) or "article"
        recs.append(rec)
    tok, size = oai_token(root)
    return recs, tok, size


def parse_isam(body: bytes):
    root = xml_root(body)
    err = oai_check_error(root)
    if err:
        if err[0] == "noRecordsMatch":
            return [], None, None
        raise ValueError(f"OAI hata {err}")
    recs = []
    for r in root.iter(f"{NS_OAI}record"):
        h = r.find(f"{NS_OAI}header")
        ident = h.findtext(f"{NS_OAI}identifier") or ""
        sid = ident.split(":", 2)[-1]          # 123456789/245895
        rec = blank_rec("isam", sid)
        if h.get("status") == "deleted":
            rec["in_scope"], rec["scope_note"] = 0, "silinmiş kayıt"
            recs.append(rec)
            continue
        f: dict[str, list[str]] = {}
        for fe in r.iter(f"{NS_DIM}field"):
            k = fe.get("element") + ("." + fe.get("qualifier") if fe.get("qualifier") else "")
            v = clean(fe.text)
            if v:
                f.setdefault(k, []).append(v)
        g = lambda k: (f.get(k) or [None])[0]
        rec["title"] = g("title")
        rec["titles"] = (f.get("title") or []) + (f.get("title.alternative") or [])
        rec["lang"] = g("language.iso")
        rec["authors"] = [list(split_name(a)) for a in f.get("contributor.author", [])]
        rec["pub_date"] = g("date.issued") or g("coverage.temporal")
        rec["year"] = year_of(rec["pub_date"])
        rec["journals"] = f.get("relation.journal", [])
        rec["journal"] = g("relation.journal")
        rec["volume"] = g("identifier.volume")
        rec["issue"] = g("identifier.issue")
        rec["spage"], rec["epage"] = parse_pages(g("identifier.page"))
        rec["url"] = g("identifier.uri")
        for k in ("identifier.doi", "identifier.other"):
            for v in f.get(k, []):
                if norm_doi(v):
                    rec["doi"] = norm_doi(v)
        for k in ("identifier.issn", "identifier.eissn"):
            if g(k):
                rec["issn" if k.endswith(".issn") else "eissn"] = norm_issn(g(k))
        rec["doc_type"] = g("type")
        rec["extra"] = {"citation": g("identifier.citation"), "publisher": g("publisher"),
                        "ispartof": f.get("relation.ispartof"), "book": g("relation.book")}
        if not rec["journal"]:
            rec["in_scope"] = 0
            rec["scope_note"] = "dergi bilgisi yok" + (" (kitap içi bölüm)" if g("relation.book") else "")
        recs.append(rec)
    tok, size = oai_token(root)
    return recs, tok, size


def parse_trdizin(body: bytes):
    d = json.loads(body)
    hits = d.get("hits", {})
    total = (hits.get("total") or {}).get("value")
    recs = []
    for h in hits.get("hits", []):
        s = h.get("_source", {})
        rec = blank_rec("trdizin", s.get("id") or h.get("_id"))
        lang_map = {"TUR": "tr", "ENG": "en", "GER": "de", "FRE": "fr", "ARA": "ar",
                    "RUS": "ru", "ITA": "it", "SPA": "es", "KUR": "ku", "AZE": "az", "KAZ": "kk"}
        rec["lang"] = lang_map.get(s.get("language"), (s.get("language") or "").lower() or None)
        titles = [(a.get("language"), clean(a.get("title"))) for a in (s.get("abstracts") or [])]
        titles = [(l, t) for l, t in titles if t]
        rec["titles"] = [t for _, t in titles]
        orig = [t for l, t in titles if l == s.get("language")]
        rec["title"] = orig[0] if orig else (titles[0][1] if titles else clean(s.get("orderTitle")))
        auths = sorted([a for a in (s.get("authors") or []) if (a.get("duty") or "AUTHOR") == "AUTHOR"],
                       key=lambda a: a.get("order") or 0)
        for a in auths:
            fam, giv = split_name(a.get("inPublicationName") or a.get("name") or "")
            rec["authors"].append([smart_case(fam), " ".join(smart_case(w) if len(w) > 2 else w
                                                             for w in giv.split(" ")).strip()])
        j = s.get("journal") or {}
        rec["journal"] = clean(j.get("name"))
        rec["journals"] = [rec["journal"]] if rec["journal"] else []
        rec["issn"] = norm_issn(j.get("issn"))
        rec["eissn"] = norm_issn(j.get("eissn"))
        iss = s.get("issue") or {}
        rec["volume"] = clean(iss.get("volume"))
        rec["issue"] = clean(iss.get("number"))
        rec["year"] = year_of(iss.get("year")) or year_of(s.get("publicationYear"))
        months = iss.get("month") or []
        try:
            mo = int(months[0]) if months else None
            rec["month"] = mo if mo and 1 <= mo <= 12 else None
        except (ValueError, TypeError):
            pass
        rec["pub_date"] = clean(iss.get("publishDate")) or (str(rec["year"]) if rec["year"] else None)
        rec["spage"] = clean(s.get("startPage"))
        rec["epage"] = clean(s.get("endPage"))
        rec["doi"] = norm_doi(s.get("doi"))
        rec["url"] = f"https://search.trdizin.gov.tr/tr/yayin/detay/{rec['source_id']}"
        rec["doc_type"] = f"{s.get('docType')}/{s.get('publicationType')}"
        rec["extra"] = {"journal_id": j.get("id"), "issue_id": iss.get("id"),
                        "special": iss.get("isSpecial"), "retracted": s.get("retreat")}
        if s.get("docType") != "PAPER" or s.get("publicationType") in TRDIZIN_OUT_OF_SCOPE:
            rec["in_scope"], rec["scope_note"] = 0, f"yayın türü {rec['doc_type']}"
        recs.append(rec)
    return recs, total


# ---------------------------------------------------------------------------
# Eşleştirme ve birleştirme
# ---------------------------------------------------------------------------
def rec_title_keys(titles: list[str]) -> set[str]:
    return {fold(t)[:24] for t in titles if len(fold(t)) >= 8}


def add_keys(conn, aid: int, rec: dict):
    rows = []
    for k in rec_title_keys(rec["titles"] or ([rec["title"]] if rec["title"] else [])):
        rows.append(("t", k, aid))
    sp = norm_page(rec["spage"])
    if rec["year"] and sp:
        for v in {rec["issn"], rec["eissn"]} - {None}:
            rows.append(("isp", f"{v}|{rec['year']}|{sp}", aid))
        for j in rec["journals"] or []:
            jk = journal_key(j)
            if jk:
                rows.append(("jsp", f"{jk[:30]}|{rec['year']}|{sp}", aid))
    if rec["doi"]:
        rows.append(("doi", rec["doi"], aid))
    conn.executemany("INSERT OR IGNORE INTO match_key(kind,key,article_id) VALUES (?,?,?)", rows)


def load_article_view(conn, aid: int) -> dict:
    """Makaleye bağlı bütün kaynak kayıtlarından karşılaştırma görünümü."""
    rows = conn.execute("SELECT titles,title,authors,journals,issn,eissn,year,spage,doi,volume,issue,epage,source "
                        "FROM source_record WHERE article_id=?", (aid,)).fetchall()
    v = dict(titles=set(), surnames=set(), journals=set(), issns=set(), years=set(), spages=set(), dois=set(),
             volumes=set(), issues=set(), epages=set(), sources=set())
    for titles, title, authors, journals, issn, eissn, year, spage, doi, volume, issue, epage, src in rows:
        v["sources"].add(src)
        if volume:
            v["volumes"].add(norm_num(volume))
        if issue:
            v["issues"].add(norm_num(issue))
        if epage:
            v["epages"].add(norm_page(epage))
        for t in json.loads(titles or "[]") + ([title] if title else []):
            v["titles"].add(t)
        a = json.loads(authors or "[]")
        if a:
            v["surnames"].add(fold(a[0][0]))
        for j in json.loads(journals or "[]"):
            v["journals"].add(journal_key(j))
        v["issns"].update(x for x in (issn, eissn) if x)
        if year:
            v["years"].add(year)
        if spage:
            v["spages"].add(norm_page(spage))
        if doi:
            v["dois"].add(doi)
    meta = conn.execute("SELECT doi,doi_status FROM article WHERE id=?", (aid,)).fetchone()
    v["verified_doi"] = meta[0] if meta and meta[1] == DOI_OK else None
    return v


def norm_num(x) -> str:
    return re.sub(r"\s+", "", str(x)).lstrip("0").lower()


def score_candidate(rec: dict, v: dict) -> tuple[float, dict]:
    titles = rec["titles"] or ([rec["title"]] if rec["title"] else [])
    t = best_title_sim(titles, list(v["titles"]))
    y = rec["year"]
    dy = min((abs(y - x) for x in v["years"]), default=None) if y else None
    author = bool(rec["authors"]) and fold(rec["authors"][0][0]) in v["surnames"]
    issn_hit = bool({rec["issn"], rec["eissn"]} - {None} & v["issns"])
    jk = {journal_key(j) for j in rec["journals"] or []}
    j_hit = any(a and b and (a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.85)
                for a in jk for b in v["journals"])
    venue = issn_hit or j_hit
    pages = bool(rec["spage"]) and norm_page(rec["spage"]) in v["spages"]
    endp = bool(rec["epage"]) and norm_page(rec["epage"]) in v["epages"]
    # Çelişen kanıt: iki tarafta da bilinen ve farklı olan alanlar
    veto = []
    if rec["volume"] and v["volumes"] and norm_num(rec["volume"]) not in v["volumes"]:
        veto.append("cilt")
    if rec["issue"] and v["issues"] and norm_num(rec["issue"]) not in v["issues"]:
        veto.append("sayı")
    if rec["spage"] and v["spages"] and not pages:
        veto.append("sayfa")
    if rec["authors"] and v["surnames"] and not author:
        veto.append("yazar")
    if rec["authors"] and not v["surnames"] or v["surnames"] and not rec["authors"]:
        veto.append("yazar-bir-tarafta-yok")
    same_source = rec["source"] in v["sources"]
    return t, dict(title=round(t, 3), dy=dy, author=author, venue=venue, pages=pages, endp=endp,
                   veto=veto, same_source=same_source)


def decide(t: float, f: dict) -> str:
    """'merge', 'review' veya 'new'. Çelişen alan varsa otomatik birleştirme yapılmaz."""
    dy = f["dy"]
    support = sum([f["author"], f["venue"], f["pages"]])
    hard_veto = [x for x in f["veto"] if x != "yazar-bir-tarafta-yok"]
    if f["same_source"]:
        # Aynı kaynakta farklı kimlikli iki kayıt: yalnız her şey tutuyorsa gerçek tekrar sayılır
        if t >= 0.97 and dy == 0 and f["author"] and f["venue"] and f["pages"] and not f["veto"]:
            return "merge"
        return "review" if t >= 0.90 and not hard_veto else "new"
    if hard_veto:
        return "review" if t >= 0.95 and support >= 2 and len(hard_veto) == 1 else "new"
    if dy is not None and dy > 1:
        return "review" if t >= 0.95 and support >= 2 else "new"
    if t >= 0.97 and support >= 2:
        return "merge"
    if t >= 0.97 and support >= 1 and dy is not None and dy <= 1 and not f["veto"]:
        return "merge"
    if t >= 0.90 and dy == 0 and support >= 2:
        return "merge"
    # Farklı dilde başlık: aynı dergi + yıl + ilk ve son sayfa + ilk yazar
    if dy == 0 and f["venue"] and f["pages"] and f["endp"] and f["author"]:
        return "merge" if t >= 0.30 else "review"
    if t >= 0.80 and support >= 1:
        return "review"
    return "new"


def find_match(conn, rec: dict) -> tuple[int | None, str, float, list]:
    """(article_id | None, yöntem, skor, belirsiz adaylar)."""
    # 1) DOI
    if rec["doi"]:
        ids = [r[0] for r in conn.execute("SELECT article_id FROM match_key WHERE kind='doi' AND key=?",
                                          (rec["doi"],))]
        for aid in ids:
            v = load_article_view(conn, aid)
            t, f = score_candidate(rec, v)
            # Aynı DOI ama bambaşka başlık -> birleştirme, denetime gönder
            if t >= 0.5 or (f["dy"] == 0 and (f["author"] or f["pages"])):
                return aid, "doi", t, []
            return None, "doi-baslik-uyusmazligi", t, [(aid, t, f)]
    # 2) Bloklama anahtarlarıyla adaylar
    cand: set[int] = set()
    titles = rec["titles"] or ([rec["title"]] if rec["title"] else [])
    for k in rec_title_keys(titles):
        cand.update(r[0] for r in conn.execute("SELECT article_id FROM match_key WHERE kind='t' AND key=?", (k,)))
    sp = norm_page(rec["spage"])
    if rec["year"] and sp:
        for yy in (rec["year"] - 1, rec["year"], rec["year"] + 1):
            for v in {rec["issn"], rec["eissn"]} - {None}:
                cand.update(r[0] for r in conn.execute(
                    "SELECT article_id FROM match_key WHERE kind='isp' AND key=?", (f"{v}|{yy}|{sp}",)))
            for j in rec["journals"] or []:
                jk = journal_key(j)
                if jk:
                    cand.update(r[0] for r in conn.execute(
                        "SELECT article_id FROM match_key WHERE kind='jsp' AND key=?", (f"{jk[:30]}|{yy}|{sp}",)))
    best = None
    reviews = []
    for aid in list(cand)[:200]:
        v = load_article_view(conn, aid)
        # Farklı doğrulanmış DOI'ler -> asla birleştirme
        if rec["doi"] and v["dois"] and rec["doi"] not in v["dois"]:
            continue
        t, f = score_candidate(rec, v)
        d = decide(t, f)
        if d == "merge" and (best is None or t > best[1]):
            best = (aid, t, f)
        elif d == "review":
            reviews.append((aid, t, f))
    if best:
        return best[0], "kunye", best[1], [r for r in reviews if r[0] != best[0]]
    return None, "yeni", 0.0, reviews


# ---------------------------------------------------------------------------
# Makale kaydını kaynaklardan yeniden üretme + İSNAD 2 künyesi
# ---------------------------------------------------------------------------
PRIORITY = {"crossref": 0, "dergipark": 1, "trdizin": 2, "isam": 3}


QUOTE_PAIRS = [("“", "”"), ('"', '"'), ("‘", "’"), ("'", "'"), ("«", "»")]


def isnad_title(t: str) -> str:
    """Başlığı saran tırnakları kaldırır; iç çift tırnakları tek tırnağa çevirir (İSNAD)."""
    t = t.strip()
    changed = True
    while changed and len(t) > 2:
        changed = False
        for o, c in QUOTE_PAIRS:
            if t.startswith(o) and t.endswith(c) and t.count(o) + t.count(c) <= (2 if o != c else 2):
                t, changed = t[len(o):-len(c)].strip(), True
    t = t.replace("“", "‘").replace("”", "’")
    t = re.sub(r'"([^"]+)"', r"‘\1’", t)
    return t


def fmt_isnad2(a: dict) -> str:
    authors = a["authors"] or []
    parts = []
    def nm(x):
        fam, giv = x[0], x[1]
        return f"{fam}, {giv}" if giv else fam
    if len(authors) >= 3:
        head = nm(authors[0]) + " vd."
    elif authors:
        head = " – ".join(nm(x) for x in authors)
    else:
        head = ""
    if head:
        parts.append(head if head.endswith(".") else head + ".")
    title = isnad_title(a["title"] or "")
    title_s = f"“{title}”" + ("" if title[-1:] in "?!." else ".")
    parts.append(title_s)
    vi = ""
    if a["volume"] and a["issue"]:
        vi = f"{a['volume']}/{a['issue']}"
    elif a["volume"] or a["issue"]:
        vi = a["volume"] or a["issue"]
    date = ""
    if a["year"]:
        date = f"{TR_MONTHS[a['month'] - 1]} {a['year']}" if a.get("month") else str(a["year"])
    j = a["journal"] or ""
    seg = j
    if vi:
        seg += f" {vi}"
    if date:
        seg += f" ({date})"
    pages = ""
    if a["spage"] and a["epage"] and a["epage"] != a["spage"]:
        pages = f"{a['spage']}-{a['epage']}"
    elif a["spage"]:
        pages = a["spage"]
    elif a["article_no"]:
        pages = a["article_no"]
    if pages:
        seg += f", {pages}"
    parts.append(seg + ".")
    s = " ".join(p for p in parts if p)
    if a["doi_status"] == DOI_OK and a["doi"]:
        s += f" https://doi.org/{a['doi']}"
    return s


def crossref_view(meta: dict) -> dict:
    """doi_check.meta (Crossref) -> ortak alanlar."""
    r = blank_rec("crossref", meta.get("DOI", ""))
    r["title"] = clean((meta.get("title") or [None])[0])
    r["titles"] = [clean(t) for t in (meta.get("title") or []) + (meta.get("original-title") or []) if clean(t)]
    for au in meta.get("author") or []:
        if au.get("family") or au.get("given"):
            r["authors"].append([clean(au.get("family")) or "", clean(au.get("given")) or ""])
        elif au.get("name"):
            r["authors"].append([clean(au["name"]), ""])
    r["journal"] = clean((meta.get("container-title") or [None])[0])
    r["journals"] = [r["journal"]] if r["journal"] else []
    for it in meta.get("issn-type") or []:
        if it.get("type") == "print":
            r["issn"] = norm_issn(it.get("value"))
        elif it.get("type") == "electronic":
            r["eissn"] = norm_issn(it.get("value"))
    if not r["issn"] and not r["eissn"] and meta.get("ISSN"):
        r["issn"] = norm_issn(meta["ISSN"][0])
    r["volume"] = clean(meta.get("volume"))
    r["issue"] = clean(meta.get("issue"))
    r["spage"], r["epage"] = parse_pages(meta.get("page"))
    r["article_no"] = clean(meta.get("article-number"))
    ji = meta.get("journal-issue") or {}
    dp = None
    for k in ("published-print", "published-online"):
        dp = ((ji.get(k) or {}).get("date-parts") or [[None]])[0]
        if dp and dp[0]:
            break
    if not dp or not dp[0]:
        dp = ((meta.get("issued") or {}).get("date-parts") or [[None]])[0]
    if dp and dp[0]:
        r["year"] = int(dp[0])
        r["month"] = int(dp[1]) if len(dp) > 1 and dp[1] else None
        r["pub_date"] = "-".join(f"{x:02d}" if i else str(x) for i, x in enumerate(dp) if x)
    r["doi"] = norm_doi(meta.get("DOI"))
    return r


def rebuild_article(conn, aid: int):
    rows = conn.execute("SELECT * FROM source_record WHERE article_id=? AND in_scope=1", (aid,)).fetchall()
    cols = [c[0] for c in conn.execute("SELECT * FROM source_record LIMIT 0").description]
    recs = []
    for row in rows:
        d = dict(zip(cols, row))
        for k in ("titles", "authors", "journals", "extra"):
            d[k] = json.loads(d[k] or ("{}" if k == "extra" else "[]"))
        recs.append(d)
    if not recs:
        conn.execute("UPDATE article SET n_sources=0, updated_at=? WHERE id=?", (now(), aid))
        return
    claimed = sorted({r["doi"] for r in recs if r["doi"]})
    # DOI seçimi ve durumu
    chosen, status, method, review = None, DOI_NONE, "kaynaklarda DOI yok", []
    cr = None
    checks = {d: conn.execute("SELECT status,agency,meta FROM doi_check WHERE doi=?", (d,)).fetchone()
              for d in claimed}
    all_titles = [t for r in recs for t in (r["titles"] or [r["title"]]) if t]
    ok_agency = []
    for d in claimed:
        c = checks[d]
        if c and c[0] == "var":
            meta = json.loads(c[2] or "{}")
            cv = crossref_view(meta) if c[1] == "Crossref" and meta else None
            sim = best_title_sim(all_titles, cv["titles"]) if cv and cv["titles"] else None
            ok_agency.append((d, c[1], cv, sim))
    good = [x for x in ok_agency if x[3] is None or x[3] >= 0.5]
    if good:
        chosen, agency, cr, _ = good[0]
        status, method = DOI_OK, f"kayıt ajansı ({agency})"
        if any(r["source"] == "dergipark" and r["doi"] == chosen for r in recs):
            method += " + yayın kaydı (DergiPark)"
    elif ok_agency:
        chosen = ok_agency[0][0]
        status, method = DOI_PENDING, f"kayıt ajansında başlık uyuşmuyor ({ok_agency[0][1]})"
        review.append("doi-baslik-uyusmazligi")
    else:
        dp = [r["doi"] for r in recs if r["source"] == "dergipark" and r["doi"]]
        dp = [d for d in dp if not (checks.get(d) and checks[d][0] == "yok")]
        others = [d for d in claimed if not (checks.get(d) and checks[d][0] == "yok")]
        if dp:
            chosen, status, method = dp[0], DOI_OK, "yayın kaydı (DergiPark)"
        elif others:
            chosen, status, method = others[0], DOI_PENDING, "kaynakta var, ajansta denetlenmedi"
        elif claimed:
            status, method = DOI_NONE, "kaynaktaki DOI kayıt ajansında yok"
            review.append("doi-ajansta-yok")
    if len(set(claimed)) > 1:
        review.append("birden-fazla-doi")

    ordered = sorted(recs, key=lambda r: PRIORITY[r["source"]])
    if cr:
        ordered = [cr] + ordered

    def pick(field, srcs=None):
        for r in ordered:
            if srcs and r["source"] not in srcs:
                continue
            if r.get(field):
                return r[field], r["source"]
        return None, None

    a = {"doi": chosen, "doi_status": status}
    # Özgün başlık: DergiPark (dil eşleşmeli) > Crossref > TR Dizin > İSAM
    a["title"], tsrc = pick("title", ["dergipark"]) if any(r["source"] == "dergipark" for r in recs) else pick("title")
    if not a["title"]:
        a["title"], tsrc = pick("title")
    a["title_lang"] = next((r["lang"] for r in ordered if r["source"] == tsrc and r.get("lang")), None)
    # Yazarlar: en çok yazar sayısını veren yüksek öncelikli kaynak (TR Dizin büyük harfli adları düzeltilmiş)
    auths = [(r["source"], r["authors"]) for r in ordered if r.get("authors")]
    a["authors"] = auths[0][1] if auths else []
    # Dergi: TR Dizin büyük harf yazar; diğerleri önde
    jr = [(r["source"], r["journal"]) for r in ordered if r.get("journal")]
    jr_nice = [x for x in jr if not x[1].isupper()]
    a["journal"] = (jr_nice or jr or [(None, None)])[0][1]
    a["issn"], _ = pick("issn")
    a["eissn"], _ = pick("eissn")
    # Tarih: Crossref > TR Dizin (sayı yılı/ayı) > İSAM > DergiPark (dateIssued güvenilmez olabilir)
    date_order = sorted(ordered, key=lambda r: {"crossref": 0, "trdizin": 1, "isam": 2, "dergipark": 3}[r["source"]])
    a["year"] = next((r["year"] for r in date_order if r.get("year")), None)
    a["month"] = next((r["month"] for r in date_order if r.get("year") == a["year"] and r.get("month")), None)
    a["pub_date"] = next((r["pub_date"] for r in date_order if r.get("pub_date") and r.get("year") == a["year"]), None)
    for k in ("volume", "issue", "spage", "epage", "article_no"):
        a[k], _ = pick(k)
    a["iz"], _ = pick("iz")

    # Eksik alanlar
    missing = []
    if not a["authors"]:
        missing.append("yazar")
    if not a["title"]:
        missing.append("başlık")
    if not a["journal"]:
        missing.append("dergi")
    if not a["year"]:
        missing.append("yıl")
    if not (a["volume"] or a["issue"]):
        missing.append("cilt/sayı")
    if not (a["spage"] or a["article_no"]):
        missing.append("sayfa/makale no")
    if not (a["issn"] or a["eissn"]):
        missing.append("ISSN")  # künye için gerekmez, kayıt için işaretlenir
    ready = int(not [m for m in missing if m != "ISSN"])

    # Kaynaklar arası farklar
    conflicts = {}
    allrecs = ordered

    def diff(field, normf=lambda x: x):
        vals = {}
        for r in allrecs:
            if r.get(field) not in (None, "", []):
                vals.setdefault(normf(r[field]), []).append(r["source"])
        if len(vals) > 1:
            conflicts[field] = {str(k): v for k, v in vals.items()}
    diff("year")
    diff("volume", lambda x: str(x).lstrip("0"))
    diff("issue", lambda x: str(x).lstrip("0"))
    diff("spage", norm_page)
    diff("epage", norm_page)
    diff("doi")
    diff("issn")
    if len({len(r["authors"]) for r in allrecs if r.get("authors")}) > 1:
        conflicts["yazar_sayısı"] = {r["source"]: len(r["authors"]) for r in allrecs if r.get("authors")}
    fam = {fold(r["authors"][0][0]) for r in allrecs if r.get("authors")}
    if len(fam) > 1:
        conflicts["ilk_yazar"] = {r["source"]: r["authors"][0][0] for r in allrecs if r.get("authors")}
    if "year" in conflicts:
        review.append("yil-farki")
    letters = re.sub(r"[^A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]", "", a["title"] or "")
    if len(letters) > 8 and letters.isupper():
        review.append("baslik-buyuk-harf")
    open_rev = conn.execute("SELECT COUNT(*) FROM match_review WHERE (article_id=? OR candidate_id=?) AND status='açık'",
                            (aid, aid)).fetchone()[0]
    if open_rev:
        review.append("olasi-tekrar")
    a["isnad2"] = fmt_isnad2(a) if ready else None
    conn.execute("""UPDATE article SET doi=?, doi_status=?, doi_method=?, doi_claimed=?, title=?, title_lang=?,
        authors=?, journal=?, issn=?, eissn=?, pub_date=?, year=?, month=?, volume=?, issue=?, spage=?, epage=?,
        article_no=?, iz=?, isnad2=?, isnad_ready=?, missing=?, conflicts=?, review=?, n_sources=?, updated_at=?
        WHERE id=?""",
                 (chosen, status, method, json.dumps(claimed), a["title"], a["title_lang"],
                  json.dumps(a["authors"], ensure_ascii=False), a["journal"], a["issn"], a["eissn"],
                  a["pub_date"], a["year"], a["month"], a["volume"], a["issue"], a["spage"], a["epage"],
                  a["article_no"], a["iz"], a["isnad2"], ready, ",".join(missing),
                  json.dumps(conflicts, ensure_ascii=False) if conflicts else None,
                  ",".join(sorted(set(review))) or None, len({r["source"] for r in recs}), now(), aid))


def new_article(conn) -> int:
    cur = conn.execute("INSERT INTO article(created_at, updated_at) VALUES (?,?)", (now(), now()))
    aid = cur.lastrowid
    conn.execute("UPDATE article SET catalog_id=? WHERE id=?", (f"DKR{aid:07d}", aid))
    return aid


def store_record(conn, rec: dict, partition: str, page_no: int) -> str:
    """Kaynak kaydını yaz, eşleştir, makaleyi güncelle. Döner: 'yeni' | 'birleşti' | 'güncellendi' | 'kapsam-dışı'."""
    old = conn.execute("SELECT article_id FROM source_record WHERE source=? AND source_id=?",
                       (rec["source"], rec["source_id"])).fetchone()
    vals = dict(rec)
    for k in ("titles", "authors", "journals", "extra"):
        vals[k] = json.dumps(rec[k], ensure_ascii=False)
    cols = ["source", "source_id", "in_scope", "scope_note", "url", "doi", "iz", "title", "titles", "lang",
            "authors", "journal", "journals", "issn", "eissn", "pub_date", "year", "month", "volume", "issue",
            "spage", "epage", "article_no", "doc_type", "extra"]
    if old:
        conn.execute(f"UPDATE source_record SET {', '.join(c + '=?' for c in cols[2:])}, updated_at=? "
                     "WHERE source=? AND source_id=?",
                     [vals[c] for c in cols[2:]] + [now(), rec["source"], rec["source_id"]])
        aid = old[0]
        if aid:
            add_keys(conn, aid, rec)
            rebuild_article(conn, aid)
            return "güncellendi"
    else:
        conn.execute(f"INSERT INTO source_record({', '.join(cols)}, partition, page_no, fetched_at, updated_at) "
                     f"VALUES ({', '.join('?' * len(cols))},?,?,?,?)",
                     [vals[c] for c in cols] + [partition, page_no, now(), now()])
    if not rec["in_scope"]:
        return "kapsam-dışı"
    aid, method, score, reviews = find_match(conn, rec)
    result = "birleşti"
    if aid is None:
        aid = new_article(conn)
        result = "yeni"
    conn.execute("UPDATE source_record SET article_id=?, match_method=?, match_score=? WHERE source=? AND source_id=?",
                 (aid, method, round(score, 3), rec["source"], rec["source_id"]))
    for cand, t, f in reviews:
        if cand == aid:
            continue
        conn.execute("INSERT OR IGNORE INTO match_review(source,source_id,article_id,candidate_id,score,reason,created_at) "
                     "VALUES (?,?,?,?,?,?,?)", (rec["source"], rec["source_id"], aid, cand, round(t, 3),
                                                json.dumps(f, ensure_ascii=False), now()))
        rebuild_article(conn, cand)
    add_keys(conn, aid, rec)
    rebuild_article(conn, aid)
    if rec["source"] == "dergipark":
        conn.execute("UPDATE historical_link SET status='eşleşti', article_id=?, updated_at=? "
                     "WHERE dergipark_article=? AND status='bekliyor'", (aid, now(), rec["source_id"]))
    return result


# ---------------------------------------------------------------------------
# Aktarım (sayfa sayfa, kaldığı yerden)
# ---------------------------------------------------------------------------
DP_BASE = "https://dergipark.org.tr/api/public/oai/"
ISAM_BASE = "https://makale.isam.org.tr/server/oai/request"
TRD_BASE = "https://search.trdizin.gov.tr/api/defaultSearch/publication/"


def get_state(conn, source, partition):
    row = conn.execute("SELECT next_token,next_page,done,total,pages,records FROM harvest_state "
                       "WHERE source=? AND partition=?", (source, partition)).fetchone()
    if not row:
        conn.execute("INSERT INTO harvest_state(source,partition,updated_at) VALUES (?,?,?)",
                     (source, partition, now()))
        return dict(next_token=None, next_page=1, done=0, total=None, pages=0, records=0)
    return dict(zip(["next_token", "next_page", "done", "total", "pages", "records"], row))


def save_page(conn, raw, source, partition, page_no, url, body, recs, next_token, next_page, done, total):
    """Bir sayfayı tek işlemde kaydeder: kaynak kayıtları + eşleşme + ilerleme durumu."""
    counts = {"yeni": 0, "birleşti": 0, "güncellendi": 0, "kapsam-dışı": 0}
    conn.execute("BEGIN IMMEDIATE")
    try:
        for rec in recs:
            counts[store_record(conn, rec, partition, page_no)] += 1
        conn.execute("""UPDATE harvest_state SET next_token=?, next_page=?, done=?, total=COALESCE(?,total),
            pages=pages+1, records=records+?, updated_at=? WHERE source=? AND partition=?""",
                     (next_token, next_page, int(done), total, len(recs), now(), source, partition))
        conn.execute("INSERT INTO harvest_page(source,partition,page_no,request,n_records,n_new_articles,n_merged,"
                     "run_id,fetched_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (source, partition, page_no, url, len(recs), counts["yeni"], counts["birleşti"], RUN_ID, now()))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    raw.execute("INSERT OR REPLACE INTO raw_page VALUES (?,?,?,?,?,?)",
                (source, partition, page_no, url, zlib.compress(body, 6), now()))
    raw.commit()
    return counts


def harvest_oai(conn, raw, source, pages: int, log=print):
    base, prefix, parser = ((DP_BASE, "oai_mods", parse_dergipark) if source == "dergipark"
                            else (ISAM_BASE, "dim", parse_isam))
    part = "tum"
    totals = {"yeni": 0, "birleşti": 0, "güncellendi": 0, "kapsam-dışı": 0, "sayfa": 0}
    for _ in range(pages):
        st = get_state(conn, source, part)
        if st["done"]:
            log(f"{source}: liste tamamlandı")
            break
        if st["next_token"]:
            url = f"{base}?verb=ListRecords&resumptionToken={urllib.parse.quote(st['next_token'], safe='')}"
        else:
            url = f"{base}?verb=ListRecords&metadataPrefix={prefix}"
        try:
            _, body = http_get(conn, url)
            recs, tok, size = parser(body)
        except (AccessError, ET.ParseError, ValueError) as e:
            msg = str(e)
            if "badResumptionToken" in msg and st["next_token"]:
                # Süresi dolan token: baştan listele; kaynak kimliği tekil olduğundan tekrar oluşmaz.
                log(f"{source}: token geçersiz, liste baştan alınacak (kayıtlar tekrarlanmaz)")
                conn.execute("UPDATE harvest_state SET next_token=NULL WHERE source=? AND partition=?", (source, part))
                continue
            log_access(conn, url, getattr(e, "http", None), f"sayfa alınamadı: {msg[:200]}")
            log(f"{source}: ERİŞİM HATASI {msg[:200]}")
            if isinstance(e, AccessError):
                raise
            raise AccessError(url, None, f"yanıt ayrıştırılamadı: {msg[:150]}")
        page_no = st["pages"] + 1
        c = save_page(conn, raw, source, part, page_no, url, body, recs, tok, page_no + 1, tok is None,
                      int(size) if size and size.isdigit() else None)
        totals["sayfa"] += 1
        for k in c:
            totals[k] += c[k]
        log(f"{source} sayfa {page_no}: {len(recs)} kayıt, yeni {c['yeni']}, birleşen {c['birleşti']}, "
            f"güncellenen {c['güncellendi']}, kapsam dışı {c['kapsam-dışı']}")
        if tok is None:
            break
    return totals


def trdizin_years(conn):
    url = f"{TRD_BASE}?q=&order=publicationYear-DESC&page=1&limit=10&facet-documentType=PAPER"
    _, body = http_get(conn, url, accept="application/json")
    d = json.loads(body)
    aggs = d.get("aggregations", {})
    years = {}
    for k, v in aggs.items():
        if "year" in k.lower():
            buckets = v.get("buckets") or (v.get("values") or {}).get("buckets") or []
            for b in buckets:
                y = year_of(b.get("key"))
                if y:
                    years[y] = b.get("doc_count")
    return years, (d.get("hits", {}).get("total") or {}).get("value")


def harvest_trdizin(conn, raw, pages: int, log=print):
    totals = {"yeni": 0, "birleşti": 0, "güncellendi": 0, "kapsam-dışı": 0, "sayfa": 0}
    parts = [r[0] for r in conn.execute("SELECT partition FROM harvest_state WHERE source='trdizin'")]
    if not parts:
        years, total = trdizin_years(conn)
        if not years:
            # Yıl dağılımı alınamazsa makul aralık
            years = {y: None for y in range(dt.date.today().year + 1, 1899, -1)}
        conn.execute("BEGIN IMMEDIATE")
        for y in sorted(years, reverse=True):
            conn.execute("INSERT OR IGNORE INTO harvest_state(source,partition,total,updated_at) VALUES (?,?,?,?)",
                         ("trdizin", f"yil-{y}", years[y], now()))
        conn.execute("COMMIT")
        log(f"trdizin: {len(years)} yıl bölümü, toplam PAPER {total}")
    done_pages = 0
    while done_pages < pages:
        row = conn.execute("SELECT partition FROM harvest_state WHERE source='trdizin' AND done=0 "
                           "ORDER BY partition DESC LIMIT 1").fetchone()
        if not row:
            log("trdizin: bütün bölümler tamamlandı")
            break
        part = row[0]
        st = get_state(conn, "trdizin", part)
        y = part.split("-", 1)[1]
        p = st["next_page"]
        url = (f"{TRD_BASE}?q=&order=title-ASC&page={p}&limit=100&facet-documentType=PAPER"
               f"&facet-publication_year={y}")
        try:
            _, body = http_get(conn, url, accept="application/json")
            recs, total = parse_trdizin(body)
        except (AccessError, ValueError) as e:
            log(f"trdizin: ERİŞİM HATASI {str(e)[:200]}")
            raise
        done = (not recs) or (total is not None and p * 100 >= total)
        c = save_page(conn, raw, "trdizin", part, p, url, body, recs, None, p + 1, done, total)
        done_pages += 1
        totals["sayfa"] += 1
        for k in c:
            totals[k] += c[k]
        log(f"trdizin {part} sayfa {p}/{-(-(total or 0) // 100)}: {len(recs)} kayıt, yeni {c['yeni']}, "
            f"birleşen {c['birleşti']}, güncellenen {c['güncellendi']}, kapsam dışı {c['kapsam-dışı']}")
    return totals


# ---------------------------------------------------------------------------
# DOI doğrulama (Crossref; bulunamazsa doi.org Handle + RA)
# ---------------------------------------------------------------------------
def check_doi(conn, doi: str) -> tuple[str, str | None, int | None, dict | None]:
    url = "https://api.crossref.org/works/" + urllib.parse.quote(doi, safe="/:;()<>.-_")
    code, body = http_get(conn, url, accept="application/json", ok_404=True)
    if code == 200:
        meta = json.loads(body).get("message", {})
        keep = {k: meta.get(k) for k in ("DOI", "title", "original-title", "author", "container-title", "ISSN",
                                         "issn-type", "volume", "issue", "page", "article-number", "issued",
                                         "journal-issue", "type", "resource", "prefix", "member")}
        return "var", "Crossref", 200, keep
    # Crossref'te yok: Handle sisteminde var mı, hangi ajans?
    hurl = "https://doi.org/api/handles/" + urllib.parse.quote(doi, safe="/:;()<>.-_")
    hcode, hbody = http_get(conn, hurl, accept="application/json", ok_404=True)
    if hcode == 200:
        try:
            ra = json.loads(http_get(conn, "https://doi.org/ra/" + urllib.parse.quote(doi, safe="/"),
                                     accept="application/json")[1])
            agency = (ra[0] or {}).get("RA") if isinstance(ra, list) and ra else "Handle"
        except (AccessError, ValueError):
            agency = "Handle"
        return "var", agency or "Handle", 200, None
    return "yok", None, hcode, None


def verify(conn, limit: int, log=print):
    rows = conn.execute("""
        SELECT DISTINCT sr.doi FROM source_record sr
        LEFT JOIN doi_check dc ON dc.doi = sr.doi
        WHERE sr.doi IS NOT NULL AND sr.in_scope=1 AND (dc.doi IS NULL OR dc.status='hata')
        ORDER BY sr.rowid LIMIT ?""", (limit,)).fetchall()
    n = {"var": 0, "yok": 0, "hata": 0}
    for (doi,) in rows:
        try:
            status, agency, code, meta = check_doi(conn, doi)
        except AccessError as e:
            status, agency, code, meta = "hata", None, e.http, None
        n[status] += 1
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("INSERT OR REPLACE INTO doi_check(doi,status,agency,http,meta,checked_at) VALUES (?,?,?,?,?,?)",
                     (doi, status, agency, code, json.dumps(meta, ensure_ascii=False) if meta else None, now()))
        for (aid,) in conn.execute("SELECT DISTINCT article_id FROM source_record WHERE doi=? AND article_id IS NOT NULL",
                                   (doi,)).fetchall():
            rebuild_article(conn, aid)
        conn.execute("COMMIT")
    log(f"DOI doğrulama: {len(rows)} DOI denetlendi — ajansta var {n['var']}, yok {n['yok']}, hata {n['hata']}")
    return n


# ---------------------------------------------------------------------------
# Tarihsel bağlantılar
# ---------------------------------------------------------------------------
def historical_add(conn, path):
    added = dup = bad = 0
    conn.execute("BEGIN IMMEDIATE")
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            url = line.strip().split(",")[0].strip().strip('"')
            if not url:
                continue
            m = re.search(r"dergipark\.(?:org\.tr|gov\.tr|ulakbim\.gov\.tr)/.*?/article/(\d+)", url)
            if not m:
                conn.execute("INSERT OR IGNORE INTO historical_link(url,status,note,added_at,updated_at) "
                             "VALUES (?,?,?,?,?)", (url, "geçersiz", "makale kimliği çözülemedi", now(), now()))
                bad += 1
                continue
            art = m.group(1)
            exists = conn.execute("SELECT 1 FROM historical_link WHERE dergipark_article=?", (art,)).fetchone()
            cur = conn.execute("INSERT OR IGNORE INTO historical_link(url,dergipark_article,status,note,added_at,updated_at) "
                               "VALUES (?,?,?,?,?,?)", (url, art, "tekrar" if exists else "bekliyor",
                                                        "aynı makale kimliği daha önce eklendi" if exists else None,
                                                        now(), now()))
            if cur.rowcount:
                dup += bool(exists)
                added += not exists
    # Zaten aktarılmış DergiPark kayıtlarıyla eşleştir
    conn.execute("""UPDATE historical_link SET status='eşleşti', updated_at=?,
        article_id=(SELECT article_id FROM source_record s WHERE s.source='dergipark' AND s.source_id=historical_link.dergipark_article)
        WHERE status='bekliyor' AND EXISTS (SELECT 1 FROM source_record s WHERE s.source='dergipark'
              AND s.source_id=historical_link.dergipark_article AND s.article_id IS NOT NULL)""", (now(),))
    conn.execute("COMMIT")
    print(f"tarihsel bağlantı: yeni {added}, tekrar {dup}, geçersiz {bad}")


# ---------------------------------------------------------------------------
# Çıktı ve rapor
# ---------------------------------------------------------------------------
CSV_COLS = ["katalog_id", "doi", "doi_durumu", "doi_dogrulama_yolu", "yazarlar", "yazar_sayisi", "baslik",
            "baslik_dili", "dergi", "issn", "eissn", "yayin_tarihi", "yil", "ay", "cilt", "sayi", "ilk_sayfa",
            "son_sayfa", "makale_no", "iz", "isnad2_kunye", "kunye_hazir", "eksik_alanlar", "kaynak_farklari",
            "denetim", "kaynak_sayisi", "dergipark_id", "dergipark_url", "trdizin_id", "trdizin_url",
            "isam_id", "isam_url", "kaynakta_gecen_doiler"]


def export_csv(conn, path=CSV_PATH):
    tmp = f"{path}.{os.getpid()}.tmp"
    links: dict[int, dict] = {}
    for aid, src, sid, url in conn.execute(
            "SELECT article_id, source, source_id, url FROM source_record WHERE article_id IS NOT NULL AND in_scope=1 "
            "ORDER BY article_id, source, source_id"):
        d = links.setdefault(aid, {})
        d.setdefault(src, []).append((sid, url or ""))
    n = 0
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLS)
        for row in conn.execute("""SELECT id,catalog_id,doi,doi_status,doi_method,authors,title,title_lang,journal,issn,
                eissn,pub_date,year,month,volume,issue,spage,epage,article_no,iz,isnad2,isnad_ready,missing,conflicts,
                review,n_sources,doi_claimed FROM article WHERE n_sources>0 ORDER BY id"""):
            (aid, cid, doi, st, meth, authors, title, tl, journal, issn, eissn, pdate, year, month, vol, iss, sp, ep,
             ano, iz, isnad, ready, missing, conf, rev, ns, claimed) = row
            au = json.loads(authors or "[]")
            l = links.get(aid, {})
            j = lambda s, i: " | ".join(x[i] for x in l.get(s, []))
            w.writerow([cid, doi if st == DOI_OK else "", st, meth,
                        "; ".join(f"{a[0]}, {a[1]}" if a[1] else a[0] for a in au), len(au), title, tl, journal,
                        issn, eissn, pdate, year, month, vol, iss, sp, ep, ano, iz, isnad, "evet" if ready else "hayır",
                        missing, conf, rev, ns, j("dergipark", 0), j("dergipark", 1), j("trdizin", 0), j("trdizin", 1),
                        j("isam", 0), j("isam", 1), " | ".join(json.loads(claimed or "[]"))])
            n += 1
    os.replace(tmp, path)
    return n


def stats(conn) -> dict:
    q = lambda s, *a: conn.execute(s, a).fetchone()[0]
    s = {}
    s["toplam"] = q("SELECT COUNT(*) FROM article WHERE n_sources>0")
    s["doi"] = dict(conn.execute("SELECT doi_status, COUNT(*) FROM article WHERE n_sources>0 GROUP BY doi_status"))
    s["doi_yol"] = dict(conn.execute("SELECT doi_method, COUNT(*) FROM article WHERE n_sources>0 AND doi_status=? "
                                     "GROUP BY doi_method", (DOI_OK,)))
    s["hazir"] = q("SELECT COUNT(*) FROM article WHERE n_sources>0 AND isnad_ready=1")
    s["eksik"] = {}
    for (m,) in conn.execute("SELECT missing FROM article WHERE n_sources>0 AND missing<>''"):
        for x in m.split(","):
            s["eksik"][x] = s["eksik"].get(x, 0) + 1
    s["fark"] = q("SELECT COUNT(*) FROM article WHERE n_sources>0 AND conflicts IS NOT NULL")
    s["kaynak"] = {}
    for src in SOURCES:
        s["kaynak"][src] = dict(
            kayit=q("SELECT COUNT(*) FROM source_record WHERE source=?", src),
            kapsam=q("SELECT COUNT(*) FROM source_record WHERE source=? AND in_scope=1", src),
            makale=q("SELECT COUNT(DISTINCT article_id) FROM source_record WHERE source=? AND article_id IS NOT NULL", src),
            doi=q("SELECT COUNT(*) FROM source_record WHERE source=? AND in_scope=1 AND doi IS NOT NULL", src),
            sayfa=q("SELECT COALESCE(SUM(pages),0) FROM harvest_state WHERE source=?", src),
            liste=q("SELECT MAX(total) FROM harvest_state WHERE source=? AND partition='tum'", src)
            if src != "trdizin" else q("SELECT SUM(total) FROM harvest_state WHERE source='trdizin'"),
        )
    s["kaynak_sayisi"] = dict(conn.execute("SELECT n_sources, COUNT(*) FROM article WHERE n_sources>0 GROUP BY n_sources"))
    s["coklu_baglanti"] = q("SELECT COUNT(*) FROM (SELECT article_id FROM source_record WHERE article_id IS NOT NULL "
                            "GROUP BY article_id HAVING COUNT(*)>1)")
    s["eslesme_yontemi"] = dict(conn.execute("SELECT match_method, COUNT(*) FROM source_record WHERE article_id IS NOT NULL "
                                             "GROUP BY match_method"))
    s["denetim_acik"] = q("SELECT COUNT(*) FROM match_review WHERE status='açık'")
    s["doi_bekleyen_dogrulama"] = q("SELECT COUNT(DISTINCT sr.doi) FROM source_record sr LEFT JOIN doi_check dc "
                                    "ON dc.doi=sr.doi WHERE sr.doi IS NOT NULL AND sr.in_scope=1 AND dc.doi IS NULL")
    s["doi_check"] = dict(conn.execute("SELECT status, COUNT(*) FROM doi_check GROUP BY status"))
    s["tarihsel"] = dict(conn.execute("SELECT status, COUNT(*) FROM historical_link GROUP BY status"))
    return s


def report(conn, run_id=None, before=None, title="Durum raporu", group=None) -> str:
    s = stats(conn)
    L = [f"# {title}", "", f"Zaman: {now()}" + (f" · çalışma {run_id}" if run_id else ""), ""]
    if group:
        g = conn.execute("SELECT COUNT(*), COALESCE(SUM(n_records),0), COALESCE(SUM(n_new_articles),0), "
                         "COALESCE(SUM(n_merged),0) FROM harvest_page WHERE run_id=? AND id>?",
                         (run_id, group["page_id"])).fetchone()
        L += [f"- Grup: {', '.join(SOURCE_LABEL[x] for x in group['sources'])}, {g[0]:,} sayfa, {g[1]:,} kaynak kaydı",
              f"- Bu grubun açtığı yeni tekil makale: **{g[2]:,}** · var olan makaleye bağlanan kayıt: {g[3]:,}"]
    if before is not None:
        L.append(f"- Katalogdaki artış (paralel süreçler dahil): {s['toplam'] - before:,}")
    L += [f"- Toplam tekil makale: **{s['toplam']:,}** / hedef {TARGET:,} (%{100 * s['toplam'] / TARGET:.2f})",
          f"- Hazır İSNAD 2 künyesi: **{s['hazir']:,}** (eksik alanı olan: {s['toplam'] - s['hazir']:,})", "",
          "## DOI durumu", ""]
    for k in (DOI_OK, DOI_PENDING, DOI_NONE):
        L.append(f"- {k}: {s['doi'].get(k, 0):,}")
        if k == DOI_OK:
            for m, v in sorted(s["doi_yol"].items(), key=lambda x: -x[1]):
                L.append(f"  - {m}: {v:,}")
    L += [f"- Kayıt ajansında denetim bekleyen tekil DOI: {s['doi_bekleyen_dogrulama']:,}",
          f"- Ajans denetimi sonuçları: " + ", ".join(f"{k} {v:,}" for k, v in s["doi_check"].items()), "",
          "## Kaynağa göre kapsam", "",
          "| Kaynak | Aktarılan kayıt | Kapsamda | Bağlı makale | DOI'li kayıt | Sayfa | Kaynak listesi |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for src in SOURCES:
        k = s["kaynak"][src]
        L.append(f"| {SOURCE_LABEL[src]} | {k['kayit']:,} | {k['kapsam']:,} | {k['makale']:,} | {k['doi']:,} | "
                 f"{k['sayfa']:,} | {k['liste'] if k['liste'] else '—'} |")
    L += ["", "## Birleştirme ve bekleyen eşleşmeler", "",
          "- Kaynak sayısına göre makale: " + ", ".join(f"{k} kaynak: {v:,}" for k, v in sorted(s["kaynak_sayisi"].items())),
          f"- Birden fazla kaynak bağlantısı olan makale: {s['coklu_baglanti']:,}",
          "- Eşleşme yöntemi: " + ", ".join(f"{k}: {v:,}" for k, v in s["eslesme_yontemi"].items()),
          f"- Denetim bekleyen belirsiz eşleşme: {s['denetim_acik']:,}",
          f"- Kaynaklar arası farkı işaretli makale: {s['fark']:,}",
          "- Tarihsel bağlantılar: " + (", ".join(f"{k} {v:,}" for k, v in s["tarihsel"].items()) or "kayıt yok"),
          "- Eksik alanlar: " + (", ".join(f"{k} {v:,}" for k, v in sorted(s["eksik"].items(), key=lambda x: -x[1])) or "yok"),
          "", "## Erişim hataları", ""]
    where = "WHERE run_id=?" if run_id else ""
    errs = conn.execute(f"SELECT host, http, COUNT(*), MAX(error) FROM access_log {where} GROUP BY host, http",
                        (run_id,) if run_id else ()).fetchall()
    if errs:
        for host, code, n, e in errs:
            L.append(f"- {host} HTTP {code}: {n} kez (son: {(e or '')[:120]})")
    else:
        L.append("- Bu çalışmada erişim hatası yok.")
    return "\n".join(L) + "\n"


def write_report(text, name):
    os.makedirs(REPORT_DIR, exist_ok=True)
    p = os.path.join(REPORT_DIR, name)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(text)
    return p


# ---------------------------------------------------------------------------
# Komutlar
# ---------------------------------------------------------------------------
def count_articles(conn):
    return conn.execute("SELECT COUNT(*) FROM article WHERE n_sources>0").fetchone()[0]


def run_group(conn, raw, sources, group_pages, verify_limit, log=print, do_export=True):
    before = count_articles(conn)
    page_id = conn.execute("SELECT COALESCE(MAX(id),0) FROM harvest_page").fetchone()[0]
    conn.execute("INSERT OR IGNORE INTO run(run_id,started_at,articles_before) VALUES (?,?,?)", (RUN_ID, now(), before))
    blocked = {}
    for src in sources:
        try:
            if src == "trdizin":
                harvest_trdizin(conn, raw, group_pages, log)
            else:
                harvest_oai(conn, raw, src, group_pages, log)
        except AccessError as e:
            blocked[src] = str(e)[:200]
            kind = ("ENGELLENDİ" if e.http in (401, 403, 407, 451) else
                    "YANIT HATASI" if e.http is None and "ayrıştırılamadı" in str(e) else "ERİŞİLEMEDİ")
            log(f"{src} {kind}: {e} — diğer kaynaklarla devam ediliyor")
    if verify_limit:
        verify(conn, verify_limit, log)
    n = export_csv(conn) if do_export else None
    after = count_articles(conn)
    conn.execute("UPDATE run SET finished_at=?, articles_after=?, note=? WHERE run_id=?",
                 (now(), after, json.dumps(blocked, ensure_ascii=False) or None, RUN_ID))
    text = report(conn, RUN_ID, before, title="Aktarım grubu raporu",
                  group={"page_id": page_id, "sources": sources})
    if blocked:
        text += "\n## Durdurulan kaynaklar (engel ya da yanıt hatası)\n\n" + "\n".join(f"- {SOURCE_LABEL[k]}: {v}" for k, v in blocked.items()) + "\n"
    tag = "-".join(sources)
    p = write_report(text, f"aktarim-{tag}-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S')}.md")
    log(text)
    log((f"CSV: {CSV_PATH} ({n:,} satır) · " if n is not None else "") + f"rapor: {p}")
    return blocked


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    h = sub.add_parser("harvest")
    h.add_argument("source", choices=SOURCES)
    h.add_argument("--pages", type=int, default=1)
    v = sub.add_parser("verify")
    v.add_argument("--limit", type=int, default=200)
    hl = sub.add_parser("historical-add")
    hl.add_argument("path")
    sub.add_parser("export")
    sub.add_parser("report")
    r = sub.add_parser("run")
    r.add_argument("--sources", default="dergipark,trdizin,isam")
    r.add_argument("--group-pages", type=int, default=20)
    r.add_argument("--groups", type=int, default=1, help="0 = kaynaklar bitene kadar")
    r.add_argument("--verify", type=int, default=500, help="her grup sonunda denetlenecek DOI sayısı")
    r.add_argument("--no-export", action="store_true", help="CSV'yi bu süreç yazmasın (verify-loop yazar)")
    vl = sub.add_parser("verify-loop", help="DOI doğrulama + CSV + genel rapor döngüsü")
    vl.add_argument("--batch", type=int, default=2000)
    vl.add_argument("--export-every", type=int, default=600, help="saniye")
    a = ap.parse_args(argv)

    conn = connect()
    if a.cmd == "init":
        print(f"veritabanı: {DB_PATH}")
        print(report(conn, title="Başlangıç durumu"))
        return
    if a.cmd == "export":
        print(f"{export_csv(conn):,} satır -> {CSV_PATH}")
        return
    if a.cmd == "report":
        print(report(conn))
        return
    if a.cmd == "historical-add":
        historical_add(conn, a.path)
        return
    if a.cmd == "verify":
        verify(conn, a.limit)
        return
    if a.cmd == "verify-loop":
        last = 0.0
        while True:
            n = verify(conn, a.batch)
            if time.monotonic() - last >= a.export_every or not sum(n.values()):
                rows = export_csv(conn)
                text = report(conn, title="Genel durum raporu")
                write_report(text, "son-rapor.md")
                print(f"{now()} CSV {rows:,} satır; rapor yazıldı", flush=True)
                last = time.monotonic()
            busy = conn.execute("SELECT COUNT(*) FROM harvest_state WHERE done=0").fetchone()[0]
            if not sum(n.values()):
                if not busy:
                    break
                time.sleep(60)
    raw = raw_connect()
    if a.cmd == "harvest":
        if a.source == "trdizin":
            print(harvest_trdizin(conn, raw, a.pages))
        else:
            print(harvest_oai(conn, raw, a.source, a.pages))
        return
    if a.cmd == "run":
        sources = [s for s in a.sources.split(",") if s]
        g = 0
        while True:
            g += 1
            blocked = run_group(conn, raw, sources, a.group_pages, a.verify, do_export=not a.no_export)
            sources = [s for s in sources if s not in blocked]
            pending = [s for s in sources if conn.execute(
                "SELECT COUNT(*) FROM harvest_state WHERE source=? AND done=0", (s,)).fetchone()[0]
                or not conn.execute("SELECT COUNT(*) FROM harvest_state WHERE source=?", (s,)).fetchone()[0]]
            if not pending or (a.groups and g >= a.groups):
                break
            sources = pending


if __name__ == "__main__":
    main()

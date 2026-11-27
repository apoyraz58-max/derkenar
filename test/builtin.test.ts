import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type ArticleRec,
  articleItem,
  articleWords,
  rankArticles,
  builtinSource,
  decodePostings,
  diaItem,
  encodePostings,
  foldKey,
  intersect,
  postingsFor,
  searchDia,
} from "../src/core/builtin.js";
import { emptyState, planRefresh, putCitation } from "../src/core/docstate.js";
import { Renderer } from "../src/core/engine.js";
import { htmlToText } from "../src/core/html.js";
import { articleShards, diaFromRdf, printedTitle } from "../scripts/builtin.js";

const styles = new URL("../data/styles/", import.meta.url);
const locales = (l: string) => {
  try {
    return readFileSync(new URL(`locales-${l}.xml`, styles), "utf8");
  } catch {
    return undefined;
  }
};
function bib(item: ReturnType<typeof diaItem>): { note: string; bib: string } {
  const it = { ...item, key: "K1" };
  const st = emptyState();
  putCitation(st, "a", [{ id: "K1", locator: "490" }], { K1: it });
  const p = planRefresh(st, [{ id: "a", noteIndex: 1, text: "" }], new Renderer(readFileSync(new URL("isnad-dipnotlu.csl", styles), "utf8"), locales));
  return { note: htmlToText(p.updates.get("a")!), bib: htmlToText(p.bibliography!.entries[0]!.html) };
}

const RDF = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="#item_15108">
        <z:itemType>encyclopediaArticle</z:itemType>
        <dcterms:isPartOf><bib:Book><prism:volume>13</prism:volume><dc:title>Türkiye Diyanet Vakfı İslâm Ansiklopedisi</dc:title></bib:Book></dcterms:isPartOf>
        <dc:publisher><foaf:Organization><foaf:name>TDV Yayınları</foaf:name><vcard:adr><vcard:Address><vcard:locality>İstanbul</vcard:locality></vcard:Address></vcard:adr></foaf:Organization></dc:publisher>
        <bib:authors><rdf:Seq><rdf:li><foaf:Person><foaf:surname>Çağrıcı</foaf:surname><foaf:givenName>Mustafa</foaf:givenName></foaf:Person></rdf:li></rdf:Seq></bib:authors>
        <link:link rdf:resource="#item_1"/>
        <link:link rdf:resource="#item_2"/>
        <dcterms:isReferencedBy rdf:resource="#item_3"/>
        <dc:title>Gazzâlî</dc:title>
        <dcterms:abstract>(ö. 505/1111)
İslâm düşünürü.</dcterms:abstract>
        <dc:date>1996</dc:date>
        <bib:pages>489-505</bib:pages>
    </rdf:Description>
    <z:Attachment rdf:about="#item_1"><dc:title>Matbu nüsha (PDF)</dc:title><dc:identifier><dcterms:URI><rdf:value>https://cdn2.islamansiklopedisi.org.tr/dosya/13/C13015816.pdf</rdf:value></dcterms:URI></dc:identifier></z:Attachment>
    <z:Attachment rdf:about="#item_2"><dc:title>Tam metin (Web sayfası)</dc:title><dc:identifier><dcterms:URI><rdf:value>https://islamansiklopedisi.org.tr/gazzali#1</rdf:value></dcterms:URI></dc:identifier></z:Attachment>
    <bib:Memo rdf:about="#item_3"><rdf:value>&lt;p&gt;&lt;strong&gt;Ebû Hâmid el-Gazzâlî&lt;/strong&gt;&lt;/p&gt;&lt;p&gt;(bk. GAZZÂLÎ)&lt;/p&gt;</rdf:value></bib:Memo>
    <rdf:Description rdf:about="#item_2525">
        <z:itemType>encyclopediaArticle</z:itemType>
        <dcterms:isPartOf><bib:Book><prism:volume>25</prism:volume></bib:Book></dcterms:isPartOf>
        <dc:publisher><foaf:Organization><vcard:adr><vcard:Address><vcard:locality>Ankara</vcard:locality></vcard:Address></vcard:adr></foaf:Organization></dc:publisher>
        <bib:authors><rdf:Seq><rdf:li><foaf:Person><foaf:surname>Taşpınar</foaf:surname><foaf:givenName>İsmail</foaf:givenName></foaf:Person></rdf:li></rdf:Seq></bib:authors>
        <dc:title>Kazimirski, Albert de Biberstein</dc:title>
        <dcterms:abstract>(1808-1887)
Bu madde basılı nüshada &quot;KAZIMIRSKI, Albin (Albert) de Biberstein&quot; başlığıyla yer almıştır.</dcterms:abstract>
        <dc:date>2022</dc:date>
        <bib:pages>153-154</bib:pages>
    </rdf:Description>
    <rdf:Description rdf:about="#item_2526">
        <z:itemType>encyclopediaArticle</z:itemType>
        <dcterms:isPartOf><bib:Book><prism:volume>25</prism:volume></bib:Book></dcterms:isPartOf>
        <dc:publisher><foaf:Organization><vcard:adr><vcard:Address><vcard:locality>Ankara</vcard:locality></vcard:Address></vcard:adr></foaf:Organization></dc:publisher>
        <bib:authors><rdf:Seq><rdf:li><foaf:Person><foaf:surname>Yazar</foaf:surname><foaf:givenName>Bir</foaf:givenName></foaf:Person></rdf:li></rdf:Seq></bib:authors>
        <dc:title>Kâşgarî</dc:title>
        <dc:date>2002</dc:date>
        <bib:pages>1-2</bib:pages>
    </rdf:Description>
    <rdf:Description rdf:about="#item_2527">
        <z:itemType>encyclopediaArticle</z:itemType>
        <dcterms:isPartOf><bib:Book><prism:volume>25</prism:volume></bib:Book></dcterms:isPartOf>
        <dc:publisher><foaf:Organization><vcard:adr><vcard:Address><vcard:locality>Ankara</vcard:locality></vcard:Address></vcard:adr></foaf:Organization></dc:publisher>
        <bib:authors><rdf:Seq><rdf:li><foaf:Person><foaf:surname>Yazar</foaf:surname><foaf:givenName>Bir</foaf:givenName></foaf:Person></rdf:li></rdf:Seq></bib:authors>
        <dc:title>Kâtib Çelebi</dc:title>
        <dc:date>2002</dc:date>
        <bib:pages>3-4</bib:pages>
    </rdf:Description>
</rdf:RDF>`;

describe("yerleşik veritabanı: DİA", () => {
  const dia = diaFromRdf(RDF);
  const g = dia.entries.find((e) => e.n === 15108)!;
  const k = dia.entries.find((e) => e.n === 2525)!;
  it("reads the printed madde, its links and the 'bk.' headings that point to it", () => {
    expect(g).toMatchObject({ t: "Gazzâlî", a: [["Çağrıcı", "Mustafa"]], v: "13", y: "1996", p: "İstanbul", pg: "489-505", pdf: "13/C13015816.pdf", web: "gazzali#1", al: ["Ebû Hâmid el-Gazzâlî"] });
    expect(g.r).toBeUndefined();
  });
  it("cites the title as printed, spelled as the web page spells the same words", () => {
    expect(printedTitle("KAZIMIRSKI, Albin (Albert) de Biberstein", "Kazimirski, Albert de Biberstein")).toEqual({ title: "Kazimirski, Albin (Albert) de Biberstein", guessed: false });
    expect(printedTitle("EVS", "Evs (Benî Evs)").title).toBe("Evs");
    expect(printedTitle("SNOUCK-HURGRONJE, Christian", "Snouck-Hurgronje, Christiaan").title).toBe("Snouck-Hurgronje, Christian");
    expect(k).toMatchObject({ t: "Kazimirski, Albin (Albert) de Biberstein", w: "Kazimirski, Albert de Biberstein" });
  });
  it("marks a madde whose date is not the year its volume was printed", () => {
    expect(k.r?.[0]).toContain("25. cilt: Ankara 2002");
  });
  it("finds maddeler by headword (with or without marks), by a 'bk.' heading, by author", () => {
    expect(searchDia("gazzali", dia).map((e) => e.n)).toEqual([15108]);
    expect(searchDia("ebu hamid", dia).map((e) => e.n)).toEqual([15108]);
    expect(searchDia("çağrıcı gazz", dia).map((e) => e.n)).toEqual([15108]);
    expect(searchDia("ka", dia)).toEqual([]);
  });
  it("becomes an İSNAD record of the printed madde", () => {
    const item = diaItem(g);
    expect(item.itemType).toBe("encyclopediaArticle");
    expect(builtinSource(item)).toBe("TDV İslâm Ansiklopedisi#15108");
    expect(item.attachments?.map((a) => a.url)).toEqual(["https://cdn2.islamansiklopedisi.org.tr/dosya/13/C13015816.pdf", "https://islamansiklopedisi.org.tr/gazzali#1"]);
    const r = bib(item);
    expect(r.note).toContain("Mustafa Çağrıcı, “Gazzâlî”, Türkiye Diyanet Vakfı İslâm Ansiklopedisi (İstanbul: TDV Yayınları, 1996), 13/490");
    expect(r.bib).toContain("Çağrıcı, Mustafa. “Gazzâlî”. Türkiye Diyanet Vakfı İslâm Ansiklopedisi. 13/489-505. İstanbul: TDV Yayınları, 1996");
  });
});

describe("yerleşik veritabanı: makale kataloğu", () => {
  const rec: ArticleRec = ["DKR0000007", "Ayraler|Arzu;Yılmaz|Ali", "Diyaliz ünitesinde çalışan sağlık ekibinde tükenmişlik sendromu", "Journal of Academic Research in Medicine", 2011, 6, "1", "2", "52", "58", "", "10.5152/jarem.2011.15", "2146-6505", "tr", "ajans"];
  it("an article is an İSNAD record with its verified DOI and where it came from", () => {
    const item = articleItem(rec);
    expect(item.fields).toMatchObject({ volume: "1", issue: "2", pages: "52-58", date: "2011-06", DOI: "10.5152/jarem.2011.15" });
    expect(builtinSource(item)).toBe("Derkenar makale kataloğu#DKR0000007");
    expect(item.fields.extra).toContain("Doğrulama: DOI kayıt ajansında doğrulandı");
    const r = bib(item);
    expect(r.bib).toContain("Ayraler, Arzu - Yılmaz, Ali. “Diyaliz ünitesinde çalışan sağlık ekibinde tükenmişlik sendromu”. Journal of Academic Research in Medicine 1/2 (Haziran 2011), 52-58. https://doi.org/10.5152/jarem.2011.15");
  });
  it("splits into shards: a word prefix finds the records whose words begin with it", () => {
    const other: ArticleRec = [...rec];
    other[0] = "DKR0000008";
    other[1] = "Kaya|Veli";
    other[2] = "Hemşirelerde iş doyumu";
    const { meta, shards, chunks } = articleShards([JSON.stringify(rec), JSON.stringify(other)], 1);
    expect(meta).toMatchObject({ count: 2, per: 1 });
    expect(chunks).toHaveLength(2);
    expect(postingsFor("tuke", shards.get("tuk")!)).toEqual([0]);
    expect(postingsFor("kay", shards.get("kay")!)).toEqual([1]);
    expect(intersect(postingsFor("diy", shards.get("diy")!), postingsFor("ayr", shards.get("ayr")!))).toEqual([0]);
  });
  it("an author is found by given name and surname; exact matches come before prefix matches", () => {
    const a: ArticleRec = [...rec];
    a[1] = "Poyrazoğlu|Şükran";
    a[2] = "Incidence of Type 1 Diabetes";
    const b: ArticleRec = [...rec];
    b[1] = "Kaya|Veli;Poyraz|Ufuk";
    b[2] = "Kentsel Yönetişim";
    const c: ArticleRec = [...rec];
    c[1] = "Poyraz|Abdurrahman";
    c[2] = "Bir Kâidenin Serencamı";
    expect(articleWords(c)).toEqual(expect.arrayContaining(["abdurrahman", "poyraz", "kaidenin"]));
    expect(rankArticles("poyraz", [a, b, c]).map((r) => r[1])).toEqual(["Poyraz|Abdurrahman", "Kaya|Veli;Poyraz|Ufuk", "Poyrazoğlu|Şükran"]);
    expect(rankArticles("Abdurrahman Poyraz", [a, b, c])[0]![1]).toBe("Poyraz|Abdurrahman");
  });
  it("postings round-trip, folding ignores marks and dotted/dotless i", () => {
    expect(decodePostings(encodePostings([3, 10, 47, 1000]))).toEqual([3, 10, 47, 1000]);
    expect(foldKey("İhyâü Ulûmi’d-Dîn")).toBe(foldKey("ihyau ulumid din"));
    expect(foldKey("el-Gazzâlî")).toBe("gazzali");
  });
});

import { describe, expect, it } from "vitest";
import { citeAsIn, doisIn, isbnsIn, linesOf, readPage, type PageLine } from "../src/core/pagetext.js";

const L = (rows: [string, number][]): PageLine[] => rows.map(([text, size]) => ({ text, size }));
const who = (r: ReturnType<typeof readPage>) => r.item?.creators.map((c) => `${c.creatorType}:${c.firstName ?? ""} ${c.lastName ?? c.name}`.trim());

describe("pagetext", () => {
  it("finds identifiers, OCR mistakes included", () => {
    expect(isbnsIn("ISBN 978-0-19-852663-6")).toEqual(["9780198526636"]);
    expect(isbnsIn("ISBN: 978-O-l9-852663-6")).toEqual(["9780198526636"]);
    expect(isbnsIn("ISBN 978-0-19-852663-5")).toEqual([]);
    expect(isbnsIn("ISBN 0-19-852663-6")).toEqual(["0198526636"]);
    expect(doisIn("DOI: 10.33227/auifd.123456.\nhttps://doi.org/10.1000/xyz)")).toEqual(["10.33227/auifd.123456", "10.1000/xyz"]);
  });

  it("puts the printed ISBN before the e-book's", () => {
    expect(isbnsIn("e-ISBN 978-0-19-852663-6\nISBN 0-19-852663-6")).toEqual(["0198526636", "9780198526636"]);
  });

  it("reads a journal's Atıf line", () => {
    const page = linesOf(`Makale Bilgisi
Atıf: Kutlu, Sönmez. “İlk Mürciî Metinler”. Ankara Üniversitesi İlahiyat
Fakültesi Dergisi 37/1 (1997), 317-331.
https://doi.org/10.1501/Ilhfak_0000000123
Geliş Tarihi: 12.01.1997`);
    expect(citeAsIn(page.map((l) => l.text))).toContain("Fakültesi Dergisi 37/1 (1997), 317-331.");
    const r = readPage(page);
    expect(r.how).toBe("atif");
    expect(r.item?.fields.title).toBe("İlk Mürciî Metinler");
    expect(r.item?.fields.DOI).toBe("10.1501/Ilhfak_0000000123");
    expect(r.dois).toEqual(["10.1501/Ilhfak_0000000123"]);
  });

  it("reads a book's title page by letter size", () => {
    const r = readPage(L([
      ["MUSTAFA KARA", 18],
      ["TASAVVUF VE TARİKATLAR", 36],
      ["TARİHİ", 36],
      ["DERGÂH YAYINLARI", 14],
      ["İstanbul", 12],
    ]));
    expect(r.how).toBe("sayfa");
    expect(r.item?.itemType).toBe("book");
    expect(r.item?.fields.title).toBe("TASAVVUF VE TARİKATLAR TARİHİ");
    expect(who(r)).toEqual(["author:MUSTAFA KARA"]);
    expect(r.item?.fields.publisher).toBe("DERGÂH YAYINLARI");
    expect(r.item?.fields.place).toBe("İstanbul");
    expect(r.unsure).toEqual(["yıl"]);
  });

  it("reads a künye page: latest printing, translator, no house editor", () => {
    const r = readPage(linesOf(`Dergâh Yayınları: 412
Tasavvuf Dizisi: 23
İhyâu Ulûmi'd-dîn
İmam Gazzâlî
Çeviren: Ahmet Serdaroğlu
Editör: Ali Veli
Kapak Tasarımı: Ayşe Kaya
1. Baskı: İstanbul, 1985
8. Baskı: Ekim 2005
ISBN 978-0-19-852663-6
Sertifika No: 12345
Dergâh Yayınları Molla Gürani Cad. No: 22 Fındıkzade 34093 İstanbul
Tel: (0212) 123 45 67`));
    expect(r.isbns).toEqual(["9780198526636"]);
    expect(r.item?.fields.title).toBe("İhyâu Ulûmi'd-dîn");
    expect(who(r)).toEqual(["author:İmam Gazzâlî", "translator:Ahmet Serdaroğlu"]);
    expect(r.item?.fields.publisher).toBe("Dergâh Yayınları");
    expect(r.item?.fields.edition).toBe("8");
    expect(r.item?.fields.date).toBe("2005");
    expect(r.item?.fields.place).toBe("İstanbul");
    expect(r.item?.fields.ISBN).toBe("9780198526636");
  });

  it("reads a thesis cover", () => {
    const r = readPage(L([
      ["T.C.", 14],
      ["ANKARA ÜNİVERSİTESİ", 14],
      ["SOSYAL BİLİMLER ENSTİTÜSÜ", 14],
      ["TEMEL İSLAM BİLİMLERİ ANABİLİM DALI", 14],
      ["HADİS BİLİM DALI", 14],
      ["İBN HACER'İN HADİS USULÜNE KATKILARI", 20],
      ["Doktora Tezi", 14],
      ["Ahmet Yılmaz", 14],
      ["Danışman", 12],
      ["Prof. Dr. Mehmet Demir", 12],
      ["Ankara-2015", 12],
    ]));
    expect(r.item?.itemType).toBe("thesis");
    expect(r.item?.fields.title).toBe("İBN HACER'İN HADİS USULÜNE KATKILARI");
    expect(r.item?.fields.university).toBe("ANKARA ÜNİVERSİTESİ, SOSYAL BİLİMLER ENSTİTÜSÜ");
    expect(r.item?.fields.thesisType).toBe("Doktora Tezi");
    expect(who(r)).toEqual(["author:Ahmet Yılmaz"]);
    expect(r.item?.fields.place).toBe("Ankara");
    expect(r.item?.fields.date).toBe("2015");
  });

  it("reads an English title page with a subtitle", () => {
    const r = readPage(L([
      ["The Formation of Islamic Law", 30],
      ["Theory and Practice in the Early Period", 18],
      ["WAEL B. HALLAQ", 16],
      ["CAMBRIDGE", 12],
      ["UNIVERSITY PRESS", 12],
      ["© Cambridge University Press 2005", 8],
    ]));
    expect(r.item?.fields.title).toBe("The Formation of Islamic Law: Theory and Practice in the Early Period");
    expect(who(r)).toEqual(["author:WAEL B. HALLAQ"]);
    expect(r.item?.fields.date).toBe("2005");
  });
});

describe("pagetext on OCR output", () => {
  it("reads a photographed künye page (Tesseract line heights)", () => {
    const r = readPage(L([["Dergâh Yayınları: 412", 14], ["Tasavvuf Dizisi: 23", 11], ["İhyâu Ulümi'd-din", 16], ["İmam Gazzâli", 11], ["Çeviren: Ahmet Serdaroğlu", 14], ["Editör: Ali Veli", 11], ["Kapak Tasarımı: Ayşe Kaya", 13], ["1. Baskı: İstanbul, 1985", 11], ["8. Baskı: Ekim 2005", 11], ["ISBN 978-0-19-852663-6", 11], ["Sertifika No: 12345", 11], ["Dergâh Yayınları Molla Gürani Cad. No: 22 Fındıkzade 34093 İstanbul", 11], ["Tel: (0212) 123 45 67", 11]]));
    expect(r.item?.fields.title).toBe("İhyâu Ulümi'd-din");
    expect(who(r)).toEqual(["author:İmam Gazzâli", "translator:Ahmet Serdaroğlu"]);
    expect(r.item?.fields).toMatchObject({ publisher: "Dergâh Yayınları", edition: "8", date: "2005", place: "İstanbul" });
  });
});

import { librarySpelling } from "../src/core/library.js";
import { emptyItem } from "../src/core/zotero.js";

describe("library spelling", () => {
  const old = emptyItem("book");
  old.creators = [{ creatorType: "author", firstName: "Ebû Hâmid", lastName: "Gazzâlî" }];
  old.fields = { title: "x", publisher: "Dergâh Yayınları", place: "İstanbul" };
  it("takes the library's careful spelling", () => {
    const it = emptyItem("book");
    it.creators = [{ creatorType: "author", firstName: "Ebu Hamid", lastName: "Gazzâli" }];
    it.fields = { title: "y", publisher: "Dergah Yayinlari" };
    const r = librarySpelling(it, [old]);
    expect(r.item.creators[0]).toMatchObject({ firstName: "Ebû Hâmid", lastName: "Gazzâlî" });
    expect(r.item.fields.publisher).toBe("Dergâh Yayınları");
  });
  it("never goes towards a plainer spelling or other letters", () => {
    const it = emptyItem("book");
    it.creators = [{ creatorType: "author", firstName: "Ebû Hâmid", lastName: "Gazzâlî" }, { creatorType: "author", firstName: "Ebu Hamid", lastName: "Gazali" }];
    expect(librarySpelling(it, [old]).changed).toEqual([]);
  });
  it("does not take a spelling in capitals", () => {
    const caps = emptyItem("book");
    caps.creators = [{ creatorType: "author", firstName: "HÜSEYİN", lastName: "YILMAZ" }];
    const it = emptyItem("book");
    it.creators = [{ creatorType: "author", firstName: "Hüseyin", lastName: "Yılmaz" }];
    expect(librarySpelling(it, [caps, caps]).changed).toEqual([]);
  });
});

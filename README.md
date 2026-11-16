# Derkenar

Word için İSNAD temelli atıf ve kaynakça eklentisi. Masaüstü programı değildir:
Word'ün içinde bir **Derkenar sekmesi** ve sağda bir **pencere** olarak çalışır.
Zotero masaüstünde yapılan işler (kütüphane, koleksiyonlar, etiketler, notlar, kaynak
düzenleme, içe/dışa aktarma) bu pencerede yapılır. Windows, Mac ve Word Online'da aynı kod
çalışır; VBA yok.

Zotero'nun açık kaynak parçaları kullanılır: veri şeması (kaynak türleri, alanlar, Türkçe
etiketler, CSL eşlemeleri) ve Zotero'nun da kullandığı CSL işlemcisi citeproc-js. İSNAD
çıktısı resmî İSNAD CSL stilinden gelir.

## Öne çıkanlar

- **Otomatik dipnot güncelleme.** Pencere belgeyle birlikte açılır ve atıfların sırasını
  izler. Araya yeni atıflı dipnot eklendiğinde, bir dipnot silindiğinde, kesilip başka yere
  yapıştırıldığında ya da taşındığında, ek bir işlem gerekmeden ilk atıf tam, sonrakiler kısa
  yazılır. Kütüphanede bir kaynak düzeltildiğinde o kaynağa yapılan bütün atıflar ve kaynakça
  da kendiliğinden güncellenir.
- **İSNAD rolleri:** muhakkik (thk.), nâşir (nşr.), hazırlayan (haz.), sadeleştiren (sad.)
  gerçek kişi rolleridir. Zotero'da bunlar yoktur; Zotero'dan gelen "Dizi editörü"
  muhakkik olarak, Ekstra alanındaki `editorial-director: Soyad || Ad` gibi satırlar ilgili
  rol olarak alınır. Dışa aktarırken Zotero'nun okuyacağı biçimde geri yazılır.
- **İSNAD biçimleri:** cilt/sayfa (1/45), varak (vr. 12b), hicrî/milâdî tarih (1413/1993),
  tarih yoksa ts., yazma eserler (kütüphane, koleksiyon, demirbaş no).
- **İSNAD kısaltmaları kendiliğinden:** basım yeri yoksa b.y., yayınevi yoksa y.y., tarih yoksa ts.
  atıfta ve kaynakçada otomatik yazılır; kayıt boş kalır (Zotero'ya temiz döner).
- **İSNAD yazım denetimi:** alana elle yazılmış kısaltmalar, cilt sayısının Cilt alanına yazılması, tamamen büyük harfle
  yazılmış başlık ve adlar, sonda nokta, sayfa aralığında uzun tire ya da "s.", cilt ve sayı
  alanına yazılmış "C." ve "S.", baskı alanında "2. Baskı", bozuk Türkçe karakterler
  (Ä±, Ã¼, ý, þ), DOI ve ISBN hataları, web kaynağında erişim tarihi, tez ve ansiklopedi
  maddesi için gerekli alanlar. Düzeltilebilenler tek tıkla ya da topluca düzeltilir.

## Zotero'nun neleri pencerede

| Zotero | Derkenar |
| --- | --- |
| Kütüphane, koleksiyonlar ve alt koleksiyonlar | Var (oluştur, yeniden adlandır, sil, kaynak ekle/çıkar) |
| Koleksiyonsuz, Çöp kutusu, Yinelenenler | Var (geri yükle, kalıcı sil, çöpü boşalt, birleştir) |
| Hızlı arama, gelişmiş arama, kayıtlı aramalar | Var (koşullar: alan, içerir/eşittir/önce/sonra/son N gün; hepsi ya da biri) |
| Etiketler, etiket süzgeci, renkli etiketler | Var (yeniden adlandırma, birleştirme, silme, 9 renk) |
| Kaynak düzenleyici: 37 tür, bütün alanlar, kişi rolleri | Var, artı İSNAD rolleri; yazarken kaydedilir; Cümle düzeni / Başlık Düzeni; ad-soyad değiştirme |
| Notlar (biçimli), bağımsız notlar | Var (kalın, italik, başlık, liste, alıntı, bağlantı); notu belgeye ekleme |
| Ekler | Bağlantı ve dosya (PDF vb., bu bilgisayarda saklanır); Zotero'daki dosyaların bağlantısı |
| İlgili kaynaklar | Var (iki yönlü) |
| Bul (Locate) | URL, DOI, WorldCat, Google Akademik |
| Tanımlayıcıyla ekleme | DOI, ISBN (Open Library + Google Books), PMID, arXiv |
| İçe aktarma | Zotero RDF, CSL JSON, BibTeX/BibLaTeX, RIS, Derkenar yedeği |
| Zotero eşitleme | Zotero'dan al (web API ya da Zotero 7 yerel API) ve Zotero'ya gönder (değişen ve yeni kaynaklar; çakışmada üzerine yazmaz) |
| Dışa aktarma | Zotero RDF (koleksiyon ve notlarla), CSL JSON, CSV, RIS, BibTeX, Derkenar yedeği, HTML rapor; kaynakçayı panoya kopyalama |
| Word eklentisi: Atıf ekle/düzenle (hızlı biçim), Kaynakça, Belge tercihleri, Güncelle, Bağlantıyı kaldır | Var; "gazzali 1/45" yazınca cilt/sayfa ayrılır; dipnot ya da sonnot |
| PDF okuyucu ve işaretleme, tarayıcı eklentisi, RSS beslemeleri, tam metin dizini | Yok (Word penceresinde yapılamaz) |

Stil şimdilik yalnız İSNAD 2 (dipnotlu ve metin içi). APA ve diğerleri sonraki iş.

## Depo yapısı

| Klasör | İçerik |
| --- | --- |
| `src/core/` | Word'den bağımsız çekirdek: Zotero modeli ve CSL dönüşümü (`zotero.ts`), Zotero RDF (`rdf.ts`), içe aktarma, dışa aktarma, İSNAD denetimi (`isnad.ts`), kütüphane işlemleri, arama, citeproc sarmalayıcı, güncelleme planı (`docstate.ts`) |
| `src/addin/` | Office.js penceresi: `pane/` altında Atıf, Kütüphane, Kaynak düzenleyici, Belge (otomatik güncelleme), Denetim, Aktar; `word.ts` Word işlemleri; `store.ts` IndexedDB |
| `data/styles/` | İSNAD CSL stilleri ve dil dosyaları (CC BY-SA 3.0) |
| `data/zotero/` | Zotero veri şeması; `scripts/schema.mjs` bunu `src/core/zschema.json`'a indirger |
| `manifest/`, `assets/` | Manifest şablonu (`scripts/manifest.mjs` üretir), simgeler (Fluent UI, MIT) |
| `test/` | Çekirdek testleri ve Zotero RDF örneği |

## Geliştirme

Node.js 20 veya üstü.

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run smoke
```

`npm run smoke` derlenmiş pencereyi Chromium'da sahte bir Word belgesiyle baştan sona
çalıştırır: Zotero RDF içe aktarma, koleksiyonlar, kaynak düzenleme, İSNAD düzeltmesi, elle
yazma kaynağı, cilt/sayfa ve varaklı atıflar, araya atıf ekleme, dipnotun Word'de elle silinmesi
ve taşınmasından sonra otomatik güncelleme, kütüphanedeki düzeltmenin atıflara yansıması, atıf
düzenleme, denetim, kaynakça, dışa aktarma ve düz metne çevirme. Word'de denemek için
`docs/WORD-DENEME.md`.

## Lisans

AGPL-3.0-or-later. citeproc-js CPAL-1.0 / AGPL-1.0, Zotero'nun veri şeması Zotero
projesinin (AGPL) parçasıdır. CSL stilleri ve dil dosyaları CC BY-SA 3.0'dır; İSNAD stillerinin
Türkçe bölümünde varak kısaltması "vr." yapılmıştır (`data/styles/README.md`).

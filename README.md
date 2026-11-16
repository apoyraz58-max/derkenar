# Künye

Word için hızlı atıf ve kaynakça eklentisi. Masaüstü programı değildir: Word'ün
içinde bir **Künye sekmesi** ve sağda bir **pencere** olarak çalışır (Vefeyât ile
aynı Office.js mimarisi). Windows, Mac ve Word Online'da aynı kod çalışır; VBA yok.

Atıfları Zotero'nun kullandığı açık kaynak CSL işlemcisi
[citeproc-js](https://github.com/Juris-M/citeproc-js) biçimlendirir; stiller
[CSL stil deposundan](https://github.com/citation-style-language/styles) gelir.
Yani çıktı Zotero'nunkiyle aynıdır, ama Zotero masaüstü programına gerek yoktur.

## Neden daha hızlı

| Zotero Word eklentisi | Künye |
| --- | --- |
| Her işlemde Word ↔ Zotero programı arasında gidip gelir | Her şey Word'ün içindeki pencerede olur |
| Güncellemede her alanı tek tek yeniden yazar | Belgeyi tek seferde okur, yalnız **değişen** atıfları yazar (2–3 Word çağrısı) |
| Arama Zotero penceresinde, ayrı bir program | Kütüphane bellekte; 20 000 kaynakta arama < 100 ms, Türkçe karakter/şapka duyarsız ("gazzali ihya") |
| Zotero açık olmalı | Zotero açık olmak zorunda değil; kütüphane eklentide saklanır, internet yokken de çalışır |

## Neler var

- **Kaynaklar:** Zotero web kütüphanesi (kişisel/grup, artımlı eşitleme), bilgisayardaki
  Zotero 7 (yerel API), BibTeX / RIS / CSL JSON dosyası (Zotero, Mendeley, EndNote,
  Google Akademik), DOI ve ISBN ile ekleme, elle ekleme.
- **Atıf:** arama → Enter ile sepete ekle → sayfa/cilt/varak yaz → Ctrl+Enter. Bir atıfta
  birden çok kaynak, ön/arka ek ("bk."), yazarı gizleme, canlı önizleme.
- **Dipnotlu stiller:** atıf kendiliğinden yeni bir dipnota girer; ilk atıf tam, sonrakiler
  kısa ("a.g.e." mantığı stile göre). Araya atıf eklenince sıralama yeniden hesaplanır.
- **Düzenleme:** imleci bir atıfın içine koyun; pencere o atıfı açar.
- **Kaynakça:** imlecin olduğu yere eklenir, her atıfla birlikte güncellenir, asılı girinti.
- **Stiller:** İSNAD 2 (dipnotlu ve metin içi), APA 7, Chicago 18 (dipnot ve yazar-tarih),
  MLA 9, Harvard, IEEE; ayrıca herhangi bir `.csl` dosyası. Türkçe / İngilizce terimler.
- **Belge kendine yeter:** atıf verisi belgenin içinde saklanır; belgeyi alan biri
  kütüphanesi olmadan da güncelleyebilir, kaynakları kendi kütüphanesine alabilir.
- **Teslim:** "Düz metne çevir" ile atıflar ve kaynakça sabit metne dönüşür.

## Depo yapısı

| Klasör | İçerik |
| --- | --- |
| `src/core/` | Word'den bağımsız çekirdek: arama, citeproc sarmalayıcı, HTML→biçimli metin, içe aktarma, belge verisi ve güncelleme planı |
| `src/addin/` | Office.js penceresi: arayüz, Word işlemleri (`word.ts`), IndexedDB kütüphanesi |
| `data/styles/` | Eklentiyle yayımlanan CSL stilleri ve dil dosyaları (CC BY-SA 3.0) |
| `manifest/`, `assets/` | Manifest şablonu (`scripts/manifest.mjs` üretir), simgeler (Fluent UI, MIT) |
| `scripts/` | Derleme, manifest, simge üretimi, tarayıcıda duman testi |
| `test/` | Çekirdek testleri (vitest) |

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

`npm run build` eklentiyi `dist/addin/` klasörüne derler (varsayılan adres GitHub Pages:
`https://apoyraz58-max.github.io/kunye/`; başka adres için `BASE_URL=... npm run build`).
`npm run smoke` derlenmiş pencereyi Chromium'da sahte bir Word belgesiyle baştan sona
çalıştırır (içe aktarma, Zotero eşitleme, dipnot atfı, düzenleme, kaynakça, stil değişimi,
düz metne çevirme). Word'de denemek için `docs/WORD-DENEME.md`.

## Lisans

AGPL-3.0-or-later. citeproc-js CPAL-1.0 / AGPL-1.0 lisanslıdır ve eklentiyle birlikte
dağıtılır; bu yüzden eklentinin kaynak kodu açık kalmalıdır. CSL stilleri ve dil
dosyaları CC BY-SA 3.0'dır. Zotero'nun kendi kodu (Zotero'nun AGPL'li Word eklentisi)
kopyalanmamıştır; Zotero ile ortak olan, aynı açık kaynak CSL işlemcisi ve stilleridir.

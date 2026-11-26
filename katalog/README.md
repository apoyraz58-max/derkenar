# Derkenar makale kataloğu

DergiPark, TR Dizin ve İSAM Makaleler Veritabanı'ndaki makaleleri tek kayıtta birleştirip
İSNAD 2 (kaynakça) künyesiyle kataloglar. Hedef: 1.000.000 tekil makale, DOI'li ve DOI'siz.

| Dosya | İçerik |
|---|---|
| `catalog.py` | Aktarım, eşleştirme, DOI doğrulama, İSNAD 2 künyesi, CSV, rapor |
| `toplu.sh` | Üç kaynağı ve DOI doğrulamayı paralel süreçlerde, kaldığı yerden çalıştırır |
| `derkenar.sqlite3` | Çalışma veritabanı (git'e girmez) |
| `ham-sayfalar.sqlite3` | Kaynaktan gelen her sayfanın sıkıştırılmış ham hâli (git'e girmez) |
| `derkenar-uc-kaynak.csv` | Güncel UTF-8 katalog çıktısı, makale başına bir satır |
| `rapor/` | Her aktarım grubunun raporu, `son-rapor.md` genel durum |

## Kaynaklar ve istek sınırları

| Kaynak | Uç nokta | Biçim / sayfalama | Sınır |
|---|---|---|---|
| DergiPark | `https://dergipark.org.tr/api/public/oai/` | OAI-PMH `oai_mods`, 100 kayıt/sayfa, `resumptionToken` (24 saat geçerli) | Yayımlanmış sınır yok → 1 istek/sn |
| TR Dizin | `https://search.trdizin.gov.tr/api/defaultSearch/publication/` | JSON, `limit=100`, `page=N`; yıl bölümlerine ayrılır (`facet-publication_year`), `facet-documentType=PAPER` | Türkiye dışı IP: 60 istek/dk, aşımda IP engeli → 48/dk |
| İSAM | `https://makale.isam.org.tr/server/oai/request` | DSpace OAI-PMH `dim`, 100 kayıt/sayfa, `resumptionToken` | Yayımlanmış sınır yok → 1 istek/sn |
| Crossref | `https://api.crossref.org/works/{doi}` | DOI kayıt ajansı denetimi | Public havuz 5/sn, eşzamanlılık 1 → ~3/sn |
| doi.org | `/api/handles/{doi}`, `/ra/{doi}` | Crossref'te olmayan DOI'ler için | 2/sn |

`makale.isam.org.tr` sitesinin arayüzü ve REST API'si bu ortamdan 403 döndürüyor; OAI-PMH uç noktası açık.

## Kurallar

- **Katalog kimliği** DOI'den bağımsızdır: `DKR0000001`.
- **Kaynak kaydı** `(kaynak, kaynak_kimliği)` ile tekildir; yeniden çalıştırma kaydı günceller, yenisini açmaz.
- **Eşleştirme**
  1. Aynı normalleştirilmiş DOI → aynı makale (başlık tutarlı değilse denetime düşer).
  2. DOI yoksa: başlık (bütün dil sürümleri), ilk yazar soyadı, dergi/ISSN, yıl (±1), ilk/son sayfa.
     İki tarafta da bilinen ama farklı cilt, sayı, ilk sayfa ya da ilk yazar otomatik birleştirmeyi engeller.
  3. Aynı kaynaktaki iki farklı kayıt yalnız bütün alanlar tutuyorsa birleşir (kaynağın kendi tekrarı).
  4. Belirsiz eşleşmeler `match_review` tablosuna, makaleye `olasi-tekrar` işareti olarak yazılır.
- **DOI durumu**
  - *Doğrulandı*: DOI makalenin kendi yayın kaydında (DergiPark) geçiyor ya da kayıt ajansında var ve başlık tutuyor.
  - *Doğrulama bekliyor*: DOI yalnız dizinde (TR Dizin/İSAM) geçiyor, ajans denetimi henüz yapılmadı;
    ya da ajanstaki başlık tutmuyor.
  - *Bulunamadı*: kaynaklarda DOI yok ya da kaynaktaki DOI ajansta kayıtlı değil (`doi-ajansta-yok`).
  - Künyenin sonunda yalnız *Doğrulandı* DOI `https://doi.org/…` olarak yer alır.
- **Alan önceliği**: başlık DergiPark (makale dilindeki başlık) > Crossref > TR Dizin > İSAM;
  tarih Crossref > TR Dizin (sayı yılı/ayı) > İSAM > DergiPark. DergiPark `dateIssued` bazen
  gönderim tarihini taşıdığı için en sondadır; yıl farkları `yil-farki` olarak işaretlenir.
- **Kapsam dışı** (kaynak kaydı saklanır, sayılmaz): İSAM'da dergi bilgisi olmayan kitap içi bölümler,
  TR Dizin'de proje ve `CORRECTION`/`EDITORIAL` türleri, silinmiş OAI kayıtları.
- **Künye hazır** sayılması için yazar, başlık, dergi, yıl, cilt/sayı ve sayfa/makale no gerekir
  (ISSN eksikliği işaretlenir, künyeyi engellemez). Ayrıntılı künye denetimi toplu aktarımdan sonra yapılacak.

## Tarihsel bağlantılar

Eski DergiPark kopyasından gelen bağlantılar (satır başına bir URL):

```bash
python3 catalog.py historical-add baglantilar.txt
```

URL'deki `/article/NNN` kimliği çıkarılır. Aynı kimlik ikinci kez gelirse `tekrar`, çözülemezse `geçersiz`
olur. DergiPark aktarımı o kimliğe ulaştığında bağlantı `eşleşti` olur ve makaleye bağlanır.

## Çalıştırma

```bash
python3 catalog.py init
./toplu.sh                       # toplu aktarım, kesintiden sonra yeniden çalıştırmak yeterli
python3 catalog.py report        # anlık durum
python3 catalog.py export        # CSV'yi yeniden yaz
python3 catalog.py builtin-export   # eklentinin yerleşik veritabanı: ../data/builtin/makale.jsonl.gz (yalnız kesin makaleler)
```

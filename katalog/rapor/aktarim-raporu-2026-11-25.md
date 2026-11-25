# Derkenar makale kataloğu — aktarım raporu

Tarih: 25 Kasım 2026 · Durum zamanı: 18:03 UTC
Veritabanı: `katalog/derkenar.sqlite3` · CSV: `katalog/derkenar-uc-kaynak.csv` (626.587 satır, UTF-8)

## 1. Başlangıç durumu

Önceki çalışmanın dosyaları (`catalog.py`, `derkenar.sqlite3`, `derkenar-uc-kaynak.csv`) çalışma klasöründe,
konteynerde ve git geçmişinde bulunamadı. Bu yüzden 179 DOI'li makale ve 23.912 tarihsel bağlantı
veritabanından doğrulanamadı. Aynı kurallarla yeni bir veritabanı kuruldu; başlangıç değeri **0 makale**.
Tarihsel bağlantılar için `python3 catalog.py historical-add <dosya>` komutu hazır; şu an kayıt yok.

## 2. Kaynaklar ve canlı deneme

| Kaynak | Uç nokta | Biçim ve sayfalama | Uygulanan sınır | Durum |
|---|---|---|---|---|
| DergiPark | `dergipark.org.tr/api/public/oai/` | OAI-PMH `oai_mods`, 100 kayıt/sayfa, `resumptionToken` | 1 istek/sn (yayımlanmış sınır yok) | Erişilebilir |
| TR Dizin | `search.trdizin.gov.tr/api/defaultSearch/publication/` | JSON, 100 kayıt/sayfa, yıl bölümleri | 48 istek/dk (Türkiye dışı IP için yayımlanan sınır 60/dk) | Erişilebilir |
| İSAM | `makale.isam.org.tr/server/oai/request` | DSpace OAI-PMH `dim`, 100 kayıt/sayfa, `resumptionToken` | 1 istek/sn (yayımlanmış sınır yok) | OAI erişilebilir; site ve REST API 403 |
| Crossref | `api.crossref.org/works/{doi}` | DOI kayıt ajansı denetimi | ~3 istek/sn (yayımlanan: 5/sn, eşzamanlılık 1) | Erişilebilir |

Her kaynakta tek sayfalık canlı aktarım yapıldı. Biçim, sayfalama ve yeniden çalıştırmada tekrar oluşmaması
doğrulandı: aynı sayfa yeniden alındığında 300 kaynak kaydı ve 274 makale aynı kaldı.

## 3. İlk aktarım grubu

Canlı denemeden sonraki ilk toplu grup (kaynak başına 50 sayfa, paralel süreçler):

| | DergiPark | İSAM | TR Dizin |
|---|---:|---:|---:|
| Sayfa (100 kayıt) | 50 | 50 | 50 |
| Açılan yeni tekil makale | 4.876 | 3.171 | ≈ 4.900 |
| Var olan makaleye bağlanan kayıt | 124 | 256 | — |

TR Dizin satırı yaklaşıktır: o sürecin grup raporu yazılmadan rapor biçimi düzeltildi, sayı sayfa günlüğünden çıkarıldı.

O andaki katalog toplamı **167.085** tekil makale, hazır İSNAD 2 künyesi **153.874** idi.

## 4. Güncel durum

- Toplam tekil makale: **626.587** / 1.000.000 (%62,7)
- Hazır İSNAD 2 künyesi: **585.322** (eksik alanı olan: 41.265)

### DOI durumu

| Durum | Makale |
|---|---:|
| Doğrulandı | 76.507 |
| — yalnız yayın kaydında (DergiPark), ajans denetimi bekliyor | 57.270 |
| — kayıt ajansında (Crossref 19.180, DataCite 57) | 19.237 |
| Doğrulama bekliyor | 234.982 |
| Bulunamadı | 315.098 |

- Kayıt ajansında denetim bekleyen tekil DOI: **291.775**. Şimdiye kadar denetlenen DOI'lerden 19.316'sı ajansta var, 316'sı yok.
- Ajansta bulunmayan DOI künyede gösterilmez; makale "Bulunamadı" olur ve `doi-ajansta-yok` işareti alır.

### Kaynağa göre kapsam

| Kaynak | Aktarılan kayıt | Kapsamda | Bağlı makale | DOI'li kayıt | Kaynağın toplamı | İlerleme |
|---|---:|---:|---:|---:|---:|---|
| DergiPark | 131.800 | 131.800 | 131.715 | 63.418 | bildirmiyor | 1.318 sayfa; durdu (bkz. 5) |
| TR Dizin | 315.086 | 313.699 | 313.647 | 275.013 | 715.043 | 37 yıl bölümünün 6'sı bitti |
| İSAM | 351.468 | 242.709 | 218.945 | 14 | 351.468 | **Tamamlandı** |

İSAM'da kapsam dışı kalan 108.759 kaydın çoğu dergi bilgisi olmayan kitap içi bölüm. TR Dizin'de proje ve
düzeltme/editoryal türleri sayılmıyor. Bu kayıtlar saklanıyor ama makale sayılmıyor.

### Birleştirme ve bekleyen eşleşmeler

- Kaynak sayısına göre: 1 kaynak 589.705 · 2 kaynak 36.044 · 3 kaynak 838
- Kaynak kayıtlarının bağlanma yolu: DOI ile 26.640 · künye karşılaştırmasıyla 34.981
- Aynı DOI'li ama başlığı tutmayan, birleştirilmeyen kayıt: 398
- Denetim bekleyen belirsiz eşleşme: **27.933**
- Kaynaklar arası farkı işaretli makale: 21.288
- Eksik alanlar: ISSN 310.206 (DergiPark'ın OAI çıktısında ISSN yok) · yazar 22.199 · sayfa/makale no 15.178 ·
  cilt/sayı 2.329 · yıl 1.960 · başlık 60

### Erişim hataları

- Crossref HTTP 429 (istek sınırı): 247 kez. Hepsi bekleyip yeniden denenerek tamamlandı.
- DergiPark: 1 sayfa geçersiz XML döndürdü (bkz. 5).
- Engellenen kaynak yok.

## 5. Olaylar ve düzeltmeler

1. **Yanlış birleştirmeler (ilk denemede).** "Sayı Editöründen" gibi genel başlıklı, yazarı ve sayfası farklı
   yazılar birleşmişti. Artık iki tarafta da bilinip farklı olan cilt, sayı, ilk sayfa ya da ilk yazar otomatik
   birleştirmeyi engelliyor. Aynı kaynaktaki iki kayıt ancak her alan tuttuğunda birleşiyor. İlk grup bu
   kurallarla yeniden işlendi.
2. **DergiPark aktarımı 14:34'te durdu.** Bir sayfadaki özette XML'de yasak bir karakter (U+FFFE) vardı. Kod bunu
   yanlışlıkla erişim engeli sayıp kaynağı bıraktı. DergiPark engellenmedi. Ayrıştırıcı artık bu karakterleri
   atıyor; sorunlu sayfa 100 kayıt ve devam belirteciyle okunuyor. Bu tür hatalar artık "yanıt hatası" diye ayrı raporlanıyor.
3. **Toplu süreçler 2 saatlik arka plan sınırında durduruldu.** Kayıtlı sayfa sayısı ile saklanan kayıt sayısı
   birebir tutuyor; veritabanı bütünlük denetimi temiz. `./toplu.sh` kaldığı yerden sürer.
4. **Rapor düzeltmeleri.** Grup raporları birbirinin üzerine yazılıyordu ve paralel süreçlerin makalelerini de
   sayıyordu. Artık her grup ayrı dosyaya yazılıyor ve yalnız kendi açtığı makaleleri sayıyor.

## 6. Kalan iş ve hedef

- **TR Dizin**: yaklaşık 400.000 kayıt kaldı. 48 istek/dk ile yaklaşık 1,4 saat sürer; bir kısmı mevcut makalelere bağlanacak.
- **DergiPark**: toplam kayıt sayısını bildirmiyor. 131.800 kayıt alındı. Kaynağın bitip bitmediği ancak liste sonuna gelince ölçülebilir.
- **Bir milyon hedefi**: ulaşılabilir kayıtlarla karşılanıp karşılanmayacağı DergiPark listesi bitince ölçülebilecek.
- **DOI denetimi**: 291.775 DOI, Crossref'in public havuzunda saniyede ~3 denetimle yaklaşık 27 saat sürer.
  Önek bazında toplu Crossref sorgusu bunu ciddi biçimde kısaltabilir; bu henüz uygulanmadı.
- **Ayrıntılı künye denetimi**, 27.933 belirsiz eşleşme ve 21.288 kaynak farkı toplu aktarım bitince ele alınacak.

## 7. Kalıcılık

Kod ve raporlar `claude/gallant-davinci-bqcr2n` dalında. Veritabanı (1,4 GB) ve CSV (353 MB) GitHub'ın dosya başına
100 MB sınırını aştığı için git'te değil; yalnız bu geçici konteynerde duruyorlar.

# Derkenar makale kataloğu: son rapor ve İSNAD denetimi

Durum zamanı: 27 Kasım 2026, 10:49 UTC.

- Veritabanı: `katalog/derkenar.sqlite3`.
- CSV: `katalog/derkenar-uc-kaynak.csv`. 1.425.615 satır, UTF-8.
- Eklentinin yerleşik veritabanı: `data/builtin/`.

## Özet

Toplu aktarım, DOI doğrulaması ve İSNAD denetimi tamamlandı.

| | |
|---|---:|
| Toplam tekil makale | **1.425.615** |
| Bir milyon hedefine göre | %142,6 |
| Hazır İSNAD 2 künyesi | **1.362.854** |
| Künyesinde zorunlu alan eksik makale | 62.761 |
| Eklentinin yerleşik veritabanına giren kesin makale | **627.979** |
| Yerleşik veritabanındaki DİA maddesi | 17.601 |

**Bir milyon hedefi, erişilebilen kaynaklarla karşılandı.**

- 1.425.615 tekil makalenin hepsi DergiPark, TR Dizin ve İSAM'ın açık arayüzlerinden geldi.
- Hedef için ek erişim gerekmedi.
- Bazı eksikler için erişim gerekiyor; "Kalan eksikler ve gereken erişim" bölümünde.

## Kaynaklar

Üç kaynağın listesi de sonuna kadar alındı.

| Kaynak | Aktarılan kayıt | Kapsamda | Bağlı makale |
|---|---:|---:|---:|
| DergiPark (OAI-PMH) | 849.032 | 849.032 | 848.228 |
| TR Dizin (API) | 715.042 | 712.678 | 712.200 |
| İSAM (OAI-PMH) | 351.468 | 242.709 | 218.945 |

- Makalelerin kaynak sayısına dağılımı:
  - 1 kaynak: 1.030.439
  - 2 kaynak: 379.392
  - 3 kaynak: 15.586
  - 4 kaynak (Crossref dahil): 198
- Kaynak kayıtlarının makaleye bağlanma yolu:
  - DOI ile: 222.233
  - Künye karşılaştırmasıyla: 156.571
  - Crossref'te künyeyle bulunup bağlanan: 57.400

## DOI durumu

Kaynaklarda geçen DOI'lerin hepsi kayıt ajansında denetlendi. Denetim bekleyen DOI kalmadı.

| Durum | Makale |
|---|---:|
| **Doğrulandı** | **605.489** |
| — Crossref + DergiPark yayın kaydı | 422.695 |
| — Crossref | 121.412 |
| — Crossref; DOI kaynakta yazılı değildi, künye eşleşmesiyle bulundu | 57.400 |
| — DataCite (+ DergiPark) | 3.960 |
| — Diğer ajans | 22 |
| Doğrulama bekliyor: ajanstaki başlık kaynaktakiyle tutmuyor | 3.633 |
| Bulunamadı | 816.493 |
| — kaynaklarda DOI yok | 783.600 |
| — kaynakta DOI yazılı ama kayıt ajansında kayıtlı değil | 32.893 |

Ajansta kayıtlı olmayan DOI'lere örnek: SDÜ Tıp Fakültesi Dergisi'nin eski `10.17343/sdutfd.*` DOI'leri, ayrıca hiçbir ajansta olmayan `10.2594` öneki.

- Bu DOI'ler künyeye yazılmıyor.
- Makaleleri `doi-ajansta-yok` işaretiyle "Bulunamadı" sayılıyor.

Künyenin sonunda yalnız "Doğrulandı" DOI `https://doi.org/…` olarak yer alıyor.

Kaynaklarda DOI'si yazılmamış makaleler de atlanmadı:

- Türkiye yayıncılarının 1.996 DOI öneki (1,28 milyon kayıt) Crossref'ten toplu tarandı.
- Kaynakta DOI'si olmayan 57.400 makalenin DOI'si künye eşleşmesiyle bulundu.
- Eşleşme koşulu: dergi, cilt, sayı, ilk sayfa ve ilk yazar tutacak; başlık benzerliği en az 0,9 olacak.

## İSNAD denetimi: düzeltilen kurallar

| Kural | Etkilenen | Ne yapıldı |
|---|---:|---|
| Yayın tarihi | 646.663 DergiPark kaydı | Derginin sayı arşivinden cilt/sayı tarihi alındı (3.103 dergi). OAI'deki `dateIssued` 254.111 kayıtta gerçek tarih değildi; çoğu yükleme tarihiydi. 32.859 kayıtta hiç yoktu. Künyede "(Ay Yıl)" olan makale: 1.136.935. |
| Tamamı büyük harfli başlık | 242.380 makale | Önce başka kaynaktaki düzgün yazım kullanıldı. Yoksa İSNAD harf kuralı uygulandı: kelimeler büyük harfle başlar, bağlaçlar küçük kalır. Romen rakamı ve Osmanlıca tamlama eki ("-i", "-ı") korundu. Düzeltilemeyen: 4. |
| Tamamı büyük harfli yazar, dergi ve sayı adları | — | Türkçe harf kuralıyla düzeltildi ("KATTAN" → "Kattan"). |
| DergiPark'ın "0" cilt yer tutucusu | 18.335 kayıt | Kaldırıldı ("0/45" → "45"). |
| Baştaki sıfırlar | 4.435 makale | "044" → "44", "08/1" → "8/1". |
| "0" sayfa yer tutucusu | 20.458 makale | Boş sayıldı. Gerçek sayfası bilinmeyenler künye eksik olarak işaretlendi. |
| Kısaltılmış ya da ters sayfa aralığı | 4.203 makale | "345-54" → "345-354". Gerçekten ters olan 830 aralıkta son sayfa düşürüldü; `sayfa-araligi-ters` işareti kondu. |
| Yazarsız eser (İSAM) | 18.659 makale | İSNAD yazarsız eser kuralıyla künye başlıkla başlıyor. Çeviren, hazırlayan vb. başlıktan sonra yazılıyor ("çev.", "haz."). Kitap tanıtımında tanıtan kişi yazar sayılıyor. Rumi/Hicri ay adı korunuyor: "(Şevval 1332)". |
| ISSN | 670.901 → 198.767 eksik | DergiPark dergi arşiv sayfalarından ISSN ve e-ISSN eklendi. |

### Rastgele örnek künyeler (denetimden sonra)

- Ulutaş, Ejder. “Sosyoloji ve Edebiyat Kavşağında Peyami Safa Romanları”. OPUS Uluslararası Toplum Araştırmaları Dergisi 6/10 (Temmuz 2016), 251-270.
- Aziret, Mehmet vd. “Effectiveness of the laparoscopic appendectomy on second half of the pregnancy”. Annals of Medical Research 27/8 (Ağustos 2020), 2179-2185. https://doi.org/10.5455/annalsmedres.2020.01.041
- Öğreten, Ahmet. “Ereğli Kömür Madeni Havzasında İlk Üretim”. Atatürk Üniversitesi Türkiyat Araştırmaları Enstitüsü Dergisi 12/31 (Şubat 2010), 135-160. *(başlık büyük harften düzeltildi)*
- Halman, Tâlat Sait. “Öz Yazar”. Dil Dergisi 116 (Temmuz 2002), 27-28.
- Teke, Kerem vd. “Predictive Parameters on the Effect of Ofloxacin Treatment on the Reduction of PSA in Patients With Elevated PSA Level”. Yeni Üroloji Dergisi 14/3 (Temmuz 2019), 166-175. https://doi.org/10.33719/yud.512057
- “Medresetü’l-Kuzat”. Ceride-i İlmiyye I/4 (Şevval 1332), 193-194. *(yazarsız eser, Hicri ay)*
- Kavlakoğlu, Sırrı. “Arşimet Spirali Şeklinde Tertiplenmiş Elektromanyetik Verici”. Bilimsel Madencilik Dergisi 6/2 (Mayıs 1967), 92-99. *(tarih dergi arşivinden)*

Örneklerde kalan küçük kusurlar kaynak verisinden geliyor:

- Bazı dergi adları kaynakta küçük harfli ya da "(Online)" ekli: "Folklor akademi dergisi (Online)".
- Bazı sayılar kaynakta alışılmadık biçimde yazılmış: "IV/2 (1)".

Bunlar kural bazında düzeltilmeye uygun, bir sonraki adımda ele alınabilir.

## Kalan eksikler ve nedenleri

Künyesi eksik 62.761 makale, eksik alana göre:

| Eksik | Makale | Neden |
|---|---:|---|
| Sayfa / makale no | 51.507 | DergiPark kaydında da sayı sayfasında da yok; kaynakta hiç girilmemiş. 20 bini "0" yer tutucusuydu. |
| Yazar | 5.475 | Çoğu DergiPark'ta yazar girilmemiş kayıt (editoryal, duyuru vb.). İSAM'da sorumluluk bildirimi de olmayan kayıtlar. |
| Yıl | 4.669 | Arşivi alınamayan dergilerde OAI'de tarih yok. |
| Cilt / sayı | 3.429 | Kaynaklarda yok. |
| Başlık | 317 | DergiPark'ta boş başlıklı kayıtlar. |

İşaretli ama künyesi hazır makaleler:

| İşaret | Makale |
|---|---:|
| Olası tekrar (eşleşme kararı belirsiz) | 231.461 |
| Kaynaklar arasında yıl farkı | 75.618 |
| Kaynaklar arası başka fark (yazar sayısı, sayfa vb.) | 210.974 (toplam) |

Belirsiz eşleşmeler (131.558 çift) incelenmeyi bekliyor.

## Yerleşik veritabanı (Derkenar eklentisi)

Kullanıcı hiçbir dosya yüklemeden Atıf sekmesinde arar. Kütüphanede olmayan kayıtlar tek tıkla İSNAD kaydı olarak eklenir.

**TDV İslâm Ansiklopedisi:** `data/builtin/dia.rdf.gz`, sabit veritabanı.

- 17.601 madde: basılı künye, yazar, PDF ve web bağlantısı.
- 6.066 "bk." göndermesi arama eşanlamlısı.
- 118 madde "Kontrol" notuyla giriyor:
  - 28 maddenin tarihi cildin basımından farklı; bunlar web'de güncellenmiş maddeler.
  - 76 maddede cilt, yıl ya da sayfa yok.
  - 14 maddenin basılı başlığının harf yazımı tahminle çıkarıldı.

**Derkenar makale kataloğu:** `data/builtin/makale-1..3.jsonl.gz`.

Yalnız kesin makaleler girer, yani künyesi tam olan ve aşağıdaki işaretleri taşımayanlar:

- olası tekrar
- yıl farkı
- DOI başlık uyuşmazlığı
- kaynaklar arasında yıl, cilt, sayı, sayfa, ilk yazar ya da DOI çelişkisi

Bunlara ek olarak şu üç yoldan biriyle doğrulanmış olmaları gerekir:

| Doğrulama yolu | Makale |
|---|---:|
| DOI kayıt ajansında doğrulandı | 397.175 |
| DergiPark yayın kaydı, derginin sayı arşiviyle tutuyor | 176.657 |
| En az iki kaynakta çelişkisiz | 54.147 |
| **Toplam** | **627.979** |

Dışarıda kalanlar:

| Neden | Makale |
|---|---:|
| İşaretli (olası tekrar, yıl farkı vb.) | 292.795 |
| Kaynaklar arasında çelişkili | 95.905 |
| Tek kaynakta, ikinci doğrulama yok | 346.175 |
| Künyesi eksik | 62.761 |

Derleme, makaleleri sözcüklerin ilk üç harfine göre 12.520 dizin parçasına ve 250'şer kayıtlık 2.512 kayıt parçasına böler. Bir aramada yalnız gereken birkaç parça iner.

- Testler: 219/219 geçti.
- Pencere testi (smoke): geçti.
- Eklenti GitHub Pages'e `main` dalından yayımlanıyor. Kullanıcıya ulaşması için dalın `main`'e alınması gerekiyor.

## Kalan eksikler ve gereken erişim

- **Kendi alan adına yönlendirilen 40 DergiPark dergisi** (17.831 kayıt). Örnek: `arts.artuklu.edu.tr`, `aseddergi.aksaray.edu.tr`.
  - Bu adresler ortamın ağ kuralında kapalı; arşiv tarihleri ve ISSN'leri alınamadı.
  - Bu dergilerin alan adlarına izin verilirse yılları da düzeltilir.
- **Sayfası kaynakta olmayan 51.507 makale.** Doldurmak için makale PDF'lerinin okunması gerekir. DergiPark PDF indirme bağlantıları açık, ama bu ayrı ve uzun bir iş.
- **İSAM'ın web arayüzü ve REST API'si** bu ortamdan 403 veriyor. OAI-PMH yeterli oldu; ek erişim gerekmedi.
- **Belirsiz eşleşmelerin ve kaynaklar arası farkların** kural bazında çözümü bir sonraki adım. Örnekler: aynı yazarın farklı yazımı, yazar sırası. Çözülenler yerleşik veritabanına da girer.

## Erişim hataları (bütün çalışma boyunca)

| Sunucu | Hata | Sonuç |
|---|---|---|
| api.crossref.org | HTTP 429 (istek sınırı), 1.903 kez | Hepsi beklenip yeniden denendi. |
| dergipark.org.tr | Bir devam belirteci sürekli HTTP 500 verdi | Sorunlu kayıt tek tek alınıp liste sonrasından sürdürüldü. |
| dergipark.org.tr | Bir sayfada geçersiz XML karakteri | Ayrıştırıcı düzeltildi. |
| dergipark.org.tr | Bağlantı sıfırlanması | Yeniden denemeyle geçti. |
| doi.org | HTTP 400 "önek burada değil", 87 kez | Ajansta yok sayıldı. |

Engellenen kaynak yok.

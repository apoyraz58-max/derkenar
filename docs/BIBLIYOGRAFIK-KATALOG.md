# Derkenar bibliyografik kataloğu

Türkiye’de yayımlanmış kitap baskılarını kapsayan katalog, Derkenar’ın Office.js eklentisinden bağımsız bir Node.js komutu ve yerel yönetim paneli olarak çalışır. Katalog işlemleri için Node.js 22.13 veya üstü gerekir. İSNAD 2 Dipnotlu çıktısı ve dosya alışverişi mevcut Derkenar çekirdeğini kullanır. [İSNAD 2. Edisyon, Kitap](https://www.isnadsistemi.org/guide/isnad2/isnad-dipnotlu/2-kitap/)

## Pilot

```sh
npm ci
mkdir -p work
npm run catalog -- pilot --db work/pilot.sqlite --vefeyat ../vefeyat/data/catalog.csv
npm run catalog -- serve --db work/pilot.sqlite
```

Panel aynı bilgisayarda `http://127.0.0.1:4179` adresinden açılır. Kaynak, alan eksikliği, doğrulama kodu, iş konumu ve inceleme adayları görülebilir. Baskı ayrıntısı özgün alanı, seçili değeri, kaynak bağlantısını ve varsa Vefeyât dayanağını gösterir. Bağlantı yerel ve salt okunurdur.

Vefeyât başka konumdaysa `--vefeyat` ile katalog yolunu verin. Pilotu Vefeyât eşleştirmesi olmadan çalıştırmak için seçeneği kaldırın. Katalog CSV’si bu depoya kopyalanmaz. Tamamlanmış bir pilotu farklı bir Vefeyât sürümüyle yeniden karşılaştırmak için yeni bir çalışma veritabanı kullanın.

Pilot 9 ham kayıttan 7 eser ve 8 baskı üretir. Vefeyât kataloğuyla çalıştırıldığında 5 seçili katkı kaydında ad eşleşmesi bulunur.

Pilot girdileri TTK ve ASBÜ’nün elle derlenen katalog alanları ile depodaki K10plus MARCXML örneğidir. TTK’nın 2018 ve 2020 künyelerinde aynı ISBN, sırasıyla altıncı ve yedinci baskılara aittir. ASBÜ kaydı 2018 baskısının sayfa sayısını tamamlar. İSNAD kılavuzundaki Piri Reis örneği biçim doğrulamasına aittir. Baskı numarası için pilotta kütüphane kataloğu esas alınır. [TTK 2018](https://kutuphane.ttk.gov.tr/details?id=591890) · [TTK 2020](https://kutuphane.ttk.gov.tr/details?id=774212) · [ASBÜ](https://katalogkktc.asbu.edu.tr/cgi-bin/koha/opac-detail.pl?biblionumber=9997) · [İSNAD 2.2](https://www.isnadsistemi.org/guide/isnad2/isnad-dipnotlu/2-kitap/2-2-kitap-tek-yazarli/)

## Kaynak araştırması

| Kaynak | Erişim ve arşivleme dayanağı | Uygulama |
| --- | --- | --- |
| K10plus/GVK | Açık üstveri ve SRU/MARCXML. Pilot adaptörü tek ISBN sorgusu ve sağlanan MARCXML anlık görüntüsünü destekler. | [Açık veri](https://swblod.bsz-bw.de/od/) · [SRU kullanımı](https://lab.sbb.berlin/bibliographische-daten-aus-dem-stabikat/) |
| Özgür Yayınları | Yayınevi, kataloglara aktarım için tek dosyada MARCXML yayımlıyor. | [Katalog aktarım koşulları ve dosya](https://www.ozguryayinlari.com/site/tr/libraries) |
| Haliç Yayınevi | Katalog aktarımına açık MARC21, ONIX ve KBART beslemeleri. MARC 264 yayın bilgisi taşır. Kaynak, 164 tam metin kitap bildiriyor. | [Katalog beslemeleri](https://halicyayinevi.com/metadata) |
| Directory of Open Access Books | Üstveri CC0. Resmî MARCXML dosyası ve OAI-PMH yayımlanıyor. Kapsam ağırlıkla hakemli açık erişim kitaplar. | [Üstveri ve indirme](https://www.doabooks.org/en/librarians/doab-metadata) · [CC0 açıklaması](https://www.doabooks.org/en/researchers/faq) |
| Türkiye Bibliyografyası ve Millî Kütüphane | Türkiye kapsamı için derleme temelli kaynak. Katalog sayısı tüm materyal türlerini kapsar. Toplu yeniden kullanım koşullarını ve makinece okunabilir teslim biçimini kurumla doğrulamak gerekir. | [Bibliyografyalar](https://www.millikutuphane.gov.tr/page/Bibliyografyalar) · [Katalog kapsamı](https://www.millikutuphane.gov.tr/page/Kitaplar) |
| TTK, ASBÜ ve İSAM katalogları | Tekil künye karşılaştırması için erişilebilir. TTK ve ASBÜ’den pilot amaçlı seçili olgular elle alındı. Otomatik arşivleme yetkisi ayrıca değerlendirilmeli. | [TTK veritabanları](https://ttk.gov.tr/veri-tabanlari-2-2/) · [ASBÜ kataloğu](https://katalogkktc.asbu.edu.tr/) · [İSAM katalogları](https://isamveri.org/tanitim.php) |
| DNB | Bibliyografik ve GND üstverisi CC0. SRU, OAI ve veri mağazası bulunuyor. Türkiye kapsamı örneklemle ölçülebilir. | [DNB üstveri erişimi](https://www.dnb.de/SharedDocs/Downloads/DE/Professionell/Metadatendienste/linkedDataZugriff.pdf?__blob=publicationFile&v=2) |
| Library of Congress | MDSConnect, kitapları içeren toplu MARC veri kümeleri yayımlıyor. Kitap dosyalarının kapsamı ve yeniden kullanım şartları veri kümesi bazında incelenmeli. | [MDSConnect](https://loc.gov/cds/products/marcDist.php) |
| Harvard Library | HOLLIS bibliyografik üstveri anlık görüntüleri. Kullanım koşulları seçilen veri kümesine göre değerlendirilir. | [Açık veri kümeleri](https://library.harvard.edu/services-tools/harvard-library-datasets) |
| Open Library | Düşük hacimli API ve toplu veri dökümleri. Internet Archive yeni bir hak ileri sürmüyor ve mevcut katkı haklarının saklı olabileceğini belirtiyor. Arşivleme kapalı. | [Lisans](https://openlibrary.org/developers/licensing) · [Dökümler](https://openlibrary.org/developers/dumps) |
| Google Books ve WorldCat | API erişimi üzerinden arşivleme açılmadan önce yetki ve yeniden kullanım koşulları incelenmeli. | [Google Books şartları](https://developers.google.com/books/terms) · [WorldCat Search API](https://www.oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html) |

## Veri modeli ve kararlar

- SQLite’ta `raw_records` kaynaktan gelen MARCXML kaydını veya pilot JSONL satırını, `exchange_files` kullanıcının özgün aktarım dosyasını saklar. `claims`, kaynak değeri, normalleştirilmiş değer, kayıt kimliği, alan yolu ve ilişkilendirilebilir SHA-256 özetini taşır.
- `works` ve `editions` bir-çok ilişkilidir. Seçili baskı alanı, kimlik ve katkı kayıtları kanıt satırlarına bağlanır. Eser grubu oluşturulurken açık eser kimliği veya başlık ve yazar kullanılır. MARC tek biçim başlığı varsa gruplamada kullanılır.
- Yazar, mütercim, editör, muhakkik, nâşir, hazırlayan ve diğer katkılar rol ve sıra ile tutulur. Vefeyât eşleştirmesi, tek bir kişiyle uyuşan kısa veya tam adlarda yapılır. Özgün ad, DİA bağlantısı ve Vefeyât CSV özeti izlenebilir.
- ISBN-10 sağlama toplamı doğrulanıp ISBN-13 eşdeğerine çevrilir. Ortak ISBN veya DOI, çelişmeyen künye ile birlikte otomatik eşleştirme sağlayabilir. Baskı numarası, cilt veya taşıyıcı ayrımı ispatlanıyorsa ortak kimlikli baskılar ayrı tutulur. Kimliksiz benzerlik ve çelişkili kanıtlar panelde inceleme gerektirir. Gözlenen ama seçilmeyen değerler kanıt olarak saklanır.
- Türkiye filtresi yayın ülkesine ve yayın yerine bakar. Yayın dili ve ISBN grubu tek başına kapsam kanıtı sayılmaz. Künye boşlukları yalnız kaynaklı iddialarla doldurulur. İSNAD’ın görüntüleme kısaltmaları künye alanlarına yazılmaz.
- İçe aktarma her 200 kayıtta veriyi ve iş konumunu aynı işlemde yazar. `--limit` ile durdurulan veya kesintiye uğrayan iş, aynı kaynak dosyası ve Vefeyât anlık görüntüsüyle devam eder. Gzip girdisi akıştan okunur, devamda önceki kayıtlar veri eklenmeden geçilir. Değişen kaynak kaydının yeni sürümü saklanır ve inceleme kuyruğuna alınır.

## İşletim

```sh
npm test
npm run typecheck
npm run build

npm run catalog -- show --db work/pilot.sqlite --id 1
npm run catalog -- cite --db work/pilot.sqlite --id 1 --first 22 --later 34
npm run catalog -- export --db work/pilot.sqlite --format zotero-rdf --file work/pilot.rdf
npm run catalog -- ingest --db work/dosya.sqlite --source exchange --file work/pilot.rdf
```

Desteklenen alışveriş biçimleri `csl-json`, `bibtex`, `ris` ve `zotero-rdf`. Zotero’da Dosya → İçe Aktar üzerinden RDF kullanılabilir. İSNAD’a özgü katkılar için RDF tercih edilir. BibTeX ve RIS biçimlerinin yerleşik alanları kapsamı sınırlar. Provenans için katalog veritabanı veya `show` çıktısı kullanılır. [Zotero veri biçimleri](https://www.zotero.org/support/dev/data_formats)

Açık kaynağın gerçek anlık görüntüsüyle ilk toplu deneme pilot veritabanından ayrı çalıştırılır. DOAB dosyası indirildikten sonra aynı dosyayı değiştirmeden kullanın. K10plus için de yerel MARCXML veya MARCXML.GZ sağlanabilir.

```sh
npm run catalog -- collect --source k10plus --isbn 9786054791712 --file work/k10plus.xml
npm run catalog -- collect --source doab --file work/doab.xml
npm run catalog -- ingest --db work/staging.sqlite --source doab --file work/doab.xml --vefeyat ../vefeyat/data/catalog.csv --limit 1000
npm run catalog -- stats --db work/staging.sqlite
```

Yerel yayınevi örneklemi için [Özgür Yayınları MARCXML dosyası](https://www.ozguryayinlari.com/site/libraryFiles/downloadPublic/15) doğrudan kullanılabilir.

```sh
npm run catalog -- collect --source ozgur --file work/ozgur.xml
npm run catalog -- ingest --db work/ozgur.sqlite --source ozgur --file work/ozgur.xml --vefeyat ../vefeyat/data/catalog.csv --limit 200
npm run catalog -- stats --db work/ozgur.sqlite
```

MARCXML bağlantısına erişilemiyorsa aynı yayınevinin [KBART başlık listesi](https://www.ozguryayinlari.com/site/tr/libraryFiles/downloadPublic/16) bir aday listesi sağlar. KBART satırları yayın ülkesini veya yerini taşımadığında kayıt, başka bir kaynaktaki bir baskıyla doğrulanana kadar inceleme kuyruğunda kalır. İlk yazar ve editör bilgisi kaynak alanı olarak korunur.

```sh
npm run catalog -- collect --source ozgur-kbart --file work/ozgur.tsv
npm run catalog -- ingest --db work/kbart.sqlite --source ozgur-kbart --file work/ozgur.tsv --limit 200
```

Yayın yeri kanıtı taşıyan MARC veya elle doğrulanmış künye eklendiğinde, bekleyen adaylar yeniden denetlenebilir. Özgür Yayınları için kaynak URL’si ve PDF sayfasıyla ilişkilendirilmiş seçili künye alanları `data/catalog/pilot/ozgur-kunye.jsonl` dosyasında yer alır.

```sh
npm run catalog -- ingest --db work/kbart.sqlite --source ozgur-kunye --file data/catalog/pilot/ozgur-kunye.jsonl
npm run catalog -- recheck --db work/kbart.sqlite --source ozgur-kbart
```

`recheck`, yalnız yayın kapsamı kanıtı eksik olan ham kayıtları tarar. Doğrulanmış tek bir baskıyla uyumlu kayıt mevcut künye ve özgün kanıtlar korunarak bağlanır. Farklı ISBN veya başlık gibi çelişkiler incelemede görünür. İşlem varsayılan olarak 1000 aday tarar. Daha büyük kuyruklarda çıktının `after` değerini bir sonraki çalıştırmada `--after` olarak kullanın. Yeni bir kanıt partisi geldiğinde tarama baştan çalıştırılabilir.

Yayınevinin kitap sayfası ve PDF künye başlığı gibi iki resmî kaynağı karşılaştırarak bir başlık varyantı doğrulandığında, paneldeki ham kayıt ve hedef baskı kimlikleriyle karar kaydedilebilir.

```sh
npm run catalog -- approve-title --db work/kbart.sqlite --raw-id HAM_KAYIT --id BASKI --reason "Başlık varyantının yayıncı kaynaklarındaki dayanağı"
```

Bu işlem yalnız aynı geçerli ISBN ve DOI tek bir hedef baskıyı birlikte gösterdiğinde çalışır. Yayın ve katkı alanlarında çelişki denetlenir. İki gözlem, seçili başlık ve karar gerekçesi baskı ayrıntılarında görünür.

Bir milyon benzersiz baskı için kapsama ve çakışma oranları kaynak bazında ölçülmeli. Pilotun temsil alanı dar olduğundan, toplu içe alımda ISBN’siz eserler, aynı ISBN’li yeniden basımlar, farklı taşıyıcılar ve çok ciltli takımlardan bağımsız doğrulama örneği çıkarılmalı. Büyük aktarım için tek yazma süreci ve anahtar tabanlı sayfalama kullanılır. Bir milyon baskı için süre ve depolama kapasitesi ölçümü ayrı bir yük testi gerektirir.

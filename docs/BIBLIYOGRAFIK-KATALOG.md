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

### Özgür Yayınları MARCXML partisi (25 Kasım 2026)

Anlık görüntülerin kaynağı, tarihi, boyutu ve SHA-256 özeti `data/catalog/snapshots/2026-11-25.json` dosyasındadır. Önceki KBART veritabanı bulut ortamına taşınmadığı için aynı gün indirilen KBART dosyasıyla yeniden kuruldu. İlk 200 satır önceki sonucu aynen verdi: 70 eşleşme, 3 başlık çelişkisi ve 127 kapsam kanıtı bekleyen kayıt.

Ağ erişimi bir HTTPS vekil sunucusundan geçiyorsa Node.js 22’nin `fetch` işlevi vekili kendiliğinden kullanmaz. `collect` komutunu `NODE_USE_ENV_PROXY=1` ile çalıştırın.

```sh
NODE_USE_ENV_PROXY=1 npm run catalog -- collect --source ozgur --file work/ozgur.xml
NODE_USE_ENV_PROXY=1 npm run catalog -- collect --source ozgur-kbart --file work/ozgur.tsv
npm run catalog -- ingest --db work/kbart.sqlite --source ozgur-kbart --file work/ozgur.tsv --limit 200
npm run catalog -- ingest --db work/kbart.sqlite --source ozgur-kunye --file data/catalog/pilot/ozgur-kunye.jsonl
npm run catalog -- recheck --db work/kbart.sqlite --source ozgur-kbart
npm run catalog -- ingest --db work/kbart.sqlite --source ozgur --file work/ozgur.xml --limit 200
npm run catalog -- recheck --db work/kbart.sqlite --source ozgur-kbart
```

MARCXML’in 1173 kaydının hepsi 008/15–17’de `tu` ve 264’te Gaziantep taşır. İlk 200 MARC kaydı, KBART’taki ilk 200 satırla aynı kitaplardır. `recheck`, bekleyen 127 KBART kaydının tamamını MARC baskılarıyla ISBN ve DOI üzerinden eşleştirdi.

Başlık kararları KBART, MARC 245 ve PDF künyesi karşılaştırılarak verildi. Aynı kararlar bu sırayla yeniden kaydedilebilir. Ham kayıt kimlikleri yukarıdaki aktarım sırasına bağlıdır.

| Kitap | Ham kayıt → baskı | KBART ve MARC 245 | PDF künyesi |
| --- | --- | --- | --- |
| ozgur1447 | 2 → 11 (KBART), 275 → 11 (MARC) | Purchase Intentions | Purchase Intention |
| ozgur1287 | 143 → 36 (KBART), 416 → 36 (MARC) | iki nokta ve virgüllü alt başlık | noktalamasız |
| ozgur1279 | 150 → 37 (KBART), 423 → 37 (MARC) | Antioxidant Defense, and | Antioxidant Defence and |

Kitap 1447’de KBART `first_author` ve MARC 100 alanları “Bağçı”, PDF künyesi “Bağcı” yazar. Seçili katkı PDF künyesinde kalır, fark baskıda `contributor-conflict` olarak görünür. Kitap 1277 (ham kayıt 425) incelemede kalır. MARC 700 “Yaman, Bekir Sıddık Binboğa”, PDF künyesi “Yarman” yazar. MARC başlığı ise “Clinical Ai the Fidelity– Utility” biçiminde bozulmuştur. `approve-title` bu kaydı katkı çelişkisi nedeniyle reddeder. On altı kitapta PDF künyesi “Türkçe, İngilizce”, MARC 041 tek dil verir. Seçili değer PDF künyesindedir, MARC gözlemi kanıt olarak saklanır.

### DOAB deneme partisi

DOAB dışa aktarımında her kaydın leader alanı `"     naaaa"` yer tutucusudur ve 008/15–17 her kayıtta `sp`’dir. Adaptör DOAB için bu leader’ı kitap kaydı sayar ve 008 ülke kodunu kanıt olarak kullanmaz. Türkiye kapsamı yalnız 260/264 yayın yerinden kanıtlanır. 25 Kasım 2026 anlık görüntüsündeki 115.634 kaydın yaklaşık 221’i Türkiye yayın yeri veya Türk yayınevi taşır. Bunların çoğu Istanbul University Press’e aittir. DOAB bu nedenle Türkiye kapsamına küçük bir katkı sağlar. Türkiye dışı yayın yeri, ülke kanıtı olmadığından `scope-unknown` olarak incelemeye düşer.

Tam DOAB dosyasının ayrı veritabanına aktarımı tek yazma süreciyle 1 dk 54 sn sürdü ve 1,26 GB yer kapladı. Bu, ham kayıt başına yaklaşık 11 KB ve saniyede yaklaşık 1000 kayıt demektir. Aktarım 171 Türkiye baskısını kabul etti; en büyük pay 115 kayıtla Istanbul University Press’indir. 115.463 kayıt incelemede kaldı: 61.143’ü birden çok ISBN, 54.310’u kapsam kanıtı eksikliği, 789’u geçersiz ISBN ve 10’u başlık eksikliği nedeniyle. Aynı oranla bir milyon ham kayıt yaklaşık 16–17 dakika ve ham MARC saklandığı için yaklaşık 11 GB gerektirir. Türkiye kapsamı dar kaynaklarda inceleme kuyruğunun büyümesini önlemek için yalnız Türkiye yayın yeri taşıyan kayıtları ayıklayan bir ön süzgeç değerlendirilmelidir.

### K10plus Türkiye örneklemi

K10plus SRU’da `pica.lcd` dizini yayın ülkesi kodunu tutar. 25 Kasım 2026’da `pica.lcd=XB-TR and pica.mat=B` sorgusu 117.791 kitap kaydı döndürdü. Ülke kodu olmayan ama yayın yeri İstanbul, Ankara, İzmir, Konya veya Bursa olan ek 60.561 kayıt `pica.vlo` ile bulunabilir. `collect`, sorguyu 500 kayıtlık sayfalarla ve sayfalar arasında bir saniye bekleyerek tek MARCXML koleksiyonuna yazar. Dosya yalnız bütün sayfalar geldiğinde yerine konur.

```sh
NODE_USE_ENV_PROXY=1 npm run catalog -- collect --source k10plus --query "pica.lcd=XB-TR and pica.mat=B" --limit 1000 --file work/k10plus-tr-1000.xml
npm run catalog -- ingest --db work/k10plus.sqlite --source k10plus --file work/k10plus-tr-1000.xml --limit 200
```

İlk 1000 kaydın 973’ü Türkiye baskısı olarak kabul edildi. Sayfa sayısı %3,3, baskı numarası %31,9, ISBN %4 oranında eksiktir. İncelemede kalan 27 kaydın 21’i kapsam çelişkisidir. Bunlarda 044 alanı Türkiye’yi, yayın yeri ise Kazablanka, Şam, Kahire veya Lüneburg’u gösterir. Çoğu çok merkezli yayınevlerinin Arapça baskılarıdır.

Sorgunun tamamı (117.791 kayıt, 651 MB) yaklaşık 15 dakikada indirildi. Özgür veritabanının kopyasına (`work/katalog.sqlite`) 3 dakikada aktarıldı. 78 kayıt kitap olmadığı için atlandı (leader 06 `o`, `k` veya `i`). Sonuçta 113.792 benzersiz baskı ve 109.253 eser oluştu. Bunların 112.619’u yeni K10plus baskısıdır. 282 K10plus kaydı mevcut bir baskıya bağlandı. 4812 K10plus kaydı incelemede kaldı: 2549 kimlik çelişkisi, 887 birden çok ISBN, 767 olası mükerrer, 655 kapsam çelişkisi ve 18 başlık eksikliği. Kimlik çelişkilerinin başlıca nedenleri şunlardır: aynı ISBN’in sonraki baskılarda kullanılması, çok ciltli takımlarda ortak ISBN, yanlış atanmış ISBN ve ortak yayınlar. Birleşik veritabanında eksik alan oranları şöyledir: baskı numarası %56,8, sayfa sayısı %28,8, ISBN %38,2, yayınevi %5,6, yayın yeri %1,4 ve katkı %3,3. 103 geçersiz ISBN kaydedildi.

Ülke kodu Türkiye olmayan kayıtlar yayın yeri dizini (`pica.vlo`) ile alındı. Sorguda 41 şehir adı ve tarihî adlar (Konstantinopel, Constantinople, Stambul, Dersaadet, Kostantiniyye, Smyrna, Angora) yer alır. `pica.lcd=XB-TR` kayıtları dışarıda bırakılır. Tam sorgu `data/catalog/snapshots/2026-11-25.json` dosyasındadır. Sorgu 61.415 kayıt döndürdü (259 MB). 71 kayıt kitap olmadığı için atlandı.

Kapsam denetimi için katalog, Word eklentisinin yer adı biçimlendirmesinden ayrı bir `turkeyPlace` denetimi kullanır. Bu denetim şu yazımları tanır: tarihî ve yabancı dildeki adlar, “İstanbul [u.a.]” ve “Ankara ; Berlin” gibi çok yerli yazımlar, “Sarıyer/Istanbul” ve “Kadıköy-Istanbul” gibi semt ekleri, “Dersaadet [d.i. İstanbul]” gibi katalogcu açıklamaları. Seçili yer değeri ve İSNAD çıktısı değişmez. 008 ülke kodu Türkiye dışını gösterirken yayın yeri Türk şehri olan kayıtlar artık dışarıda sayılmaz, kapsam çelişkisi olarak incelemeye alınır. Van Nuys (Kaliforniya), Nea Smyrni (Atina) ve “Field Mus.” gibi eşleşmeler dışarıda kalır. Adaptör şu an yalnız ilk 264$a değerini okur. Bu nedenle “Berlin” ile başlayan ortak yayınlar dışarıda kalabilir.

Birleşik katalogda (`work/katalog.sqlite`, 1,48 GB) 164.775 benzersiz baskı ve 153.353 eser bulunur. 13.868 ham kayıt incelemededir: 6533 kimlik çelişkisi, 4265 olası mükerrer, 1217 kapsam çelişkisi, 1069 birden çok ISBN, 1024 kapsam kanıtı eksikliği ve 20 başlık eksikliği. Eksik alan oranları şöyledir: baskı numarası %62,4, ISBN %49,6, sayfa sayısı %28,2, dil %9,0, yayınevi %7,8, katkı %5,0 ve yayın yeri %1,0. 119 geçersiz ISBN kaydedildi.

Bir milyon benzersiz baskı için kapsama ve çakışma oranları kaynak bazında ölçülmeli. Pilotun temsil alanı dar olduğundan, toplu içe alımda ISBN’siz eserler, aynı ISBN’li yeniden basımlar, farklı taşıyıcılar ve çok ciltli takımlardan bağımsız doğrulama örneği çıkarılmalı. Büyük aktarım için tek yazma süreci ve anahtar tabanlı sayfalama kullanılır. Bir milyon baskı için süre ve depolama kapasitesi ölçümü ayrı bir yük testi gerektirir.

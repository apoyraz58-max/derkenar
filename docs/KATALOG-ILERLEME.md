# Katalog ilerleme günlüğü

Saatlik zamanlanmış çalışma bu dosyayı okuyarak kaldığı yerden devam eder. Yeni girdiler en üste eklenir. Yöntem ve kaynak ayrıntıları `docs/BIBLIYOGRAFIK-KATALOG.md` dosyasında, anlık görüntü özetleri `data/catalog/snapshots/` altındadır.

## Sıradaki adım

0. Yer bilgisi olmayan Crossref kitapları (6572 ISBN) için kapsam kanıtı gerekiyor. Bu ISBN’ler K10plus, DNB ve LoC’de bulunamadı (500 ve 40 ISBN’lik örneklemlerde sıfır isabet). LoC SRU servisi 210 numaralı portta çalışıyor ve vekil sunucu bu bağlantıyı kesiyor (`lx2.loc.gov:210`). Kalan yollar:
   - Yayınevi sitelerinin künye sayfaları. Bunun için kullanıcının alan adlarını onaylaması gerekir.
   - Kullanıcının bir kural kararı vermesi. Öneri: Crossref üye adresinin Türkiye olması ile ISBN’in Türkiye grubunda (978-975, 978-605, 978-625) olması birlikte kapsam kanıtı sayılabilir. Ancak KKTC yayınevleri de Türkiye ISBN ajansını kullanır. Bu nedenle kural otomatik uygulanmamalı, kullanıcıya sorulmalıdır.
1. İnceleme kuyruğu. Baskı numarası ayrıştırması tamamlandı. Kalan kimlik çelişkilerinin büyük bölümünde yayınevi adı farklı yazılmıştır (“İş Bankası Kültür Yayınları” ile “Türkiye İş Bankası Kültür Yayınları”, “Timaş” ile “Timas”). Kanıtlı bir yayınevi adı eşdeğerliği gerekir. Bunun için ISBN yayıncı öneki iyi bir dayanaktır, ancak önek tablosu izin listesi dışındadır. Ayrıca cilt ayrımı (“. 01” ve “. 02” gibi ekler) ele alınmalıdır.
3. DNB (`services.dnb.de`) ve Library of Congress (`lx2.loc.gov`) ile sayfa sayısı ve ISBN gibi eksik alanlar tamamlanmalı. Önce lisans ve kullanım koşulları doğrulanmalı.
4. Yeni açık kaynaklar değerlendirilmeli. Millî Kütüphane toplu verisi kurumla yazışma gerektirir. Bu adım kullanıcıya bildirilecek, otomatik yürütülmeyecek.

## Açık notlar

- Veritabanları konteynerde `work/` altındadır ve konteyner yenilenince silinir. Yeniden kurmak için `scripts/catalog-rebuild.sh` kullanılır. Betik eksik anlık görüntüleri indirir ve yaklaşık 6 dakika sürer. Crossref verisi zamanla değiştiğinden yeniden indirilen dosyanın özeti kayıttan farklı olabilir.
- Özgür 1277 (Yarman/Yaman) incelemede kalır.
- Ağ izin listesi dışındaki alan adları istenmez, bu dosyaya not edilir.

## Günlük

### 2026-11-26 17:55 UTC

- Yapılan: K10plus’ta Türkiye ISBN grubu taraması yapıldı. Önceki sorgulara girmeyen yalnız 647 kayıt kaldı. Bunlar `--only-tr` ile alındı (+33 baskı) ve kurulum betiğine eklendi. Kapsam ölçümü yapıldı: yayın yılı dağılımı kılavuza eklendi. K10plus’taki Türkiye kapsamı büyük ölçüde tükendi. Güncel ticari kitaplar katalogda zayıftır, örneğin 2010’lar için yalnız 37.954 baskı vardır.
- Kaynaklara göre bağlı baskılar: K10plus 168.199, Crossref 5682, DNB 3414, Özgür 1173, DOAB 120.
- Durum: 176.950 benzersiz baskı (+33), 164.374 eser.
- İncelemede 21.442 kayıt var: 7599 kapsam kanıtı eksikliği, 7278 kimlik çelişkisi, 3847 olası mükerrer, 1859 kapsam çelişkisi, 1234 birden çok ISBN ve 22 başlık eksikliği.
- 124 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,1, ISBN %48,5, sayfa sayısı %29,5, dil %8,3, yayınevi %8,1, katkı %4,8, yayın yeri %1,0.
- Testler: 236 geçti. Typecheck ve build temiz. Kod değişmedi, yalnız kurulum betiği ve belgeler değişti.
- Sıradaki: izinli açık kaynaklarda büyük kazanç kalmadı. Büyümenin sürmesi kullanıcı kararlarına bağlı: yayınevi alan adı onayları, Crossref kuralı, Millî Kütüphane başvurusu. Bu arada inceleme kuyruğu kuralları ve eksik alan tamamlama (Crossref ve DNB’den sayfa sayısı) sürdürülebilir.

### 2026-11-26 17:15 UTC

- Yapılan: MARC 245$b’deki paralel başlıklar seçili başlıktan ayrıldı ve `parallelTitle` kanıtı olarak saklandı (7343 kayıt). Katalog yeniden kuruldu (9 dakika 4 saniye).
- Durum: 176.917 benzersiz baskı (−26 çift), 164.341 eser (−131). OCLC ile bağlanan 1085 kayıt, bağlı bölüm 29.651, başlık kararı 6.
- İncelemede 21.438 kayıt var: 7599 kapsam kanıtı eksikliği, 7274 kimlik çelişkisi, 3847 olası mükerrer, 1859 kapsam çelişkisi, 1234 birden çok ISBN ve 22 başlık eksikliği.
- 124 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,1, ISBN %48,5, sayfa sayısı %29,5, dil %8,3, yayınevi %8,1, katkı %4,8, yayın yeri %1,0.
- Testler: 236 geçti. Typecheck ve build temiz.
- Sıradaki: kimlik çelişkilerinin güncel sınıflandırması. Kullanıcı kararı bekleyen sorular: Crossref yersiz kitapları, kimliksiz çift kayıtlar, KKTC.

### 2026-11-26 16:30 UTC

- Yapılan: DNB kimlik çelişkileri sınıflandırıldı. Başlıca neden yayınevi yazımı (“İletişim” / “İletişim Yayınları”, “YKY” / “Yapı Kredi Yayınları”, “Ayrinti”), ikinci neden “7. bas” ve “1. Auf” kısaltmaları. Karşılaştırmaya özel yayınevi anahtarı eklendi ve baskı ifadesi tanımı genişletildi. Seçili değerler değişmedi. Katalog iki kez yeniden kuruldu: ilk kurulum bir test hatası düzeltilmeden yapılmıştı, düzeltmeden sonra yenilendi.
- Durum: 176.943 benzersiz baskı (−150 çift kayıt), 164.472 eser. OCLC ile bağlanan 1074 kayıt, bağlı bölüm 29.651, başlık kararı 6.
- İncelemede 21.465 kayıt var: 7599 kapsam kanıtı eksikliği, 7326 kimlik çelişkisi (önceki 7772), 3812 olası mükerrer, 1859 kapsam çelişkisi, 1234 birden çok ISBN ve 22 başlık eksikliği.
- 124 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,1, ISBN %48,5, sayfa sayısı %29,5, dil %8,3, yayınevi %8,1, katkı %4,8, yayın yeri %1,0.
- Testler: 235 geçti. Typecheck ve build temiz.
- Sıradaki: DNB başlıklarındaki paralel başlıklar (“Kamusallığın Yapısal Dönüşümü: = Strukturwandel …”) başlık anahtarını bozuyor. Karşılaştırmada “= …” ile başlayan paralel başlık kısmı yok sayılmalı.

### 2026-11-26 15:05 UTC

- Yapılan: DNB kaynağı eklendi (CC0, SRU MARC21-xml, sayfa başına 100 kayıt). K10plus sorgu toplayıcısı ortak SRU toplayıcısına dönüştürüldü. DNB’deki 10.197 Türkçe kitap `--only-tr` ile alındı ve kurulum betiğine eklendi.
- Durum: 177.093 benzersiz baskı (+3006), 164.546 eser. DNB kayıtlarından 292’si mevcut baskılara bağlandı, 1300’ü incelemede.
- İncelemede 21.618 kayıt var: 7772 kimlik çelişkisi (+1037, çoğu DNB ile K10plus arasında aynı ISBN’li farklı künye; incelenmeli), 7593 kapsam kanıtı eksikliği, 3498 olası mükerrer, 1859 kapsam çelişkisi, 1234 birden çok ISBN ve 22 başlık eksikliği.
- 124 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,2, ISBN %48,7, sayfa sayısı %29,6, dil %8,4, yayınevi %8,1, katkı %4,8, yayın yeri %1,0.
- Testler: 234 geçti. Typecheck ve build temiz.
- Sıradaki: DNB ve K10plus arasındaki yeni kimlik çelişkileri sınıflandırılmalı.

### 2026-11-26 14:15 UTC

- Yapılan: Türkçe olup önceki sorgulara girmeyen 28.052 K10plus kitabı toplandı ve `--only-tr` süzgeciyle eklendi. Getiri düşük: kayıtların çoğu yurt dışında basılmış ya da yer bilgisi yok. “Derseadet” yazımı tarihî adlara eklendi. Yan bulgu: KKTC şehirleri İSNAD yer listesinde olduğu için Türkiye sayılıyordu (123 baskı). Katalog kapsamında bunlar artık Türkiye sayılmıyor. Ülke kodu Türkiye, yeri KKTC olan kayıtlar kapsam çelişkisi oluyor. Katalog yeniden kuruldu (8 dakika 44 saniye).
- Kullanıcıya soru: KKTC baskıları katalogda yer almalı mı? Tek satırlık bir değişiklikle geri alınabilir.
- Durum: 174.087 benzersiz baskı, 161.741 eser. OCLC ile bağlanan 967 kayıt, bağlı bölüm 29.651, başlık kararı 6.
- İncelemede 20.318 kayıt var: 7593 kapsam kanıtı eksikliği, 6835 kimlik çelişkisi, 3476 olası mükerrer, 1615 kapsam çelişkisi, 1123 birden çok ISBN ve 22 başlık eksikliği.
- 124 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,7, ISBN %49,2, sayfa sayısı %29,8, dil %8,5, yayınevi %8,3, katkı %4,9, yayın yeri %1,0.
- Testler: 233 geçti. Typecheck ve build temiz.

### 2026-11-26 12:55 UTC

- Yapılan: K10plus Türkiye e-kitapları toplandı (ülke kodu sorgusuyla 3617, yayın yeri sorgusuyla 1409 kayıt) ve kataloğa ile kurulum betiğine eklendi. DataCite denendi, ancak ülke süzgeci çalışmıyor (`country=TR` tüm yayıncıları döndürüyor). Bu yüzden bırakıldı.
- Durum: 173.973 benzersiz baskı (+4332), 161.640 eser. 29.651 bölüm bağlı.
- İncelemede 20.228 kayıt var: 7674 kapsam kanıtı eksikliği, 6732 kimlik çelişkisi, 3466 olası mükerrer, 1559 kapsam çelişkisi, 1123 birden çok ISBN ve 22 başlık eksikliği.
- 124 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,7, ISBN %49,1, sayfa sayısı %29,8, dil %8,5, yayınevi %8,3, katkı %4,9, yayın yeri %1,0.
- Testler: 233 geçti. Typecheck ve build temiz. Bu çalıştırmada kod değişmedi, yalnız kurulum betiği ve veriler değişti.

### 2026-11-26 12:00 UTC

- Yapılan: yer tutucu yayınevi ve yer değerleri (“Verlag nicht ermittelbar”, “[s.n.]”, “y.y.” vb.) artık kanıt sayılmıyor. Yıl karşılaştırması tek yıl içeren yazımları aynı yıl sayıyor. Katalog yeniden kuruldu (8 dakika 9 saniye).
- Durum: 169.641 benzersiz baskı (−144), 158.039 eser. Yazım farkı yüzünden yanlışlıkla ayrı baskı sayılan çift kayıtlar birleşti ya da incelemeye alındı. OCLC ile bağlanan kayıt sayısı 963.
- İncelemede 19.802 kayıt var: 7632 kapsam kanıtı eksikliği, 6619 kimlik çelişkisi, 3428 olası mükerrer, 1342 kapsam çelişkisi, 1106 birden çok ISBN ve 20 başlık eksikliği.
- 122 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,2, ISBN %48,2, sayfa sayısı %30,0, dil %8,7, yayınevi %7,9 (yer tutucular çıkarıldı), katkı %4,9, yayın yeri %1,0.
- Testler: 233 geçti. Typecheck ve build temiz.
- Sıradaki: kalan olası mükerrerlerde OCLC numarası olmayan ama sayfa sayısı, yer, yıl ve yayınevi birebir uyuşan çiftler. Bunların otomatik birleştirilmesi kimliksiz benzerlik ilkesine aykırıdır, kullanıcıya sorulmalıdır. Alternatif iş: DNB ve LoC dışındaki açık kaynaklar.

### 2026-11-26 11:00 UTC

- Yapılan: olası mükerrerler incelendi. Çoğu K10plus’ın kendi içindeki ISBN’siz çift kayıtlarıdır. Bunların 913’ü hedefle ortak OCLC numarası taşıyor, 2104’ünde numara farklı, 1239’unda numara yok. MARC adaptörü 035 OCLC numaralarını kanıt olarak okuyor. Künyesi uyuşan tek aday ortak OCLC numarası taşıyorsa kayıt o adaya bağlanıyor ve `oclc-match` ile işaretleniyor. Katalog yeniden kuruldu (7 dakika 53 saniye).
- Durum: 169.785 benzersiz baskı, 158.081 eser. 942 kayıt OCLC ile bağlandı. Bağlanan bölüm sayısı 29.654, başlık kararları 6.
- İncelemede 19.735 kayıt var (önceki 20.675): 7632 kapsam kanıtı eksikliği, 6676 kimlik çelişkisi, 3305 olası mükerrer (önceki 4257), 1342 kapsam çelişkisi, 1106 birden çok ISBN ve 20 başlık eksikliği.
- 122 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,3, ISBN %48,3, sayfa sayısı %30,0, dil %8,8, yayınevi %7,6, katkı %4,9, yayın yeri %0,9.
- Testler: 232 geçti. Typecheck ve build temiz.
- Sıradaki: kalan olası mükerrerler. Yıl yazımları (“(1976)” ile “1976”, “2024-” ile “2024”) ve “Verlag nicht ermittelbar” gibi yer tutucular karşılaştırmayı bozuyor. Bunlar kanıt değeri taşımayan biçim farklarıdır, normalleştirilmeleri gerekir.

### 2026-11-26 09:55 UTC

- Yapılan: geniş kaynaklar için `ingest --only-tr` Türkiye ön süzgeci eklendi. Süzülen kayıtlar saklanmaz ama iş konumunu ilerletir. DOAB bu süzgeçle birleşik kataloğa alındı ve kurulum betiğine eklendi.
- DOAB’ın 115.634 kaydından 209’u saklandı: 152 yeni baskı, 2 eşleşme ve 55 inceleme kaydı. Bölüm bağlantıları 29.654’e çıktı (+1526).
- Durum: 169.787 benzersiz baskı (+152), 158.083 eser.
- İncelemede 20.675 kayıt var: 7632 kapsam kanıtı eksikliği, 6671 kimlik çelişkisi, 4257 olası mükerrer, 1342 kapsam çelişkisi, 1106 birden çok ISBN ve 20 başlık eksikliği.
- 122 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,3, ISBN %48,3, sayfa sayısı %30,1, dil %8,8, yayınevi %7,6, katkı %4,9, yayın yeri %0,9.
- Testler: 231 geçti. Typecheck ve build temiz.
- Sıradaki: olası mükerrerler (4257) için kanıtlı birleştirme kuralları incelenmeli. Crossref’in yersiz kitapları için kullanıcı kararı bekleniyor.

### 2026-11-26 09:05 UTC

- Yapılan: aynı ISBN’i paylaşan çok ciltli takımlarda farklı ciltler artık ayrı baskı sayılıyor. Koşul: başlık cilt eki dışında aynı, yazar ve yayınevi aynı, cilt numarası farklı olmalı. Örnek: “Masonluk Tarihimizde 1920-1924. Cilt 1” ve “… Cilt 3”. Crossref yersiz kitapları için K10plus, DNB ve LoC denendi, isabet yok (ayrıntı “Sıradaki adım” bölümünde). Katalog yeniden kuruldu (8 dakika 14 saniye). Başlık kararları ve bölüm bağlantıları (28.128) korundu.
- Durum: 169.635 benzersiz baskı (+89), 157.934 eser.
- İncelemede 20.620 kayıt var: 7632 kapsam kanıtı eksikliği, 6653 kimlik çelişkisi, 4257 olası mükerrer, 1342 kapsam çelişkisi, 1069 birden çok ISBN ve 20 başlık eksikliği.
- 119 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,2, ISBN %48,3, sayfa sayısı %30,1, dil %8,8, yayınevi %7,6, katkı %4,9, yayın yeri %0,9.
- Testler: 230 geçti. Typecheck ve build temiz.

### 2026-11-26 08:05 UTC

- Yapılan: kitap bölümleri için `parts` tablosu, Crossref bölüm adaptörü, `collect --parts` ve `parts` komutları eklendi. Panelde baskı ayrıntısına bölüm listesi eklendi. Kurulum betiği bölümleri de yüklüyor.
- 50 Crossref yayınevinden 53.621 bölüm toplandı. 28.128’i katalogdaki 1952 baskıya bağlandı. Bağlanmayanların çoğunun kitabı katalogda yoktur.
- Durum: 169.546 benzersiz baskı (değişmedi; bölümler baskı sayılmaz).
- İncelemede 20.709 kayıt var: 7632 kapsam kanıtı eksikliği, 6690 kimlik çelişkisi, 4252 olası mükerrer, 1342 kapsam çelişkisi, 1069 birden çok ISBN ve 20 başlık eksikliği.
- 119 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,2, ISBN %48,3, sayfa sayısı %30,1, dil %8,8, yayınevi %7,6, katkı %4,9, yayın yeri %0,9.
- Testler: 229 geçti. Typecheck ve build temiz.

### 2026-11-26 07:00 UTC

- Yapılan: baskı numarası artık baskı ifadesinden okunuyor (“2. baskı”, “Gözden geçirilmiş 2. baskı”, “II. basım”, “ikinci baskı”, “3. Aufl.”). Aynı ISBN’li yeniden basımlar bu sayede kanıtlı olarak ayrı baskı oluyor. Katalog `scripts/catalog-rebuild.sh` ile yeniden kuruldu (6 dakika 40 saniye). Başlık kararları korundu.
- Durum: 169.546 benzersiz baskı (+170), 157.939 eser.
- İncelemede 20.709 kayıt var: 7632 kapsam kanıtı eksikliği, 6690 kimlik çelişkisi (önceki 6795), 4252 olası mükerrer, 1342 kapsam çelişkisi, 1069 birden çok ISBN ve 20 başlık eksikliği.
- 119 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,2, ISBN %48,3, sayfa sayısı %30,1, dil %8,8, yayınevi %7,6, katkı %4,9, yayın yeri %0,9.
- Testler: 228 geçti. Typecheck ve build temiz.

### 2026-11-26 06:00 UTC

- Yapılan: MARC adaptörü ortak yayınlardaki sonraki yayın yerlerini `otherPlaces` kanıtı olarak saklıyor ve kapsam denetimi bu kanıta da bakıyor. Kataloğu baştan kuran `scripts/catalog-rebuild.sh` eklendi ve katalog bu betikle yeniden kuruldu (6 dakika). 1515 kayıtta ek yayın yeri var.
- Durum: 169.376 benzersiz baskı (+69), 157.939 eser. Türkiye dışı sayılan 125 kayıt kapsam çelişkisi olarak incelemeye alındı (dışarıda kalan 645’ten 520’ye indi).
- İncelemede 20.866 kayıt var: 7632 kapsam kanıtı eksikliği, 6795 kimlik çelişkisi, 4269 olası mükerrer, 1342 kapsam çelişkisi, 1069 birden çok ISBN ve 20 başlık eksikliği.
- 119 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,3, ISBN %48,4, sayfa sayısı %30,2, dil %8,8, yayınevi %7,6, katkı %4,9, yayın yeri %0,9.
- Testler: 226 geçti. Typecheck ve build temiz.
- Sıradaki: inceleme kuyruğu kuralları (aynı ISBN ve kanıtlı farklı baskı numarası, ciltler) veya Crossref bölümleri için `parts` tablosu.

### 2026-11-26 04:55 UTC

- Saatlik çalıştırmalar (00:41–04:41) işçi süreci yeniden başlatıldığı için gecikti ve tek bir çalıştırmada birleştirildi.
- Yapılan: `crossref` kaynak adaptörü ve toplayıcı yazıldı. Türkiye konumlu 86 Crossref üyesinden 12.275 kitap kaydı toplandı. Basılı ve elektronik taşıyıcılar ayrıldı. Yazar, editör ve mütercim rolleri sıralarıyla alındı. URL farkları alan çelişkisi sayılmıyor, 1109 gürültü uyarısı temizlendi.
- Durum: 169.307 benzersiz baskı (+4532), 157.872 eser. 1136 Crossref kaydı mevcut baskılara bağlandı.
- İncelemede 20.810 kayıt var: 7706 kapsam kanıtı eksikliği, 6793 kimlik çelişkisi, 4266 olası mükerrer, 1217 kapsam çelişkisi, 1069 birden çok ISBN ve 20 başlık eksikliği.
- 119 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %63,3, ISBN %48,4, sayfa sayısı %30,2, dil %8,8, yayınevi %7,6, katkı %4,9, yayın yeri %0,9.
- Testler: 225 geçti. Typecheck ve build temiz.

### 2026-11-25 23:45 UTC

- Durum: 164.775 benzersiz baskı, 153.353 eser, 181.436 ham kayıt. Kaynaklar Özgür (1173) ve K10plus’tır (ülke kodu ve yayın yeri sorguları).
- İncelemede 13.868 kayıt var: 6533 kimlik çelişkisi, 4265 olası mükerrer, 1217 kapsam çelişkisi, 1069 birden çok ISBN, 1024 kapsam kanıtı eksikliği ve 20 başlık eksikliği.
- 119 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %62,4, ISBN %49,6, sayfa sayısı %28,2, dil %9,0, yayınevi %7,8, katkı %5,0, yayın yeri %1,0.
- DOAB’ın 171 Türkiye baskısı ayrı veritabanındadır (`work/doab-full.sqlite`) ve ana kataloğa henüz katılmadı.
- Testler: 224 geçti. Typecheck ve build temiz.

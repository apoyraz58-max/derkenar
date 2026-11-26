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

# Katalog ilerleme günlüğü

Saatlik zamanlanmış çalışma bu dosyayı okuyarak kaldığı yerden devam eder. Yeni girdiler en üste eklenir. Yöntem ve kaynak ayrıntıları `docs/BIBLIYOGRAFIK-KATALOG.md` dosyasında, anlık görüntü özetleri `data/catalog/snapshots/` altındadır.

## Sıradaki adım

0. Crossref kitap bölümleri için `parts` tablosu ve adaptör (tasarım notu: BIBLIYOGRAFIK-KATALOG.md, Crossref bölümü). Yer bilgisi olmayan 6942 Crossref kaydı için ISBN önek haritası değerlendirilmeli; tek başına kapsam kanıtı sayılmaz.
1. İnceleme kuyruğunda güvenli otomatik kurallar. Aynı ISBN ve farklı, kanıtlı baskı numarası varsa ayrı baskı oluşturulmalı. ISBN-10/13 eşdeğerliği ve cilt ayrımı ele alınmalı. Kural yalnız kanıtlı alanlara dayanmalı ve testle korunmalı.
3. DNB (`services.dnb.de`) ve Library of Congress (`lx2.loc.gov`) ile sayfa sayısı ve ISBN gibi eksik alanlar tamamlanmalı. Önce lisans ve kullanım koşulları doğrulanmalı.
4. Yeni açık kaynaklar değerlendirilmeli. Millî Kütüphane toplu verisi kurumla yazışma gerektirir. Bu adım kullanıcıya bildirilecek, otomatik yürütülmeyecek.

## Açık notlar

- Veritabanları konteynerde `work/` altındadır ve konteyner yenilenince silinir. Yeniden kurmak için `scripts/catalog-rebuild.sh` kullanılır. Betik eksik anlık görüntüleri indirir ve yaklaşık 6 dakika sürer. Crossref verisi zamanla değiştiğinden yeniden indirilen dosyanın özeti kayıttan farklı olabilir.
- Özgür 1277 (Yarman/Yaman) incelemede kalır.
- Ağ izin listesi dışındaki alan adları istenmez, bu dosyaya not edilir.

## Günlük

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

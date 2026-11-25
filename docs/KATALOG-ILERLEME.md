# Katalog ilerleme günlüğü

Saatlik zamanlanmış çalışma bu dosyayı okuyarak kaldığı yerden devam eder. Yeni girdiler en üste eklenir. Yöntem ve kaynak ayrıntıları `docs/BIBLIYOGRAFIK-KATALOG.md` dosyasında, anlık görüntü özetleri `data/catalog/snapshots/` altındadır.

## Sıradaki adım

1. İnceleme kuyruğunda güvenli otomatik kurallar. Aynı ISBN ve farklı, kanıtlı baskı numarası varsa ayrı baskı oluşturulmalı. ISBN-10/13 eşdeğerliği ve cilt ayrımı ele alınmalı. Kural yalnız kanıtlı alanlara dayanmalı ve testle korunmalı.
2. MARC adaptörü tüm 264$a ve 260$a yerlerini kapsam kanıtı olarak okumalı. Örnek: “Berlin ; İstanbul” ortak yayınları.
3. DNB (`services.dnb.de`) ve Library of Congress (`lx2.loc.gov`) ile sayfa sayısı ve ISBN gibi eksik alanlar tamamlanmalı. Önce lisans ve kullanım koşulları doğrulanmalı.
4. Yeni açık kaynaklar değerlendirilmeli. Millî Kütüphane toplu verisi kurumla yazışma gerektirir. Bu adım kullanıcıya bildirilecek, otomatik yürütülmeyecek.

## Açık notlar

- Veritabanları konteynerde `work/` altındadır ve konteyner yenilenince silinir. `katalog.sqlite` yeniden kurulurken şu sıra izlenir: Özgür KBART, künye, MARC ve başlık kararları (kılavuzdaki tabloya bakın), ardından `work/k10plus-tr.xml` ve `work/k10plus-yer.xml`, en sonda `recheck --source k10plus`.
- Özgür 1277 (Yarman/Yaman) incelemede kalır.
- Ağ izin listesi dışındaki alan adları istenmez, bu dosyaya not edilir.

## Günlük

### 2026-11-25 23:45 UTC

- Durum: 164.775 benzersiz baskı, 153.353 eser, 181.436 ham kayıt. Kaynaklar Özgür (1173) ve K10plus’tır (ülke kodu ve yayın yeri sorguları).
- İncelemede 13.868 kayıt var: 6533 kimlik çelişkisi, 4265 olası mükerrer, 1217 kapsam çelişkisi, 1069 birden çok ISBN, 1024 kapsam kanıtı eksikliği ve 20 başlık eksikliği.
- 119 geçersiz ISBN kaydedildi.
- Eksik alan oranları: baskı numarası %62,4, ISBN %49,6, sayfa sayısı %28,2, dil %9,0, yayınevi %7,8, katkı %5,0, yayın yeri %1,0.
- DOAB’ın 171 Türkiye baskısı ayrı veritabanındadır (`work/doab-full.sqlite`) ve ana kataloğa henüz katılmadı.
- Testler: 224 geçti. Typecheck ve build temiz.

# Künye'yi Word'de deneme

Önce bir tez **kopyasında** deneyin.

## 1. Yayını açın (bir kez)

GitHub'da depo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
`main` dalına her birleştirmede eklenti `https://apoyraz58-max.github.io/derkenar/`
adresine yayımlanır; manifest `https://apoyraz58-max.github.io/derkenar/manifest.xml`.

## 2. Manifesti Word'e yükleyin

**Word Online:** Bir belge açın → **Giriş → Eklentiler** → **Eklentilerim → Eklentimi
Karşıya Yükle** → `manifest.xml`.

**Windows masaüstü:** Manifesti paylaşılan bir klasöre koyun. Word → **Dosya → Seçenekler →
Güven Merkezi → Güven Merkezi Ayarları → Güvenilen Eklenti Katalogları** → `\\BILGISAYAR\klasor`
yolunu ekleyin, "Menüde göster"i işaretleyin, Word'ü yeniden başlatın → **Ekle → Eklentilerim →
Paylaşılan Klasör → Künye**.

**Mac:** Manifesti `~/Library/Containers/com.microsoft.Word/Data/Documents/wef` klasörüne
kopyalayın, Word'ü yeniden başlatın → **Ekle → Eklentilerim**.

Vefeyât ile aynı anda kurulu olabilir; ikisinin sekmeleri ayrıdır.

## 3. Kullanım

| Grup | Komutlar |
| --- | --- |
| Atıf | **Atıf Ekle/Düzenle**, **Kaynakça Ekle/Düzenle**, **Belge Tercihleri**, **Güncelle**, **Düz Metne Çevir** |
| Kütüphane | **Kütüphane**, **Yeni Kaynak** (DOI, ISBN, RIS, dosya, elle), **İçe Aktar**, **Dışa Aktar** |
| İSNAD | **Belgeyi Denetle**, **Kütüphaneyi Denetle** |
| Veri ve yardım | **Veri bilgisi** (kaynak sayıları, saklama, belgedeki kopya, eşitleme, sürüm), **Kullanım kılavuzu** (kısa kılavuz ve Hakkında) |

Sağ tık → **Künye → Atıf ekle**.

1. **Kütüphanenizi alın:** atıf programınızda Dosya → Kütüphaneyi Dışa Aktar → **RDF**
   → Künye → **İçe Aktar** → dosyayı seçin. Koleksiyonlar, notlar ve etiketler gelir.
   Ya da çevrimiçi kütüphane numaranız ve API anahtarınızla eşitleyin.
2. **Yeni kaynak:** **Yeni Kaynak** düğmesi ekleme yollarını gösterir: DOI/ISBN/PMID/arXiv;
   künye yapıştırma (İSNAD, APA, eski usul, liste hâlinde; RIS, BibTeX, DİA Atıf metni);
   iç kapak ve künye sayfası fotoğrafı ya da makale/tez PDF'i; dosya; elle giriş. Elle girişte
   türü seçin; bütün kaynak türleri ve alanları vardır. Kişiler'de rol olarak Muhakkik (thk.),
   Nâşir (nşr.), Hazırlayan (haz.), Sadeleştiren (sad.) da vardır. Tarih alanına hicrî/milâdî
   (1413/1993) yazılabilir. Yazdıkça kaydedilir; üstte canlı önizleme ve İSNAD uyarıları görünür.
3. **Atıf:** arayın (şapka ve Türkçe harf gerekmez), Enter ile sepete ekleyin, **Cilt** ve
   **Sayfa** yazın (1/45 olur), Ctrl+Enter. Atıf yeni dipnota girer.
4. **Otomatik güncelleme:** başka bir şey yapmanız gerekmez. Araya atıf ekleyin, bir dipnotu
   silin ya da taşıyın; atıflar bir iki saniye içinde tam ya da kısa biçime döner. Künye
   penceresi açık olmalıdır; ilk atıftan sonra Word belgeyle birlikte pencereyi de açar.
5. **Düzenleme:** imleci atıfın içine koyun; pencere atıfı açar.
6. **Kaynakça:** imleci tezin sonuna koyup **Kaynakça Ekle/Düzenle**.
7. **Denetim:** **Belgeyi Denetle** → düzeltilebilenler için **Düzelt** ya da
   **Önerilen düzeltmeleri uygula**.
8. **Teslim:** belgenin kopyasını alın → **Düz Metne Çevir**.

## 4. Eski bir çalışmayı taşımak

- **Başka atıf programıyla yazılmış belge:** Belge sekmesinde "Başka programla eklenmiş atıflar"
  → **Künye atıflarına çevir**.
- **Atıf programı olmadan yazılmış tez:** Belge → **Dipnotları tara** (önce liste gösterilir,
  sonra **… dipnotu atıfa çevir**); kaynakçayı seçip **Seçili kaynakçayı oku**; metin içi
  stillerde **Metin içi atıfları tara**.
- Her zaman önce belgenin bir kopyasında deneyin; Word'de Geri Al çalışır.

## 5. Gerçek Word'de denenmesi gerekenler

Bunlar geliştirme sırasında yalnız taklit bir Word'de denendi. Bir kopya belgede deneyip
sonucu bildirirseniz çok işe yarar:

1. **Dipnotları tara:** el yazısı dipnotlu bir bölüm (tam künye, kısa künye, a.g.e., "Bk.",
   a.mlf., yazma eser 77b, sözlük maddesi, âyet). Dipnot numaraları yerinde kalmalı, metin
   Künye atıfı olmalı, açıklamalı dipnotlar değişmemeli.
2. **Seçili kaynakçayı oku:** el yazısı kaynakçayı seçin; hepsi okunursa yerine Künye
   kaynakçası gelmeli.
3. **Metin içi atıfları tara:** APA ya da İSNAD metin içi bir belgede "(Kara, 2005: 45)".
4. **Fotoğraftan ya da PDF'ten ekle:** iç kapak + künye sayfası fotoğrafı; bir makale PDF'i.
5. **Şahıslar tablosu:** Aktar'dan yükleyin; belgeyi İngilizceye alınca adlar EI3 olmalı;
   İngilizce bir paragrafı seçip **Seçili metindeki adları EI3 yazımına çevir**.
6. **Arama kutusuna künye yapıştırma:** Atıf sekmesinde "＋ … kütüphaneye ekle ve atıfa koy".
   Sonunda sayfası olan eski usul bir dipnot da olur ("…, Dergâh Yay., İstanbul 2005, s. 45.").
7. **Stil değiştirme, iki atıflı dipnot:** bir dipnotta iki ayrı atıf olsun (yalnız atıf, açıklama
   yok). İSNAD metin içine geçince metinde tek atıf "(…; …)" olmalı; dipnotluya dönünce tek dipnot.

## Bilinen sınırlar

- Dipnot ve sonnot Word 2019, Microsoft 365 veya Word Online ister (WordApi 1.5); Word 2016'da
  atıf metne eklenir ve otomatik izleme yalnız metindeki atıflarda çalışır.
- Otomatik güncelleme pencere açıkken çalışır. Pencere kapalıyken yapılan değişiklikler, pencere
  açılınca ilk saniyede düzeltilir.
- Dipnotlu stilden metin içi stile geçişte yalnız atıf içeren dipnotlar metne taşınır (bir dipnotta
  birden çok atıf varsa metinde tek atıf olur: "(Kara, 2005: 45; Aydın, 2010: 12)"); içinde açıklama
  da olan dipnotlar açıklama dipnotu olarak kalır, içlerindeki atıflar metin içi biçimiyle yazılır.
- Atıf metnini Word'de elle değiştirirseniz Künye onun üzerine yazmaz; Denetim'de "Elle
  yazılanı koru" ya da "Künye'nin metnine dön" seçilir.
- Vefat tarihleri Künye'nin işi değildir (Vefeyât eklentisi).

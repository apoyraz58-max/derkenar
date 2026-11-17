# Derkenar'ı Word'de deneme

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
Paylaşılan Klasör → Derkenar**.

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

Sağ tık → **Derkenar → Atıf ekle**.

1. **Kütüphanenizi alın:** atıf programınızda Dosya → Kütüphaneyi Dışa Aktar → **RDF**
   → Derkenar → **İçe Aktar** → dosyayı seçin. Koleksiyonlar, notlar ve etiketler gelir.
   Ya da çevrimiçi kütüphane numaranız ve API anahtarınızla eşitleyin.
2. **Yeni kaynak:** **Yeni Kaynak** düğmesi ekleme yollarını gösterir: DOI/ISBN/PMID/arXiv, RIS ya da BibTeX metni yapıştırma, dosya, elle giriş. Elle girişte türü seçin; bütün kaynak türleri ve alanları vardır. Kişiler'de rol
   olarak Muhakkik (thk.), Nâşir (nşr.), Hazırlayan (haz.), Sadeleştiren (sad.) da vardır.
   Tarih alanına hicrî/milâdî (1413/1993) yazılabilir. Yazdıkça kaydedilir; üstte İSNAD
   uyarıları görünür.
3. **Atıf:** arayın (şapka ve Türkçe harf gerekmez), Enter ile sepete ekleyin, **Cilt** ve
   **Sayfa** yazın (1/45 olur), Ctrl+Enter. Atıf yeni dipnota girer.
4. **Otomatik güncelleme:** başka bir şey yapmanız gerekmez. Araya atıf ekleyin, bir dipnotu
   silin ya da taşıyın; atıflar bir iki saniye içinde tam ya da kısa biçime döner. Derkenar
   penceresi açık olmalıdır; ilk atıftan sonra Word belgeyle birlikte pencereyi de açar.
5. **Düzenleme:** imleci atıfın içine koyun; pencere atıfı açar.
6. **Kaynakça:** imleci tezin sonuna koyup **Kaynakça Ekle/Düzenle**.
7. **Denetim:** **Belgeyi Denetle** → düzeltilebilenler için **Düzelt** ya da
   **Önerilen düzeltmeleri uygula**.
8. **Teslim:** belgenin kopyasını alın → **Düz Metne Çevir**.

## Bilinen sınırlar (0.2)

- Stil şimdilik yalnız İSNAD 2 (dipnotlu ve metin içi).
- Dipnot ve sonnot Word 2019, Microsoft 365 veya Word Online ister (WordApi 1.5); Word 2016'da
  atıf metne eklenir ve otomatik izleme yalnız metindeki atıflarda çalışır.
- Otomatik güncelleme pencere açıkken çalışır. Pencere kapalıyken yapılan değişiklikler, pencere
  açılınca ilk saniyede düzeltilir.
- Dipnotlu stilden metin içi stile geçişte yalnız atıf içeren dipnotlar metne taşınır; içinde açıklama da
  olan dipnotlar yerinde kalır (sayısı bildirilir).
- Atıf metnini elle değiştirirseniz bir sonraki güncellemede üzerine yazılır.
- PDF okuyucu ve tarayıcı eklentisi yok.

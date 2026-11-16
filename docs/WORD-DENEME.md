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
| Atıf | **Atıf ekle**, **Kaynakça**, **Güncelle** |
| Stil | **Stil ▾** (İSNAD 2 dipnotlu/metin içi, APA 7, Chicago 18, MLA 9, Harvard, IEEE) |
| Kaynaklar | **Kütüphane**, **Belgedeki atıflar** |
| Teslim | **Düz metne çevir** |

Sağ tık → **Derkenar → Atıf ekle**.

1. **Kütüphane:** Zotero numaranızı ve yalnız okuma izinli API anahtarınızı yazıp **Eşitle**
   (zotero.org → Settings → Security → Applications). Ya da BibTeX/RIS/CSL JSON dosyası seçin.
   Zotero 7 bilgisayarınızda açıksa "Bu bilgisayardaki Zotero 7" seçeneğiyle anahtarsız
   eşitlenir (Zotero → Ayarlar → Gelişmiş → yerel API izni).
2. **Atıf ekle:** yazar/başlık/yıl yazın (şapka ve Türkçe harf gerekmez), Enter ile sepete
   ekleyin, sayfayı yazın, Ctrl+Enter. Dipnotlu stilde atıf yeni dipnota girer.
3. **Düzenleme:** imleci atıfın içine koyun, pencere atıfı açar; sayfayı değiştirip
   **Atıfı güncelle**.
4. **Kaynakça:** imleci tezin sonuna koyup **Kaynakça**. Sonraki her atıfla güncellenir.
5. **Teslim:** belgenin kopyasını alın → **Düz metne çevir**.

## Bilinen sınırlar (0.1)

- Dipnot ekleme Word 2019 / Microsoft 365 / Word Online ister (WordApi 1.5). Word 2016'da
  atıf metne eklenir.
- Dipnotlu stilden metin içi stile (veya tersine) geçişte mevcut atıflar yerinde kalır;
  yalnız biçimleri değişir.
- Atıfın metnini elle değiştirirseniz bir sonraki güncellemede üzerine yazılır.
- Küçük büyük harf (small caps) biçimi Word'e aktarılmaz.

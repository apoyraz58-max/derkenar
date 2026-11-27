#!/usr/bin/env bash
# Toplu iş: her adım kaldığı yerden sürer; yeniden çalıştırmak yeterli.
#  1. Kaynak aktarımları (bitmişse hemen çıkar), her kaynak kendi sürecinde ve istek sınırında.
#  2. DergiPark dergi arşivleri: cilt/sayı -> gerçek yayın tarihi, dergi ISSN'i.
#  3. Crossref: önce önek bazında toplu sorgu (DOI doğrulama + kaynakta yazılmamış DOI'leri bulma),
#     sonra kalan DOI'ler tek tek. Crossref'e aynı anda tek süreç gider.
#  4. Arşiv bitince bütün makalelerin künyesi yeniden üretilir (İSNAD denetimi kuralları).
cd "$(dirname "$0")"
mkdir -p log
for s in dergipark trdizin isam; do
  python3 -u catalog.py run --sources "$s" --groups 0 --group-pages 50 --verify 0 --no-export >> "log/$s.log" 2>&1 &
done
python3 -u catalog.py dp-archive >> log/dp-archive.log 2>&1 &
ARCH=$!
( python3 -u catalog.py crossref-bulk >> log/crossref-bulk.log 2>&1
  python3 -u catalog.py verify-loop --batch 2000 --export-every 900 >> log/verify.log 2>&1 ) &
wait "$ARCH"
python3 -u catalog.py rebuild-all >> log/rebuild.log 2>&1 &
wait
python3 catalog.py export && python3 catalog.py report > rapor/son-rapor.md

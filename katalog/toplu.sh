#!/usr/bin/env bash
# Toplu aktarım: her kaynak ayrı süreçte (farklı sunucular, kendi istek sınırlarıyla),
# DOI doğrulama + CSV + genel rapor ayrı süreçte. Yeniden çalıştırınca kaldığı yerden sürer.
cd "$(dirname "$0")"
mkdir -p log
for s in dergipark trdizin isam; do
  nohup python3 -u catalog.py run --sources "$s" --groups 0 --group-pages 50 --verify 0 --no-export >> "log/$s.log" 2>&1 &
done
nohup python3 -u catalog.py verify-loop --batch 2000 --export-every 900 >> log/verify.log 2>&1 &
wait
python3 catalog.py export && python3 catalog.py report > rapor/son-rapor.md

#!/usr/bin/env bash
# Birleşik katalog veritabanını work/ altındaki anlık görüntülerden baştan kurar.
# Kullanım: scripts/catalog-rebuild.sh [hedef.sqlite]   (varsayılan: work/katalog.sqlite)
# Eksik anlık görüntüler indirilir; özetler data/catalog/snapshots/ kaydıyla karşılaştırılmalıdır.
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:-work/katalog.sqlite}"
tmp="${target%.sqlite}.yeni.sqlite"
cat() { node --no-warnings scripts/catalog.mjs "$@"; }
export NODE_USE_ENV_PROXY=1
mkdir -p work
[ -f work/ozgur.tsv ] || cat collect --source ozgur-kbart --file work/ozgur.tsv
[ -f work/ozgur.xml ] || cat collect --source ozgur --file work/ozgur.xml
[ -f work/k10plus-tr.xml ] || cat collect --source k10plus --query "pica.lcd=XB-TR and pica.mat=B" --file work/k10plus-tr.xml
if [ ! -f work/k10plus-yer.xml ]; then
  query=$(node -e 'const d=require("./data/catalog/snapshots/2026-11-25.json");console.log(d.snapshots.find(s=>s.file==="work/k10plus-yer.xml").query)')
  cat collect --source k10plus --query "$query" --file work/k10plus-yer.xml
fi
[ -f work/k10plus-tr-e.xml ] || cat collect --source k10plus --query "pica.lcd=XB-TR and pica.mat=O" --file work/k10plus-tr-e.xml
if [ ! -f work/k10plus-yer-e.xml ]; then
  query=$(node -e 'const d=require("./data/catalog/snapshots/2026-11-25.json");console.log(d.snapshots.find(s=>s.file==="work/k10plus-yer-e.xml").query)')
  cat collect --source k10plus --query "$query" --file work/k10plus-yer-e.xml
fi
if [ ! -f work/k10plus-tur.xml ]; then
  query=$(node -e 'const d=require("./data/catalog/snapshots/2026-11-25.json");console.log(d.snapshots.find(s=>s.file==="work/k10plus-tur.xml").query)')
  cat collect --source k10plus --query "$query" --file work/k10plus-tur.xml
fi
[ -f work/doab.xml ] || cat collect --source doab --file work/doab.xml
[ -f work/crossref-tr.jsonl ] || cat collect --source crossref --file work/crossref-tr.jsonl
[ -f work/crossref-bolum.jsonl ] || cat collect --source crossref --parts --file work/crossref-bolum.jsonl
rm -f "$tmp" "$tmp-shm" "$tmp-wal"

# Özgür: KBART ilk 200, PDF künyeleri, MARC ilk 200 ve başlık kararları (docs/BIBLIYOGRAFIK-KATALOG.md tablosu).
cat ingest --db "$tmp" --source ozgur-kbart --file work/ozgur.tsv --limit 200
cat ingest --db "$tmp" --source ozgur-kunye --file data/catalog/pilot/ozgur-kunye.jsonl
cat recheck --db "$tmp" --source ozgur-kbart
cat approve-title --db "$tmp" --raw-id 2 --id 11 --reason "KBART ve MARCXML 245 (ozgur1447): 'Purchase Intentions'; PDF s. 2 künyesi: 'Purchase Intention'. ISBN 9786255019318 ve DOI 10.58830/ozgur.pub1447 aynı baskıyı gösteriyor; fark tekil/çoğul yazım varyantı."
cat approve-title --db "$tmp" --raw-id 143 --id 36 --reason "KBART ve MARCXML 245 (ozgur1287) alt başlığı iki nokta ve virgüllerle veriyor; PDF s. 1–2 künyesi noktalamasız ve 've' bağlacı olmadan. ISBN 9786258998535 ve DOI 10.58830/ozgur.pub1287 aynı baskıyı gösteriyor; fark noktalamadan ibaret."
cat approve-title --db "$tmp" --raw-id 150 --id 37 --reason "KBART ve MARCXML 245 (ozgur1279): 'Antioxidant Defense, and'; PDF s. 1–2 künyesi: 'Antioxidant Defence and'. ISBN 9786258998634 ve DOI 10.58830/ozgur.pub1279 aynı baskıyı gösteriyor; fark Amerikan/İngiliz yazımı ve virgül."
cat ingest --db "$tmp" --source ozgur --file work/ozgur.xml --limit 200
cat recheck --db "$tmp" --source ozgur-kbart
cat approve-title --db "$tmp" --raw-id 416 --id 36 --reason "MARCXML 245 (ozgur1287) KBART başlığıyla aynı; PDF s. 1–2 künyesinden farkı yalnız noktalama ve 've' bağlacı. ISBN 9786258998535 ve DOI 10.58830/ozgur.pub1287 aynı baskıyı gösteriyor."
cat approve-title --db "$tmp" --raw-id 423 --id 37 --reason "MARCXML 245 (ozgur1279) KBART başlığıyla aynı; PDF s. 1–2 künyesinden farkı 'Defense/Defence' yazımı ve virgül. ISBN 9786258998634 ve DOI 10.58830/ozgur.pub1279 aynı baskıyı gösteriyor."
cat approve-title --db "$tmp" --raw-id 275 --id 11 --reason "MARCXML 245 (ozgur1447) KBART başlığıyla aynı ('Purchase Intentions'); PDF s. 2 künyesi 'Purchase Intention'. ISBN 9786255019318 ve DOI 10.58830/ozgur.pub1447 aynı baskıyı gösteriyor. Ayrıca yazar yazımı farklı: KBART first_author ve MARC 100 'Bağçı', MARC 700 'Yılmaz, Sude Dilah Serez'; PDF künyesi 'Bağcı' ve 'Serez Yılmaz, Sude Dilah'. Seçili katkı PDF künyesinde kalır; ad farkı ayrıca incelenmeli."
cat ingest --db "$tmp" --source ozgur --file work/ozgur.xml
cat ingest --db "$tmp" --source ozgur-kbart --file work/ozgur.tsv
cat recheck --db "$tmp" --source ozgur-kbart

# K10plus, ardından Crossref.
cat ingest --db "$tmp" --source k10plus --file work/k10plus-tr.xml
cat ingest --db "$tmp" --source k10plus --file work/k10plus-yer.xml
cat ingest --db "$tmp" --source k10plus --file work/k10plus-tr-e.xml
cat ingest --db "$tmp" --source k10plus --file work/k10plus-yer-e.xml
cat ingest --db "$tmp" --source k10plus --file work/k10plus-tur.xml --only-tr
cat recheck --db "$tmp" --source k10plus --limit 10000
cat ingest --db "$tmp" --source crossref --file work/crossref-tr.jsonl
cat recheck --db "$tmp" --source crossref --limit 10000
cat ingest --db "$tmp" --source doab --file work/doab.xml --only-tr
cat parts --db "$tmp" --file work/crossref-bolum.jsonl

mv -f "$tmp" "$target"
rm -f "$tmp-shm" "$tmp-wal" "$target-shm" "$target-wal"
cat stats --db "$target" > /dev/null
echo "Katalog kuruldu: $target"

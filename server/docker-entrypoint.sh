#!/bin/sh
# Старт backend в облаке:
#  1. восстановить базу из копии Litestream в B2 (если копия есть);
#  2. если копии ещё нет — взять первоначальную базу, загруженную scripts/seed-b2.mjs;
#  3. запустить сервер под Litestream — каждое изменение базы уходит в B2.
set -e
mkdir -p /data

# Регион B2 из адреса: https://s3.us-east-005.backblazeb2.com → us-east-005
export B2_REGION="${B2_REGION:-$(echo "$B2_ENDPOINT" | sed -E 's#^https?://s3\.([^.]+)\..*#\1#')}"

litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists /data/app.db

if [ ! -f /data/app.db ]; then
  node /app/scripts/restore-seed.mjs /data/app.db || echo "Первичной базы нет — стартуем с пустой"
fi

exec litestream replicate -config /etc/litestream.yml -exec "npx tsx src/index.ts"

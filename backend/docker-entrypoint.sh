#!/bin/sh
set -eu
echo "prisma migrate deploy"
i=0
until npx prisma migrate deploy; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "migrate failed"
    exit 1
  fi
  echo "database not ready, retry ${i}"
  sleep 2
done
echo "starting api"
exec node dist/index.js

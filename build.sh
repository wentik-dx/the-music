#!/usr/bin/env bash
# The Music v1.2 — подготовка десктопной PWA.
#   bash desktop/build.sh          — только скопировать бандл приложения
#   bash desktop/build.sh serve    — скопировать и поднять локальный сервер на :8080
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/assets/app.html"
DST="$HERE/app.html"

if [ ! -f "$SRC" ]; then
  echo "[desktop] Нет $SRC" >&2
  echo "[desktop] Сначала собрал бандл: cd '$ROOT' && ./build_apk.sh (или tools/pack_web.py)" >&2
  exit 1
fi

cp -f "$SRC" "$DST"
echo "[desktop] app.html обновлён: $(wc -c < "$DST") байт"
echo "[desktop] PWA: $HERE/index.html"

if [ "${1:-}" = "serve" ]; then
  echo "[desktop] Сервер: http://127.0.0.1:8080/"
  echo "[desktop] Открой в Chrome/Edge → меню → «Установить приложение»."
  exec python3 -m http.server 8080 --directory "$HERE"
fi

echo "[desktop] Запусти 'bash desktop/build.sh serve', чтобы открыть PWA на http://127.0.0.1:8080/"

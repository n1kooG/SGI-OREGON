#!/usr/bin/env bash
# Genera despliegue/sgi-oregon-eb.zip para subirlo a Elastic Beanstalk: backend (sin tests ni .env), frontend compilado
# y los SQL (sin los datos de ejemplo). Uso, desde cualquier carpeta:  bash despliegue/empaquetar.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
(cd "$RAIZ/frontend" && npm ci && npm run build)
cp -R "$RAIZ/despliegue/eb/." "$TMP/"
mkdir -p "$TMP/backend" "$TMP/frontend" "$TMP/db"
cp -R "$RAIZ/backend/src" "$RAIZ/backend/scripts" "$RAIZ/backend/package.json" "$RAIZ/backend/package-lock.json" "$TMP/backend/"
cp -R "$RAIZ/frontend/dist" "$TMP/frontend/dist"
cp "$RAIZ"/db/*.sql "$TMP/db/"; rm -f "$TMP/db/02_datos_ejemplo.sql"
SALIDA="$RAIZ/despliegue/sgi-oregon-eb.zip"; rm -f "$SALIDA"
(cd "$TMP" && zip -qr "$SALIDA" . -x '*.DS_Store')
echo "Paquete: $SALIDA ($(du -h "$SALIDA" | cut -f1))"
unzip -l "$SALIDA" | grep -E "\.env|node_modules|storage-local|02_datos" && { echo "ERROR: el paquete contiene archivos que no deben ir"; exit 1; } || true

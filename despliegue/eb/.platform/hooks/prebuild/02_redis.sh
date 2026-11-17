#!/bin/bash
# Redis local (caché de KPI, TTL 30 s, como en el informe): solo 127.0.0.1 y 128 MB. No es fatal: sin Redis la API degrada (X-Cache: OFF).
if ! command -v redis6-server >/dev/null 2>&1; then dnf install -y redis6 || { echo "Redis no instalado: la API seguirá sin caché"; exit 0; }; fi
CONF=/etc/redis6/redis6.conf
sed -i -E 's/^#? ?bind .*/bind 127.0.0.1 -::1/; s/^#? ?maxmemory [^-p].*/maxmemory 128mb/; s/^#? ?maxmemory-policy .*/maxmemory-policy allkeys-lru/' "$CONF"
grep -q '^maxmemory ' "$CONF" || echo 'maxmemory 128mb' >> "$CONF"
grep -q '^maxmemory-policy' "$CONF" || echo 'maxmemory-policy allkeys-lru' >> "$CONF"
systemctl enable --now redis6 || echo "Redis no arrancó: la API seguirá sin caché"
exit 0

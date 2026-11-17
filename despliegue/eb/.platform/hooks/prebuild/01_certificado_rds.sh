#!/bin/bash
# Paquete de CA de RDS para DB_SSL=true (DB_SSL_CA=/etc/ssl/rds/global-bundle.pem). Si falla, el despliegue falla: sin él la API no conecta.
set -euo pipefail
mkdir -p /etc/ssl/rds
curl -fsSL --retry 3 -o /etc/ssl/rds/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
grep -q 'BEGIN CERTIFICATE' /etc/ssl/rds/global-bundle.pem
chmod 644 /etc/ssl/rds/global-bundle.pem

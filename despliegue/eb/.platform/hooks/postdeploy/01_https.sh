#!/bin/bash
# HTTPS con Let's Encrypt en la misma instancia (single instance, sin balanceador). Se activa solo si existe la variable DOMINIO.
# Nunca hace fallar el despliegue: si algo sale mal la app sigue respondiendo por HTTP.
DOMINIO="$(/opt/elasticbeanstalk/bin/get-config environment -k DOMINIO 2>/dev/null)"
[ -z "$DOMINIO" ] && { echo "DOMINIO no definido: sin HTTPS"; exit 0; }
(
  set -euo pipefail
  mkdir -p /var/www/acme
  if [ ! -x /opt/certbot/bin/certbot ]; then
    dnf install -y python3-pip augeas-libs cronie
    python3 -m venv /opt/certbot
    /opt/certbot/bin/pip install --quiet certbot
    systemctl enable --now crond
  fi
  if [ ! -d "/etc/letsencrypt/live/$DOMINIO" ]; then
    /opt/certbot/bin/certbot certonly --webroot -w /var/www/acme -d "$DOMINIO" \
      --register-unsafely-without-email --agree-tos --non-interactive
  fi
  cat > /etc/nginx/conf.d/https.conf <<NGINX
server {
    listen 443 ssl;
    server_name $DOMINIO;
    ssl_certificate     /etc/letsencrypt/live/$DOMINIO/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMINIO/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 20M;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
NGINX
  echo '17 3 * * * root /opt/certbot/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"' > /etc/cron.d/certbot-renovar
  nginx -t
  systemctl reload nginx
  echo "HTTPS activo en $DOMINIO"
) || echo "AVISO: no se pudo activar HTTPS (la app sigue por HTTP); revisa /var/log/eb-hooks.log"
exit 0

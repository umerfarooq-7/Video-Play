#!/usr/bin/env bash
#
# Full production setup: website + transcode worker + nginx + HTTPS.
#
# Run as root on a fresh Ubuntu 22.04/24.04 server. Idempotent — safe to run
# again to redeploy.
#
# Expects /root/vtube.env to already exist with the application configuration
# (written separately so secrets never appear in this file or in argv).

set -euo pipefail

REPO_URL="https://github.com/umerfarooq-7/Video-Play.git"
APP_DIR="/opt/vtube"
ENV_SRC="/root/vtube.env"
NODE_MAJOR=22

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root"
[[ -f "$ENV_SRC" ]] || fail "$ENV_SRC is missing"

# shellcheck disable=SC1090
set -a; source "$ENV_SRC"; set +a
DOMAIN="${SITE_DOMAIN:?SITE_DOMAIN must be set in $ENV_SRC}"
LE_EMAIL="${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL must be set in $ENV_SRC}"

# ---------------------------------------------------------------------------
# Packages
# ---------------------------------------------------------------------------

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg ffmpeg nginx ufw \
  certbot python3-certbot-nginx >/dev/null

command -v ffmpeg  >/dev/null || fail "ffmpeg failed to install"
command -v ffprobe >/dev/null || fail "ffprobe failed to install"

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi

echo "    node $(node -v) · ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

# The repository is private, so a plain clone would prompt for credentials and
# fail on a headless box. SKIP_SOURCE=1 means the code was uploaded separately
# (see deploy/push-code.sh); otherwise a deploy key must be installed first.
if [[ "${SKIP_SOURCE:-0}" == "1" ]]; then
  [[ -f "$APP_DIR/package.json" ]] || fail "SKIP_SOURCE=1 but no source found in $APP_DIR"
  log "Using the source already in $APP_DIR"
elif [[ -d "$APP_DIR/.git" ]]; then
  log "Updating checkout"
  git -C "$APP_DIR" fetch --quiet origin main
  git -C "$APP_DIR" reset --quiet --hard origin/main
else
  log "Cloning repository"
  rm -rf "$APP_DIR"
  git clone --quiet --depth 1 "$REPO_URL" "$APP_DIR" \
    || fail "Clone failed — the repository is private. Install a deploy key, or upload the source and re-run with SKIP_SOURCE=1"
fi

# The build inlines NEXT_PUBLIC_* values, so config must land before it runs.
install -m 600 "$ENV_SRC" "$APP_DIR/.env"
mkdir -p /var/lib/vtube-media

cd "$APP_DIR"

log "Installing dependencies"
# Dev dependencies are needed: the production build runs the TypeScript and
# Tailwind toolchain.
npm ci --no-audit --no-fund --silent

log "Building the site (this takes a few minutes)"
npm run build

# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------

log "Registering services"

cat > /etc/systemd/system/vtube-site.service <<UNIT
[Unit]
Description=VTube website
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/vtube-worker.service <<UNIT
[Unit]
Description=VTube transcode worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/worker/index.mjs
Restart=always
RestartSec=10
# A cut runs for minutes; let it finish rather than being killed mid-encode.
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --quiet vtube-site vtube-worker
systemctl restart vtube-site vtube-worker

# ---------------------------------------------------------------------------
# nginx
# ---------------------------------------------------------------------------

log "Configuring nginx"

cat > /etc/nginx/sites-available/vtube <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    # Video bytes are served by the CDN, so nothing large passes through here.
    # This only needs to cover ordinary form posts.
    client_max_body_size 32M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        # view_hash salts the real client address; without this every visitor
        # would look like 127.0.0.1 and view de-duplication would collapse.
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";

        proxy_read_timeout 300s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/vtube /etc/nginx/sites-enabled/vtube
rm -f /etc/nginx/sites-enabled/default

nginx -t >/dev/null 2>&1 || fail "nginx configuration is invalid"
systemctl reload nginx

# ---------------------------------------------------------------------------
# Firewall
# ---------------------------------------------------------------------------

log "Configuring firewall"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# HTTPS
# ---------------------------------------------------------------------------

log "Requesting the HTTPS certificate"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
     --non-interactive --agree-tos --email "$LE_EMAIL" --redirect >/dev/null 2>&1; then
  echo "    certificate installed; renewal is automatic"
else
  warn "certbot failed — usually DNS has not propagated yet."
  warn "Re-run once it has:  certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

log "Status"
for unit in vtube-site vtube-worker nginx; do
  printf '    %-16s %s\n' "$unit" "$(systemctl is-active "$unit")"
done

echo
echo "    Site:   https://${DOMAIN}"
echo "    Logs:   journalctl -u vtube-site -f"
echo "            journalctl -u vtube-worker -f"
echo "    Deploy: cd ${APP_DIR} && git pull && npm ci && npm run build && systemctl restart vtube-site vtube-worker"
echo

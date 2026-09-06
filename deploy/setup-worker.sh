#!/usr/bin/env bash
#
# One-shot setup for the transcode worker on a fresh Ubuntu VPS.
#
# The website itself is NOT hosted here — it stays on Vercel. This machine only
# runs the background worker that cuts promos, which needs ffmpeg and a
# long-running process, neither of which a serverless host can provide.
#
# Usage, as root on a fresh Ubuntu 22.04 or 24.04 server:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/umerfarooq-7/Video-Play/main/deploy/setup-worker.sh)
#
# It asks for the same values that are in .env.local, installs everything, and
# registers the worker as a systemd service so it survives reboots and crashes.

set -euo pipefail

REPO_URL="https://github.com/umerfarooq-7/Video-Play.git"
APP_DIR="/opt/vtube"
SERVICE="vtube-worker"
NODE_MAJOR=22

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run this as root:  sudo bash $0"

# ---------------------------------------------------------------------------
# Collect configuration
#
# Prompted rather than baked in, so the file never carries someone's service
# key into a public repository.
# ---------------------------------------------------------------------------

ask() {
  local prompt="$1" var="$2" silent="${3:-no}" value=""
  while [[ -z "$value" ]]; do
    if [[ "$silent" == "secret" ]]; then
      read -rsp "$prompt: " value < /dev/tty; echo
    else
      read -rp "$prompt: " value < /dev/tty
    fi
    [[ -z "$value" ]] && echo "  (required)"
  done
  printf -v "$var" '%s' "$value"
}

log "Configuration — copy these from your .env.local"
ask "Supabase URL (https://xxx.supabase.co)" SUPABASE_URL
ask "Supabase SERVICE ROLE key" SERVICE_KEY secret
ask "Bunny library ID" BUNNY_LIB
ask "Bunny API key" BUNNY_KEY secret
ask "Bunny CDN host (https://vz-xxxx.b-cdn.net)" CDN_BASE
ask "Public site URL (https://your-site.vercel.app)" SITE_URL

# ---------------------------------------------------------------------------
# Packages
# ---------------------------------------------------------------------------

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg ffmpeg >/dev/null

# ffmpeg is the whole reason this machine exists; stop early if it is missing.
command -v ffmpeg >/dev/null || fail "ffmpeg failed to install"
command -v ffprobe >/dev/null || fail "ffprobe failed to install"

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi

log "Versions"
echo "  node   $(node -v)"
echo "  ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

if [[ -d "$APP_DIR/.git" ]]; then
  log "Updating existing checkout"
  git -C "$APP_DIR" fetch --quiet origin main
  git -C "$APP_DIR" reset --quiet --hard origin/main
else
  log "Cloning repository"
  rm -rf "$APP_DIR"
  git clone --quiet --depth 1 "$REPO_URL" "$APP_DIR"
fi

log "Installing dependencies"
cd "$APP_DIR"
# The worker needs only runtime deps; skipping dev deps keeps the install small
# and avoids pulling the whole Next.js build toolchain onto the server.
npm install --omit=dev --no-audit --no-fund --silent

log "Writing configuration"
cat > "$APP_DIR/.env" <<ENVFILE
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
VIDEO_PROVIDER=bunny
VIDEO_PROVIDER_LIBRARY_ID=${BUNNY_LIB}
VIDEO_PROVIDER_API_KEY=${BUNNY_KEY}
VIDEO_CDN_BASE_URL=${CDN_BASE}
NEXT_PUBLIC_SITE_URL=${SITE_URL}
LOCAL_MEDIA_ROOT=/var/lib/vtube-media
ENVFILE

# Contains a service-role key: readable by root only.
chmod 600 "$APP_DIR/.env"
mkdir -p /var/lib/vtube-media

# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

log "Registering the worker as a service"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
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
StandardOutput=journal
StandardError=journal

# A cut can run for minutes; give it room to stop cleanly rather than being
# killed mid-encode and leaving a half-written file behind.
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --quiet "$SERVICE"
systemctl restart "$SERVICE"

sleep 3

log "Done"
if systemctl is-active --quiet "$SERVICE"; then
  echo "  The worker is running and will restart automatically on reboot."
else
  echo "  The worker did not start. Check the log with:"
  echo "    journalctl -u ${SERVICE} -n 50"
fi

cat <<'NEXT'

  Useful commands:
    systemctl status vtube-worker      # is it running?
    journalctl -u vtube-worker -f      # watch what it is doing
    systemctl restart vtube-worker     # restart it

  To deploy later changes:
    cd /opt/vtube && git pull && npm install --omit=dev && systemctl restart vtube-worker

NEXT

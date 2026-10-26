#!/usr/bin/env bash
# ==============================================================================
# PS-036: PQC DNSSEC MTL Benchmark Testbed
# Cloudflare Tunnel Launcher for Zero-Trust Remote Hosting
# ==============================================================================
set -euo pipefail
cd "$(dirname "$0")"

C_CYAN='\033[1;36m'
C_GRN='\033[1;32m'
C_YEL='\033[1;33m'
C_RED='\033[1;31m'
C_OFF='\033[0m'

say()  { echo -e "${C_GRN}==>${C_OFF} $*"; }
warn() { echo -e "${C_YEL}!!${C_OFF} $*"; }
die()  { echo -e "${C_RED}xx${C_OFF} $*"; exit 1; }

echo -e "${C_CYAN}====================================================================${C_OFF}"
echo -e "${C_CYAN}  PS-036: PQC DNSSEC MTL BENCHMARK - CLOUDFLARE TUNNEL LAUNCHER    ${C_OFF}"
echo -e "${C_CYAN}====================================================================${C_OFF}"

# 1. Check if cloudflared binary is installed
if ! command -v cloudflared >/dev/null 2>&1; then
  warn "cloudflared is not installed on this system."
  echo ""
  echo "To install on Parrot OS / Debian / Ubuntu, run:"
  echo "  curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
  echo "  sudo dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb"
  echo ""
  die "Please install cloudflared first and re-run this script."
fi

# 2. Check if Workbench UI container is running on 127.0.0.1:8080
if ! curl -s -m 2 http://127.0.0.1:8080/api/status >/dev/null 2>&1; then
  warn "Workbench UI (127.0.0.1:8080) is not responding."
  say "Starting containerized Workbench UI..."
  ./tb.sh ui || ./run_ui.sh
  sleep 3
fi

# 3. Launch Cloudflare Tunnel
say "Starting Cloudflare Quick Tunnel (proxying http://127.0.0.1:8080)..."
say "Zero inbound ports needed. Encrypted HTTPS + WebSocket terminal active."
echo ""
echo -e "${C_YEL}Press Ctrl+C at any time to terminate the tunnel and revoke public access.${C_OFF}"
echo ""

# Run cloudflared Quick Tunnel
exec cloudflared tunnel --url http://127.0.0.1:8080

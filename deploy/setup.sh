#!/usr/bin/env bash
#
# One-shot setup for an Oracle Cloud free-tier instance (Oracle Linux or Ubuntu,
# x86 or ARM/Ampere — there are no native dependencies, so both work).
#
#   git clone <your-repo-url> ~/onic-tournament
#   cd ~/onic-tournament
#   bash deploy/setup.sh
#
# Installs Node if missing, registers the systemd service, and opens the
# instance firewall. It does NOT configure nginx or TLS — those need your
# domain name, see README.md.
#
# Re-running is safe.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=onic-tournament
PORT="${PORT:-3000}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user (opc or ubuntu), not as root." >&2
  exit 1
fi

# ---------------------------------------------------------------- node ------

say "Checking Node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -ge 18 ]]; then
    echo "Node $(node --version) — OK"
    need_node=0
  else
    echo "Node $(node --version) is too old; need 18 or newer."
  fi
fi

if [[ $need_node -eq 1 ]]; then
  say "Installing Node.js 22"
  if command -v dnf >/dev/null 2>&1; then
    # Oracle Linux. The nodejs:22 module is not on every release, so fall
    # back to NodeSource (which publishes aarch64 builds for Ampere).
    if sudo dnf module list nodejs 2>/dev/null | grep -q '^nodejs *22'; then
      sudo dnf module reset -y nodejs
      sudo dnf module enable -y nodejs:22
      sudo dnf install -y nodejs
    else
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
      sudo dnf install -y nodejs
    fi
  elif command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "Unrecognised distro. Install Node 18+ yourself, then re-run." >&2
    exit 1
  fi
  echo "Installed Node $(node --version)"
fi

# ---------------------------------------------------------------- tests -----

say "Running the engine tests"
node "$APP_DIR/lib/test.js"

# -------------------------------------------------------------- service -----

say "Installing the systemd service"
tmp="$(mktemp)"
sed "s|__USER__|$USER|g; s|__DIR__|$APP_DIR|g" "$APP_DIR/deploy/$SERVICE.service" > "$tmp"
sudo cp "$tmp" "/etc/systemd/system/$SERVICE.service"
rm -f "$tmp"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE"
sleep 2
sudo systemctl --no-pager --lines=5 status "$SERVICE" || true

# ------------------------------------------------------------- firewall -----
#
# Oracle has TWO firewalls. This script handles the one ON the instance.
# You must ALSO add an ingress rule in the Oracle Cloud web console:
#   Networking -> Virtual Cloud Networks -> your VCN -> Subnets -> your subnet
#   -> Security Lists -> Default Security List -> Add Ingress Rule
#   Source 0.0.0.0/0, protocol TCP, destination ports 80,443
# Blocking either one produces the identical symptom: a page that never loads.

say "Opening the instance firewall (ports 80 and 443)"
if command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-service=http
  sudo firewall-cmd --permanent --add-service=https
  sudo firewall-cmd --reload
  echo "firewalld updated."
elif command -v iptables >/dev/null 2>&1; then
  # Oracle's Ubuntu images ship restrictive iptables rules.
  for p in 80 443; do
    if ! sudo iptables -C INPUT -m state --state NEW -p tcp --dport "$p" -j ACCEPT 2>/dev/null; then
      sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$p" -j ACCEPT
    fi
  done
  if ! command -v netfilter-persistent >/dev/null 2>&1; then
    sudo apt-get install -y iptables-persistent
  fi
  sudo netfilter-persistent save
  echo "iptables updated and saved."
else
  echo "No firewall tool found — check the instance firewall by hand."
fi

# -------------------------------------------------------------- selinux -----

if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" != "Disabled" ]]; then
  say "Allowing nginx to reach the app through SELinux"
  sudo setsebool -P httpd_can_network_connect 1
  echo "Done. Without this, nginx proxying to 127.0.0.1:$PORT returns 502."
fi

# ----------------------------------------------------------------- done -----

ip="$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null || echo YOUR_SERVER_IP)"
cat <<DONE

==> Done.

  Service:   sudo systemctl status $SERVICE
  Logs:      sudo journalctl -u $SERVICE -f
  Local:     http://127.0.0.1:$PORT

Still to do by hand:
  1. Add the VCN ingress rule in the Oracle Cloud console (see comment above).
  2. Point a domain at ${ip} and set up nginx + certbot — see README.md
     and deploy/nginx.conf.

Until nginx is in front, the app is on port $PORT, which the firewall rules
above do NOT open. That is deliberate.
DONE

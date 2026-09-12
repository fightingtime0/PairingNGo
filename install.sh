#!/usr/bin/env bash
#
# Installs the Onic TCG tournament server.
# Detects Ubuntu vs Oracle Linux and does the right thing for each.
# Safe to run more than once.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE=onic-tournament
PORT="${PORT:-3000}"
RUN_USER="$(whoami)"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m x\033[0m %s\n' "$1" >&2; exit 1; }

[ "$RUN_USER" = "root" ] && die "Run this as your normal user (opc or ubuntu), not as root. It will use sudo where needed."

# ----------------------------------------------------------- detect the OS ---

if [ ! -r /etc/os-release ]; then die "Cannot read /etc/os-release — unrecognised system."; fi
. /etc/os-release

case "${ID:-}${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAMILY=debian ;;
  *rhel*|*fedora*|*ol*) FAMILY=rhel ;;
  *) die "Unsupported OS: ${PRETTY_NAME:-unknown}. Tell Claude what this says and he'll adjust." ;;
esac

say "Detected ${PRETTY_NAME:-$ID} (${FAMILY} family)"

# --------------------------------------------------------------- install node ---

need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$major" -ge 18 ] 2>/dev/null; then
    say "Node $(node --version) already installed"
    need_node=0
  else
    warn "Node $(node --version) is too old, upgrading to 22"
  fi
fi

if [ "$need_node" -eq 1 ]; then
  say "Installing Node 22"
  if [ "$FAMILY" = debian ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    sudo dnf module reset -y nodejs || true
    sudo dnf module enable -y nodejs:22 || true
    sudo dnf install -y nodejs
  fi
  say "Installed Node $(node --version)"
fi

# ------------------------------------------------------------ sanity check ---

[ -f "$APP_DIR/server.js" ] || die "server.js not found in $APP_DIR — are you running this from inside the onic-tournament folder?"

say "Running the engine tests before installing"
node "$APP_DIR/lib/test.js" >/dev/null || die "Engine tests failed. Do not deploy this. Send Claude the output of: node lib/test.js"
echo "    engine tests passed"

mkdir -p "$APP_DIR/data"

# ------------------------------------------------------------ systemd unit ---

say "Installing the systemd service"
sudo tee /etc/systemd/system/${SERVICE}.service > /dev/null <<EOF
[Unit]
Description=Onic TCG Tournament
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
Environment=PORT=${PORT}
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ${SERVICE}
sleep 2

if ! systemctl is-active --quiet ${SERVICE}; then
  sudo journalctl -u ${SERVICE} -n 30 --no-pager
  die "Service failed to start. The log above says why."
fi
say "Service is running and will restart automatically after a reboot"

# --------------------------------------------------------------- firewall ---

say "Opening ports 80 and 443 on the instance firewall"
if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-service=http
  sudo firewall-cmd --permanent --add-service=https
  sudo firewall-cmd --reload
  echo "    firewalld updated"
elif command -v iptables >/dev/null 2>&1; then
  for p in 80 443; do
    if ! sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null; then
      sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT
    fi
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save
  else
    sudo apt-get install -y iptables-persistent || warn "Could not persist iptables rules — they may be lost on reboot."
  fi
  echo "    iptables updated"
else
  warn "No firewall tool found. Skipping."
fi

# ------------------------------------------------------------------ nginx ---

say "Installing nginx as a reverse proxy"
if [ "$FAMILY" = debian ]; then
  sudo apt-get install -y nginx
else
  sudo dnf install -y nginx
  sudo setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi
sudo systemctl enable --now nginx

CONF_DIR=/etc/nginx/conf.d
sudo mkdir -p "$CONF_DIR"
sudo tee ${CONF_DIR}/onic.conf > /dev/null <<EOF
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Ubuntu ships a default site that would win on default_server.
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

sudo nginx -t
sudo systemctl reload nginx

# ------------------------------------------------------------------- done ---

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "YOUR_SERVER_IP")"

cat <<EOF

------------------------------------------------------------------
 Installed.

   Players:    http://${IP}/
   Organizer:  http://${IP}/organizer
   Big screen: http://${IP}/standings.html?id=YOURCODE

 ONE STEP LEFT, and the site will not load until you do it:

   Open the Oracle Cloud console in your browser and add an ingress
   rule. This is separate from the firewall on the machine and both
   have to allow traffic.

     Networking -> Virtual Cloud Networks -> your VCN -> Subnets
       -> your subnet -> Security Lists -> Default Security List
       -> Add Ingress Rules

     Source CIDR:  0.0.0.0/0
     IP Protocol:  TCP
     Destination port range:  80,443

 Then, once you point a domain at ${IP}, add HTTPS with:

   sudo $( [ "$FAMILY" = debian ] && echo "apt-get install -y certbot python3-certbot-nginx" || echo "dnf install -y certbot python3-certbot-nginx" )
   sudo certbot --nginx -d your-domain.com

 Useful commands:
   sudo systemctl status ${SERVICE}
   sudo systemctl restart ${SERVICE}
   sudo journalctl -u ${SERVICE} -f
------------------------------------------------------------------

EOF

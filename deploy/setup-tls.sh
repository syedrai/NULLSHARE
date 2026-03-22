#!/bin/bash
# deploy/setup-tls.sh
# NullShare — TLS Setup Script
# Run with: chmod +x setup-tls.sh && sudo ./setup-tls.sh
#
# Options:
#   ./setup-tls.sh local    → mkcert self-signed (LAN/dev, no domain needed)
#   ./setup-tls.sh prod     → Let's Encrypt certbot (real domain required)

set -e   # Exit on any error
MODE=${1:-local}

echo "╔═══════════════════════════════════════╗"
echo "║   NullShare — TLS Setup Script        ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# ─── Local / LAN mode (mkcert) ───────────────────────────────────────────────
if [ "$MODE" = "local" ]; then
    echo "[*] Setting up local TLS with mkcert..."
    echo "    Use this for: LAN sharing, development, lab environments"
    echo ""

    # Install mkcert
    if ! command -v mkcert &> /dev/null; then
        echo "[*] Installing mkcert..."
        # Ubuntu/Debian
        if command -v apt &> /dev/null; then
            apt install -y libnss3-tools
            curl -Lo /usr/local/bin/mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
            chmod +x /usr/local/bin/mkcert
        # macOS
        elif command -v brew &> /dev/null; then
            brew install mkcert
        else
            echo "[!] Install mkcert manually: https://github.com/FiloSottile/mkcert"
            exit 1
        fi
    fi

    # Install local CA
    mkcert -install
    echo "[✓] Local CA installed in system trust store"

    # Generate cert for localhost + LAN
    mkdir -p /home/nullshare/certs
    cd /home/nullshare/certs

    # Get local IP addresses for cert
    LOCAL_IPS=$(hostname -I | tr ' ' '\n' | head -5 | tr '\n' ' ')
    echo "[*] Generating cert for: localhost 127.0.0.1 $LOCAL_IPS"

    mkcert -cert-file nullshare.pem -key-file nullshare-key.pem \
        localhost 127.0.0.1 nullshare.local $LOCAL_IPS

    echo ""
    echo "[✓] Certificates generated:"
    echo "    Cert: /home/nullshare/certs/nullshare.pem"
    echo "    Key:  /home/nullshare/certs/nullshare-key.pem"
    echo ""
    echo "[*] Update nginx.conf:"
    echo "    ssl_certificate     /home/nullshare/certs/nullshare.pem;"
    echo "    ssl_certificate_key /home/nullshare/certs/nullshare-key.pem;"
    echo ""
    echo "[*] Add to /etc/hosts on receiver devices:"
    echo "    $(hostname -I | awk '{print $1}')    nullshare.local"

# ─── Production mode (Let's Encrypt) ─────────────────────────────────────────
elif [ "$MODE" = "prod" ]; then
    echo "[*] Setting up production TLS with Let's Encrypt (certbot)..."
    echo ""

    if [ -z "$DOMAIN" ]; then
        read -p "    Enter your domain (e.g. share.yourdomain.com): " DOMAIN
    fi

    if [ -z "$EMAIL" ]; then
        read -p "    Enter your email for cert notifications: " EMAIL
    fi

    # Install certbot
    if ! command -v certbot &> /dev/null; then
        echo "[*] Installing certbot..."
        apt install -y certbot python3-certbot-nginx
    fi

    # Install nginx if needed
    if ! command -v nginx &> /dev/null; then
        echo "[*] Installing nginx..."
        apt install -y nginx
    fi

    # Copy nginx config
    sed "s/yourdomain.com/$DOMAIN/g" "$(dirname "$0")/nginx.conf" > /etc/nginx/sites-available/nullshare
    ln -sf /etc/nginx/sites-available/nullshare /etc/nginx/sites-enabled/nullshare
    rm -f /etc/nginx/sites-enabled/default

    # Test nginx config
    nginx -t

    # Get certificate
    echo "[*] Obtaining Let's Encrypt certificate for $DOMAIN..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"

    # Reload nginx
    systemctl reload nginx
    echo ""
    echo "[✓] HTTPS live at: https://$DOMAIN"
    echo "[✓] Certificate auto-renews via certbot timer"

    # Update NullShare PUBLIC_URL
    echo ""
    echo "[*] Update your .env file:"
    echo "    PUBLIC_URL=https://$DOMAIN"

else
    echo "Usage: $0 [local|prod]"
    echo "  local  — mkcert for LAN/dev (no domain needed)"
    echo "  prod   — Let's Encrypt for internet-facing deployment"
    exit 1
fi

echo ""
echo "[✓] TLS setup complete."

#!/bin/bash
set -e
mkdir -p /etc/wireguard && cd /etc/wireguard
[ -f server.key ] || wg genkey > server.key
wg pubkey < server.key > server.pub
if [ ! -f wg0.conf ]; then
  printf '[Interface]\nAddress = %s\nListenPort = 51820\nPrivateKey = %s\n' \
    "$WG_ADDRESS" "$(cat server.key)" > wg0.conf
fi
ip link del wg0 2>/dev/null || true
wg-quick up wg0
echo "T-Connect WG hub up. Server pubkey: $(cat server.pub)"
exec node /app/manager.js
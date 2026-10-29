#!/bin/sh
# Runs inside `unshare -n`: no network interfaces except loopback.
set -e
D=$(cd "$(dirname "$0")" && pwd)
python3 -I "$D/lo-up.py"
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy
IFACES=$(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' ' | tr '\n' ' ')
CURL=$(curl -sS -m 5 https://example.com -o /dev/null 2>&1 || true)
DNS=$(node -e "require('dns').lookup('example.com', e => console.log(e ? e.code : 'resolved'))")
node -e '
const [ifaces, curl, dns] = process.argv.slice(1)
const lines = [
  { cmd: true, text: "cat /proc/net/dev   # network interfaces" }, { text: ifaces.trim() },
  { cmd: true, text: "curl https://example.com" }, { text: curl.trim() },
  { cmd: true, text: "node -e \"dns.lookup(\x27example.com\x27)\"" }, { text: dns.trim() },
  { cmd: true, text: "npm start" }, { text: "Tabibu is running at http://127.0.0.1:4317" }
]
require("fs").writeFileSync(process.argv[4], JSON.stringify({ when: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", lines }))
' "$IFACES" "$CURL" "$DNS" "$D/proof.json"
cat "$D/proof.json"; echo
cd "$D/../.."
node src/server.js > "$D/server.log" 2>&1 &
SERVER=$!
trap "kill $SERVER 2>/dev/null" EXIT
node "$D/record.cjs"
kill $SERVER

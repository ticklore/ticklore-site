#!/usr/bin/env bash
SP=/tmp
OD=/mnt/c/Users/bigow/OneDrive/Documents/GitHub/ticklore-site/mint-service
WSL=~/ticklore-site/mint-service
cp "$OD"/lib/*.js "$WSL"/lib/
cp "$OD"/server.js "$WSL"/server.js
cd "$WSL"
fuser -k 3131/tcp 2>/dev/null; sleep 1

export KEYSTORE_NAME="" RPC_URL=https://sepolia.base.org
export TICKLORE_CONTRACT=0xc2D99cC604c5211A6bd8a1D0594D684d0c48f3BD
export TICKLORE_CONTRACT_V2=0xb953ab6ceF8D339641F55177778829F557D86D06
export TICKLORE_CONTRACT_V3=0x353e83989592aB5dA812eE59D89Ea1356e283866
export TICKLORE_CONTRACT_V4=0x31DFbEC3A80700078BDB53403D5ef79e4dC07049
export MINTER_PRIVATE_KEY=$(tr -d "[:space:]" < "$WSL/showroom-key.txt")
export ADMIN_PASSWORD=admin123 ORGANIZER_PASSWORD=org123 ALLOW_DEMO_BUY=true
export PUBLIC_URL=http://localhost:3131
export EVENT_STORE=/tmp/js-events.json CLAIM_STORE=/tmp/js-claims.json
export VAULT_STORE=/tmp/js-vault.json VAULT_MEDIA=/tmp/js-media
export PORT=3131
rm -f /tmp/js-*.json; rm -rf /tmp/js-media

node server.js > "$SP/jsaudit.log" 2>&1 &
SVPID=$!
for i in $(seq 1 30); do curl -s --max-time 2 http://localhost:3131/health >/dev/null 2>&1 && break; sleep 1; done

# a real event + code so code-driven pages render their full scripts
CR=$(curl -s --max-time 120 -X POST http://localhost:3131/admin/create -H "Content-Type: application/json" -H "x-admin-password: admin123" \
  -d '{"name":"JS Audit","venue":"Testville","date":"2026-09-20","palette":"teal","activationRequired":true,"redemptionEnabled":true,"blocks":[{"leadIn":"","name":"","count":2,"priceDollars":5}]}')
KEY=$(echo "$CR" | grep -oE '"key":"[^"]*"' | cut -d'"' -f4)
CODE=$(curl -s --max-time 20 -H "x-admin-password: admin123" "http://localhost:3131/admin/event/$KEY/codes" | node -e 'let d=JSON.parse(require("fs").readFileSync(0));console.log(d.codes[0].code)')

echo "=== inline-JS syntax audit (every server-rendered page) ==="
PASS=0; FAIL=0
check() {
  local name=$1 url=$2
  local html=$(curl -s --max-time 20 "$url")
  # pull each inline <script> block (skip src= includes) and node --check it
  local n=0 bad=0
  while IFS= read -r block; do :; done < /dev/null
  echo "$html" | node -e '
    let html = require("fs").readFileSync(0, "utf8");
    const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m, i = 0, bad = 0;
    const { execFileSync } = require("child_process");
    const fs = require("fs");
    while ((m = re.exec(html)) !== null) {
      i++;
      fs.writeFileSync("/tmp/js-block.js", m[1]);
      try { execFileSync("node", ["--check", "/tmp/js-block.js"], { stdio: "pipe" }); }
      catch (e) { bad++; console.log("    block " + i + " BROKEN: " + String(e.stderr).split("\n")[1]); }
    }
    console.log((bad ? "  ✗ " : "  ✓ ") + process.argv[1] + " — " + i + " script block(s)" + (bad ? ", " + bad + " BROKEN" : " all valid"));
    process.exit(bad ? 1 : 0);
  ' "$name" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
}
check "/admin (console)"      "http://localhost:3131/admin"
check "/admin sheet"          "http://localhost:3131/admin/event/$KEY/sheet"
check "/admin vault console"  "http://localhost:3131/admin/vault/$KEY"
check "/organize"             "http://localhost:3131/organize"
check "/claim (unclaimed)"    "http://localhost:3131/claim/$CODE"
check "/activate"             "http://localhost:3131/activate/$CODE"
check "/door"                 "http://localhost:3131/door/$CODE"
check "/vault (public)"       "http://localhost:3131/vault/$KEY"
check "/wallet"               "http://localhost:3131/wallet"
check "/shop"                 "http://localhost:3131/shop"
check "/event page"           "http://localhost:3131/event/$KEY"
check "/viewer"               "http://localhost:3131/viewer"
DASH=$(curl -s --max-time 20 -H "x-admin-password: admin123" http://localhost:3131/admin/events | node -e 'let d=JSON.parse(require("fs").readFileSync(0));console.log(d.events[0]?d.events[0].dashUrl:"")')
check "/admin overview"       "http://localhost:3131/admin/overview"
check "/organizer dashboard"  "http://localhost:3131$DASH"
check "/roster console"       "http://localhost:3131/admin/roster/$KEY"
echo "=== RESULT: $PASS pages clean, $FAIL broken ==="

kill $SVPID 2>/dev/null
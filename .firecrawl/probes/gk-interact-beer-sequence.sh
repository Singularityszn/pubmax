#!/usr/bin/env bash
set -euo pipefail
export $(grep FIRECRAWL_API_KEY /workspace/.env.local | xargs)
URL="${1:-https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu}"
OUT_DIR="/workspace/.firecrawl/probes"
SLUG=$(echo "$URL" | sed -E 's|.*/([^/]+)/menu|\1|')
BASE="$OUT_DIR/${SLUG}-interact-base.md"
MERGED="$OUT_DIR/${SLUG}-interact-merged.md"

npx -y firecrawl-cli@latest scrape "$URL" --wait-for 3000 -o "$BASE"
SCRAPE_ID=$(npx -y firecrawl-cli@latest scrape "$URL" --wait-for 1 2>&1 | sed -n 's/Scrape ID: //p' | tail -1)

# Bash interact: dismiss cookies, open Drinks, click each beer-ish tab, dump menu HTML text
npx -y firecrawl-cli@latest interact --bash -c "
agent-browser click 'button:has-text(\"Allow all cookies\")' 2>/dev/null || true
sleep 1
agent-browser click 'button[role=tab][data-text=\"drinks\"]' 2>/dev/null || true
sleep 2
for tab in beer lager draught ale cider spirits gin vodka rum whisky; do
  agent-browser click \"button[role=tab][data-text=\\\"\$tab\\\"]\" 2>/dev/null && sleep 1.5 && echo \"## TAB: \$tab\" && agent-browser snapshot 2>/dev/null | head -120 || true
done
agent-browser click 'button[role=tab][data-text=\"cocktails\"]' 2>/dev/null || true
sleep 1.5
echo '## TAB: cocktails'
agent-browser snapshot 2>/dev/null | head -80
" -o "$MERGED"

npx -y firecrawl-cli@latest interact stop 2>/dev/null || true
echo "Wrote $MERGED"

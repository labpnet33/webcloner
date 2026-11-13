#!/usr/bin/env bash
# webcloner: capture publicly accessible website pages and assets on Linux.
# Requires permission to reproduce the content. No login/paywall/anti-bot bypass.
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Webcloner Public Website Capture

Usage:
  ./scripts/capture-site.sh https://example.com [options]
  ./scripts/capture-site.sh                 # interactively ask for website URL

Options:
  --out DIR               Destination directory (default captures/HOST-TIMESTAMP)
  --max-pages N           Public pages to visit (default 40, maximum 500)
  --max-depth N           Link-following depth (default 3, maximum 8)
  --max-assets N          Maximum saved assets (default 2500, maximum 20000)
  --max-total-mb N        Total captured MB (default 800, maximum 5000)
  --max-file-mb N         Size limit per file (default 35 MB, maximum 250)
  --delay-ms N            Minimum delay between page visits (default 700)
  --include-subdomains    Follow pages and assets on subdomains
  --third-party-assets    Save public static CDN assets referenced by pages
  --no-deep-assets        Skip discovery of referenced files inside JS/CSS
  --no-sitemap            Skip sitemap.xml discovery
  --no-screenshots        Skip public page screenshots
  --help                  Print help

Output:
  DIR/site/               Captured files retaining original public URL paths
  DIR/screenshots/        Screenshots of public pages
  DIR/manifest.json       Public URL to saved-file mapping
  DIR/pages.json          Page crawl details
  DIR/report.txt          Summary and limitations
  DIR.zip                 Archive if the zip utility is available

PUBLIC capture only: no private source, credentials, locked account data,
authentication bypass, paywall bypass, or protected backend functions.
EOF
}
if [ "$#" -gt 0 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
  usage
  exit 0
fi

if [ "$#" -eq 0 ] || [[ "$1" == --* ]]; then
  if [ ! -t 0 ]; then
    echo "Error: pass URL, e.g. $0 https://example.com" >&2
    exit 2
  fi
  read -r -p "Which website URL should I capture? " target
  if [ -z "$target" ]; then echo "A website URL is required." >&2; exit 2; fi
  set -- "$target" "$@"
fi

if [[ ! "$1" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "Error: first argument must be a complete http:// or https:// URL." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20+ and npm are required." >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if (( major < 20 )); then
  echo "Node.js 20+ is required; installed: $(node --version)" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
runner="$script_dir/capture-site.cjs"
if [ ! -f "$runner" ]; then
  echo "Missing companion file: $runner" >&2
  echo "Clone or download the full webcloner repository." >&2
  exit 1
fi

deps="$HOME/.cache/webcloner/node"
mkdir -p "$deps"
if [ ! -f "$deps/node_modules/playwright/package.json" ] ||
   [ ! -f "$deps/node_modules/robots-parser/package.json" ]; then
  echo "[webcloner] Installing Playwright + robots-parser in $deps ..."
  npm install --prefix "$deps" --no-audit --no-fund --no-save playwright robots-parser
fi
export NODE_PATH="$deps/node_modules"
if ! node -e 'const fs=require("node:fs");const p=require("playwright");process.exit(fs.existsSync(p.chromium.executablePath())?0:1)'; then
  echo "[webcloner] Installing Chromium for Playwright ..."
  "$deps/node_modules/.bin/playwright" install chromium
fi

echo "[webcloner] Public capture starting; respects robots.txt and rate limits."
echo "[webcloner] Ctrl+C stops the crawler; already saved files remain."
node "$runner" "$@"

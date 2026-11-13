#!/usr/bin/env bash
# Combine Playwright, Wget, and Browsertrix for permitted public-site capture.
set -Eeuo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"

usage() {
cat <<'HELP'
Use Playwright + GNU Wget + Browsertrix to archive an authorized public website.

Usage: bash scripts/capture-all.sh https://example.com [options]
  --out DIR           Shared capture directory
  --pages N           Maximum pages per browser crawler (1..500, default 40)
  --depth N           Crawl depth (0..8, default 3)
  --quota-mb N        Per-engine size limit (10..5000 MB, default 500)
  --max-minutes N     Limit per extra engine (1..120 minutes, default 20)
  --help              Show help

Output includes Playwright files, a Wget mirror, a Browsertrix WACZ archive
and each engine's report. Requires Node 20+, GNU Wget and Docker.
All capture stays public and respects robots.txt. No bypasses.
HELP
}

if [[ $# -gt 0 ]] && [[ "$1" == --help || "$1" == -h ]]; then usage; exit 0; fi
if [[ $# -eq 0 ]] || [[ "$1" == --* ]]; then
  if [[ ! -t 0 ]]; then echo "Please supply a website URL" >&2; exit 2; fi
  read -r -p "Which website URL should I capture? " target
  [[ -n "$target" ]] || { echo "URL required" >&2; exit 2; }
  set -- "$target" "$@"
fi
url="$1";shift
[[ "$url" =~ ^https?://[^[:space:]]+$ ]] || { echo "Expected http(s) URL" >&2; exit 2; }
out="";pages=40;depth=3;quota=500;minutes=20
check_int() {
  if ! [[ "$2" =~ ^[0-9]+$ ]] || (( 10#$2 < $3 || 10#$2 > $4 )); then
    echo "Invalid $1 (range $3..$4)" >&2;exit 2
  fi
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) [[ $# -ge 2 ]] || exit 2;out="$2";shift 2;;
    --pages) [[ $# -ge 2 ]] || exit 2;check_int "$1" "$2" 1 500;pages=$((10#$2));shift 2;;
    --depth) [[ $# -ge 2 ]] || exit 2;check_int "$1" "$2" 0 8;depth=$((10#$2));shift 2;;
    --quota-mb) [[ $# -ge 2 ]] || exit 2;check_int "$1" "$2" 10 5000;quota=$((10#$2));shift 2;;
    --max-minutes) [[ $# -ge 2 ]] || exit 2;check_int "$1" "$2" 1 120;minutes=$((10#$2));shift 2;;
    --help|-h) usage;exit 0;;
    *) echo "Unknown option: $1" >&2;exit 2;;
  esac
done
command -v node >/dev/null || { echo "Node.js 20+ required" >&2; exit 1; }
host="$(node -e '
try{const u=new URL(process.argv[1]);
if(!["http:","https:"].includes(u.protocol)||u.username||u.password||!u.hostname)process.exit(2);
console.log(u.hostname)}catch{process.exit(2)}
' "$url")" || { echo "Invalid URL" >&2;exit 2; }
if [[ -z "$out" ]];then out="$(pwd)/captures/all-$host-$(date -u +%Y%m%dT%H%M%SZ)";fi
mkdir -p "$out"
out="$(cd "$out" && pwd)"
echo "[webcloner] 1/3 Playwright -> $out/playwright"
first_code=0
bash "$script_dir/capture-site.sh" "$url" \
  --out "$out/playwright" --max-pages "$pages" --max-depth "$depth" \
  --max-total-mb "$quota" || first_code=$?
echo "[webcloner] 2/3 Wget and 3/3 Browsertrix -> $out/extra"
extras_code=0
bash "$script_dir/capture-extra.sh" "$url" \
  --engine both --out "$out/extra" --depth "$depth" \
  --pages "$pages" --quota-mb "$quota" \
  --max-minutes "$minutes" || extras_code=$?
{
  echo "Webcloner three-engine summary"
  echo "Target: $url"
  echo "Capture folder: $out"
  echo "Playwright exit: $first_code"
  echo "Wget / Browsertrix overall exit: $extras_code"
  echo "Details: playwright/report.txt and extra/extra-capture-report.txt"
  echo "These tools do not produce private source code or a working backend."
} >"$out/all-engines-report.txt"
echo "[webcloner] Finished. Read $out/all-engines-report.txt"
if [[ "$first_code" != 0 || "$extras_code" != 0 ]];then exit 1;fi

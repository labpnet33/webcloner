#!/usr/bin/env bash
# Optional public capture engines for Webcloner: GNU Wget + Browsertrix (WACZ).
# Only mirror websites you own or have permission to archive.
set -Eeuo pipefail

usage() {
cat <<'HELP'
Public website capture with Wget and Browsertrix.
Usage: bash scripts/capture-extra.sh https://example.com [options]
  --engine wget|browsertrix|both    Engines to run (default both)
  --out DIR                         Output directory (default captures/extras-HOST-TIMESTAMP)
  --depth N                         Link depth 0..8 (default 3)
  --pages N                         Browsertrix page limit 1..500 (default 40)
  --quota-mb N                      Each engine's size limit, 10..5000 MB (default 500)
  --max-minutes N                   Time limit 1..120 minutes (default 20)
  --help                            Show help

Outputs: DIR/wget/ (rewritten HTML and public linked files),
         DIR/browsertrix/ (WARC/WACZ archive), logs, and report.
Wget is optional (apt install wget); Browsertrix requires Docker Engine.
Respect robots.txt and content licenses. No login or bypass is used.
HELP
}

if [[ $# -gt 0 ]] && [[ "$1" == "--help" || "$1" == "-h" ]]; then usage; exit 0; fi
if [[ $# -eq 0 ]] || [[ "$1" == --* ]]; then
  if [[ ! -t 0 ]]; then echo "Website URL is required." >&2; exit 2; fi
  read -r -p "Which website do you have permission to capture? " target
  [[ -n "$target" ]] || { echo "URL is required." >&2; exit 2; }
  set -- "$target" "$@"
fi
url="$1"; shift
mode=both
out=""
depth=3
pages=40
quota=500
minutes=20
check_number() {
  if ! [[ "$2" =~ ^[0-9]+$ ]] || (( 10#$2 < $3 || 10#$2 > $4 )); then
    echo "Invalid $1: enter an integer between $3 and $4." >&2
    exit 2
  fi
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine)
      [[ $# -ge 2 ]] || { echo "Missing --engine value." >&2; exit 2; }
      mode="$2"; shift 2
      [[ "$mode" == wget || "$mode" == browsertrix || "$mode" == both ]] ||
        { echo "Invalid engine." >&2; exit 2; };;
    --out)
      [[ $# -ge 2 ]] || { echo "Missing --out value." >&2; exit 2; }
      out="$2"; shift 2;;
    --depth)
      [[ $# -ge 2 ]] || { echo "Missing --depth value." >&2; exit 2; }
      check_number "--depth" "$2" 0 8; depth=$((10#$2)); shift 2;;
    --pages)
      [[ $# -ge 2 ]] || { echo "Missing --pages value." >&2; exit 2; }
      check_number "--pages" "$2" 1 500; pages=$((10#$2)); shift 2;;
    --quota-mb)
      [[ $# -ge 2 ]] || { echo "Missing --quota-mb value." >&2; exit 2; }
      check_number "--quota-mb" "$2" 10 5000; quota=$((10#$2)); shift 2;;
    --max-minutes)
      [[ $# -ge 2 ]] || { echo "Missing --max-minutes value." >&2; exit 2; }
      check_number "--max-minutes" "$2" 1 120; minutes=$((10#$2)); shift 2;;
    --help|-h) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
[[ "$url" =~ ^https?://[^[:space:]]+$ ]] ||
  { echo "Use a full http(s) URL." >&2; exit 2; }
command -v node >/dev/null ||
  { echo "Node.js 20+ is required to validate URLs." >&2; exit 1; }
host="$(node -e '
  try {
    const u=new URL(process.argv[1]);
    if(!["http:","https:"].includes(u.protocol) || u.username || u.password || !u.hostname)
      process.exit(2);
    console.log(u.hostname);
  } catch { process.exit(2); }
' "$url")" || { echo "Invalid HTTP(S) URL." >&2; exit 2; }
if [[ -z "$out" ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  out="$(pwd)/captures/extras-$host-$stamp"
fi
mkdir -p "$out"
out="$(cd "$out" && pwd)"
report="$out/extra-capture-report.txt"
seconds=$((minutes*60))
failed=0

{
  echo "Webcloner optional public capture"
  echo "URL: $url"
  echo "Output: $out"
  echo "Engines: $mode"
  echo "Depth: $depth; Browsertrix page limit: $pages"
  echo "Per-engine quota: $quota MB; time: $minutes minutes"
  echo
} >"$report"

run_wget() {
  if ! command -v wget >/dev/null; then
    echo "[webcloner] Wget not installed: sudo apt-get install -y wget" >&2
    echo "Wget: skipped (missing wget)" >>"$report"
    return 1
  fi
  mkdir -p "$out/wget"
  echo "[webcloner] Wget starting for $url"
  local code=0
  timeout --signal=INT --kill-after=10s "$seconds" \
    wget "$url" \
      --recursive "--level=$depth" \
      --page-requisites --adjust-extension --convert-links \
      --no-verbose --no-parent \
      "--directory-prefix=$out/wget" \
      "--quota=$quota"m --wait=1.2 \
      --timeout=20 --tries=2 --max-redirect=5 \
      --execute robots=on \
      --reject-regex='/(logout|signout|checkout|billing|payment|delete-account)(/|[?#]|$)' \
      >"$out/wget-run.log" 2>&1 || code=$?
  echo "Wget: exit $code; logs: wget-run.log (some HTTP errors are expected)" >>"$report"
  echo "[webcloner] Wget finished, code $code."
  [[ "$code" == 0 ]]
}

run_browsertrix() {
  if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
    echo "[webcloner] Browsertrix requires running Docker with permission for this user." >&2
    echo "Browsertrix: skipped (Docker unavailable)" >>"$report"
    return 1
  fi
  mkdir -p "$out/browsertrix"
  local code=0
  local stamp collection size
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  collection="webcloner-$stamp"
  size=$((quota*1024*1024))
  echo "[webcloner] Browsertrix starting for $url"
  # Browsertrix does not honor robots.txt by default; explicit --useRobots.
  # Docker archive storage is isolated to the requested output directory.
  timeout --signal=INT --kill-after=30s "$((seconds+90))" \
    docker run --rm --shm-size=1g \
      -v "$out/browsertrix:/crawls" \
      webrecorder/browsertrix-crawler crawl \
      --url "$url" --scopeType host "--depth=$depth" "--limit=$pages" \
      "--sizeLimit=$size" "--timeLimit=$seconds" \
      --useRobots --headless --generateWACZ --text to-pages \
      --workers 1 --pageExtraDelay 1 --collection "$collection" \
      >"$out/browsertrix-run.log" 2>&1 || code=$?
  echo "Browsertrix: exit $code; logs: browsertrix-run.log; collection: $collection" >>"$report"
  echo "[webcloner] Browsertrix finished, code $code."
  [[ "$code" == 0 ]]
}

if [[ "$mode" == both || "$mode" == wget ]]; then
  run_wget || failed=1
fi
if [[ "$mode" == both || "$mode" == browsertrix ]]; then
  run_browsertrix || failed=1
fi
{
  echo
  echo "Wget creates an offline page and public-asset mirror."
  echo "Browsertrix creates WARC/WACZ archives for replay and inspection."
  echo "These do not contain private code, protected functionality or databases."
  echo "Do not publish copyrighted assets without permission."
} >>"$report"
echo "[webcloner] Report: $report"
exit "$failed"

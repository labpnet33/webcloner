# Webcloner — Linux public website capture and rebuild skill

An interactive **SKILL.md** and a **Linux browser-based downloader**. The downloader accepts an HTTP(S) URL, visits publicly accessible pages in Playwright, saves page content and assets, scans for referenced public static resources, and makes a ZIP.

> Only capture or reproduce websites you own or are authorized to mirror. For other websites, use public pages as visual references for an original implementation. No login, paywall, anti-bot, or access-control bypass is included.

## Install on Ubuntu

    sudo apt-get update
    sudo apt-get install -y git zip ca-certificates

    # Node.js 20+ and npm must be installed.
    git clone https://github.com/labpnet33/webcloner.git
    cd webcloner
    chmod +x scripts/capture-site.sh

Dependencies are installed automatically under ~/.cache/webcloner/node. If Chromium lacks system libraries on your Ubuntu server, run:

    ~/.cache/webcloner/node/node_modules/.bin/playwright install --with-deps chromium

## Provide any website URL

Ask interactively:

    ./scripts/capture-site.sh

Or supply a URL:

    ./scripts/capture-site.sh https://example.com

For a deeper **permissioned** capture:

    ./scripts/capture-site.sh https://example.com \
      --max-pages 100 --max-depth 5 --max-assets 8000 \
      --max-total-mb 1500 --max-file-mb 100 --delay-ms 900 \
      --include-subdomains --third-party-assets

Example using the public BallEngine website, subject to its rules and your permission:

    ./scripts/capture-site.sh https://ballengine.app/ \
      --max-pages 80 --max-depth 4 --max-assets 6000 \
      --max-total-mb 1200

Specify your destination folder if desired:

    ./scripts/capture-site.sh https://example.com --out "$HOME/example-capture"

## Output files

| File or directory | Content |
| --- | --- |
| site/ | Captured public HTML snapshots and downloaded JS/CSS/images/fonts/media/JSON/WASM |
| screenshots/ | Screenshots of up to 10 public pages |
| manifest.json | Original URLs and saved local paths, types and sizes |
| pages.json | Page titles, crawl depths, navigation results |
| errors.json | Failed resource requests and page errors |
| report.txt | Summary, counts, limitations |
| capture-name.zip | Optional ZIP archive when zip is installed |

The downloader has **bounded** default limits: 40 pages, 3 link levels, 2500 resources, 800 MB total, 35 MB/file, 700 ms between pages. Raise them with the flags if you have permission and capacity.

This is not the original server source code. A captured HTML/JavaScript snapshot cannot automatically reproduce a proprietary backend, private APIs, database, sign-in, premium services, or video processing. Rebuild needed functionality independently or migrate actual source you are authorized to use.

## Update the script on your Linux server

    cd ~/webcloner
    git pull --ff-only origin main
    chmod +x scripts/capture-site.sh
    ./scripts/capture-site.sh https://example.com

This updates the **download script on your server**, not the source website itself.

To copy a capture archive to a different server:

    scp captures/YOUR-CAPTURE.zip ubuntu@YOUR_SERVER_IP:/home/ubuntu/

Do not commit third-party copyrighted website assets, captured session data or very large archives to a public GitHub repository without authorization. Captures are excluded by .gitignore.

## Interactive SKILL.md

Load SKILL.md in a compatible coding agent. If you invoke the skill without providing a URL, it starts with:

> Which website do you want to rebuild? Please share its URL.

It then performs authorized discovery, plans original/migrated functionality, sets up GitHub and Vercel Preview, tests results, and asks for approval before production.

## File map

- scripts/capture-site.sh — Bash entrypoint that prompts for a URL, checks dependencies, runs capture
- scripts/capture-site.cjs — Playwright crawler with robots.txt checks, link traversal, asset capture, resource discovery, and ZIP output
- SKILL.md — interactive instructions for website auditing and rebuilding
- .github/workflows/validate-capture.yml — Node and Bash syntax checks on each update

Run help:

    ./scripts/capture-site.sh --help

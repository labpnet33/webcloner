---
name: authorized-site-rebuild
description: Interactive guided website migration or authorized rebuild. When invoked without a target website URL, FIRST ask "Which website do you want to rebuild? Please share its URL." Then guide the user step by step through permission checks, public-site audit, source or authorized asset capture, functional reconstruction, owner-approved guest/free alternatives, GitHub, and Vercel Preview; obtain approval before Production.
---

# Authorized Website Rebuild and Free-Mode Migration

## START HERE — interactive conversation trigger (highest priority)

**This is an interactive skill, not just a readme or a command generator.** As soon as the user **explicitly invokes this skill**, follow this state machine. If the user uploaded only this `SKILL.md` (without the other files), the conversational stages still work; provide concrete commands or recreate necessary templates instead of assuming bundled scripts exist.

### First assistant reply, when the website URL has NOT been supplied

Do **not** begin an audit, assume a target, request a GitHub repository, or dump a long questionnaire. Ask exactly one simple question and wait:

> **Which website do you want to rebuild? Please share its URL (for example, https://example.com).**

The URL can be in the invocation message or any earlier message in the active chat. If a URL was already provided, **do not ask for it again**; move to the next stage. An uploaded file alone does not guarantee this skill will run automatically: the user or agent must activate it. For a generic chat, suggest the user say **"Use the authorized-site-rebuild skill"** after uploading the file.

### Stage-by-stage conversation after receiving the URL

1. **Target and scope.** Normalize/confirm the URL. Determine whether it is a website the user owns/operates, a site they have explicit permission to migrate, or a public third-party reference. If that is unclear, ask **one short question**: "Do you own this website or have permission to reproduce its code and assets?" Do not proceed with code/asset copying until authorized. A public reference can still be analyzed and used as inspiration for an **original** implementation.
2. **Source vs public reference.** Prefer an existing, authorized source GitHub repository. If the user has it, use the repository; otherwise perform a public-only audit and provide commands/scripts for lawful reference capture. Explain that browser capture is not the site's server-side source.
3. **What should work?** Discover actual pages and features from the target and summarize what is public/static, interactive, authenticated, server-backed, or premium. Ask a follow-up only where an answer blocks implementation. Ask for branding/assets/licenses if ownership is relevant.
4. **Rebuild choice.** Choose the least risky permitted route by default: migrate owned source where available; otherwise implement a maintainable, independently written frontend with equivalent user-requested workflows. For a website the user controls, ask if they want guest mode before replacing sign-in. Premium features belonging to a third party must not be unlocked; offer **original locally implemented or licensed free alternatives** instead.
5. **Working project.** Build incrementally; implement real interactions, storage and any authorized API replacements; verify actual results. Do not state that screenshots or static copies imply fully working features.
6. **GitHub setup.** When ready to push, ask for the destination repository (or permission to create a new one), account/organization if required, and **public or private** visibility. Use connected GitHub tools if available, otherwise provide exact CLI commands. Avoid credentials in commits.
7. **Vercel setup.** Ask which Vercel project/team should receive the site, or whether to create a new project. Deploy to **Preview** first, verify pages and exact commit. Ask explicit approval separately before any Production deployment or promotion. If the user has no connector/CLI, guide them through connecting it or provide copyable deployment commands.
8. **Testing and handover.** Check routes, refresh/deep links, links, mobile, performance, auth/guest flows, persistence, and exports if present. Report what is verified, unverified, or blocked. Give Preview and repo URLs only when real, with the branch/commit and what still needs work.

**Conversational guardrails:** Ask **one essential question at a time** instead of presenting a form. Never repeat answers already given. When the user's request and granted access are sufficient, **work directly instead of requesting confirmation at every ordinary step**. If blocked by permissions, tools, quotas, or an inaccessible source, state that clearly and provide the next concrete step. Don't claim a deployed site, functioning feature, or test passed unless it has been verified. Never promise future/background work.

### Example first exchanges

**User:** "Use this skill to clone a website."  
**Assistant:** "Which website do you want to rebuild? Please share its URL (for example, https://example.com)."

**User:** "https://example.com"  
**Assistant, if authority isn't already clear:** "Do you own this website or have permission to reproduce its code and assets?"

**User:** "It's my website, and I have the source repo."  
**Assistant:** Continue with an audit and migration plan; ask for the repo URL only if not already supplied, then proceed with available tools.

---

## Non-negotiable scope

1. Determine the user's ownership, code access, or permission to reproduce **before** copying website content beyond ordinary observation. Distinguish an owned source migration from an independently written alternative informed by public references. If authorization is uncertain, audit public pages and offer an original implementation plan; do not reproduce proprietary source or branding.
2. **Never bypass another service's login, access controls, licenses, paywall, subscription, quotas, DRM, API authorization, or payment verification.** A screenshot or public asset is not proof of permission to republish it. Do not fabricate an authenticated user, credit balance, paid entitlement, server response, or license key.
3. For a website the user owns, removing mandatory sign-in is legitimate **only** after replacing protected flows with a real guest-mode design. Make guest content private to that visitor and eliminate external credential requirements only where the owner has authority. For third-party sites, write original equivalents or integrate permitted free/open-source services instead of unlocking their paid features.
4. Do not promise that a copied frontend is fully functional. Dynamic features require their own backend, client data model, and tests. Never claim that hosting is entirely free: hosting quotas, storage, rendering, bandwidth, and external APIs can have costs.
5. Production changes require **explicit user approval**. Preserve current production. Use a separate Git branch and Preview first, then verify real browser behavior.

## Required workflow

### Phase 0 — Scope and permission

Collect only what is necessary: target URL/repo, permission to use original assets/source, deployment destination, public vs private repo, required routes/features, and expectations for auth and paid dependencies. Review rights to graphics, fonts, audio, video, and code. Produce a short feature inventory with status labels: public/static, client interactive, server-backed, authenticated, metered/paid, or unavailable.

### Phase 1 — Evidence-backed audit

- Prefer the owner's existing source repository and official build process. For a URL-only public reference, do a **public-only** audit with `scripts/audit-public-site.mjs`. No login session, private endpoints, or third-party data capture.
- Identify routes, public scripts/styles/fonts/images/audio/video/WASM/workers, API requests, framework clues, console errors, mobile layout, CORS/CSP, and third-party dependencies.
- Maintain `templates/feature-matrix.csv`. Inspect the *real behavior* of every user-facing button; a visible UI is not a working feature.
- Check all legal and policy pages, links, SEO metadata, favicon/PWA icons, brand references, asset licensing, and analytics identifiers.

### Use all three public capture engines when extra coverage is requested

When the user asks to download as much publicly available website data as
practical, prefer the combined launcher over Playwright alone:

    git clone https://github.com/labpnet33/webcloner.git
    cd webcloner
    bash scripts/capture-all.sh https://example.com

The combined launcher runs:
1. Playwright for hydrated public pages, browser-fetched JS/CSS/WASM and assets;
2. GNU Wget for linked public files and converted offline HTML links;
3. Browsertrix for browser-based WARC/WACZ replay archives (Docker required).

For a bounded, authorized deeper capture:

    bash scripts/capture-all.sh https://example.com \
      --pages 80 --depth 4 --quota-mb 1200 --max-minutes 30

Do not represent WARC/WACZ as source code. Respect robots.txt and terms,
never circumvent access controls or paid features, and be explicit about which
engines actually completed. Script options and setup are in README.md.
When only Playwright is available, scripts/capture-site.sh remains supported.

### Reusable Linux public capture command (scripts in this repository)

When the user wants to **download public website pages and assets** from Linux, use the checked-in tool:

    git clone https://github.com/labpnet33/webcloner.git
    cd webcloner
    chmod +x scripts/capture-site.sh
    ./scripts/capture-site.sh https://example.com

When no URL was supplied, ask for the URL first, then substitute it in the command.
The Bash script also prompts for a URL when launched interactively.

For an authorized deeper crawl, explain resource and rate limits and optionally use:

    ./scripts/capture-site.sh https://example.com \
      --max-pages 100 --max-depth 5 --max-assets 8000 \
      --max-total-mb 1500 --max-file-mb 100

**Respect robots.txt and site terms.** The crawler only visits publicly reachable pages, records browser-loaded files, and may discover additional static assets in JS/CSS. It does not log in, circumvent private/paid functionality, bypass defenses, or obtain proprietary backend source code. The files under captures/ include a manifest, page list, error log, and optional ZIP; this is a starting point for an independent rebuild, not a guarantee of a functioning copy.

For a user who has already cloned the repository on Ubuntu and asks how to receive future skill/script changes, provide:

    cd ~/webcloner
    git pull --ff-only origin main

Do not automatically push captured third-party content to a public GitHub repository, and do not imply that downloading files grants publication rights.

### Phase 2 — Capture or rebuild

**Preferred: source migration.** Clone the authorized repository; install dependencies, run official build, create reproducible development commands, and preserve licenses.

**Fallback: authorized public asset capture.** Run `scripts/capture-public-site.mjs` with `--authorized` only when reproduction rights are confirmed. It captures publicly requested same-origin static resources and HTML snapshots. Treat it as a reference/migration aid, **not** a mechanism to reconstruct private backend behavior. It intentionally excludes API, authentication, payment, administrative, and third-party responses. For apps with dynamic hydration, implement the UI and functionality in maintainable source rather than editing opaque minified bundles indefinitely.

Compare screenshots against reference states at desktop and mobile. Separate **visual parity**, **functional parity**, and **licensed-rights compliance** in the acceptance criteria.

### Phase 3 — Guest or free alternative mode (owner-controlled only)

- Remove sign-in UI and route guards through the app's actual source and routing design; keep protected account data inaccessible without authorization. Do not just set `signed_in=true` or intercept arbitrary requests.
- Use an explicit guest data adapter: localStorage for small preferences, IndexedDB for larger files, optional user-controlled export/import. See `templates/guest-project-store.js`. Keep the data scoped to the current browser. Disclose that clearing browser data may delete it.
- Replace paid dependencies with permitted alternatives: e.g., client-side WebCodecs + OffscreenCanvas for deterministic rendering where supported, open-source or owned assets, free-tier hosting within quotas. Do **not** unlock someone else's paid service or reuse paid endpoints without a license.
- Preserve exact route semantics, original user-owned features, worker scripts, WASM binaries, fonts, sounds, and mobile behavior. Reimplement missing backends rather than returning misleading fake successes.
- For each feature, define a test: UI action, observable outcome, data persistence, error behavior, and export artifact quality.

### Phase 4 — GitHub and Vercel

- Use a new repository or clean development branch as authorized. Never commit tokens, .env files, cookies, HAR files with secrets, private response data, or credentials. Choose public/private visibility with the user.
- Add `README`, LICENSE information for dependencies, `.gitignore`, feature matrix, test scripts, `vercel.json` where needed, and workflows for static checks.
- Deploy **Preview only** first via connected GitHub/Vercel tools or `vercel deploy`. Do not publish to production until the user explicitly approves the verified commit.
- With Vercel Git integration, verify which branch maps to Production; changing it can deploy unintentionally. Check deployment status and exact commit. Use `vercel deploy --prod` or a production promotion **only after approval**. See `references/deployment.md`.

### Phase 5 — Test, report, handover

- Smoke-test every primary route, deep-link reload, missing asset, original/new feature, API replacement, persistence, video download, mobile viewport, and error handling.
- For media exports, inspect opening frames, ending frames, resolution, audio sync, codec compatibility, filename, blob cleanup, and 5 s / 30 s / long-video behavior. Do not label an export as tested until real playback succeeds.
- Collect diagnostics, failures and screenshots; label each outcome **verified / unverified / blocked**. Keep Production untouched if blocked.
- Deliver repository URL/branch/commit, Preview URL, exact code changes, test findings, remaining risks, cost/quota assumptions, and a concrete rollback step.

## Useful packaged files

- `scripts/audit-public-site.mjs` — Browser-based, unauthenticated site inventory and screenshots.
- `scripts/capture-public-site.mjs` — Explicitly authorized capture of public, same-origin static files only.
- `scripts/validate-project.mjs` — Static file and route sanity check on an exported frontend.
- `templates/guest-project-store.js` — Local IndexedDB project adapter for an owner-controlled site.
- `templates/vercel.static.json` — Example explicit route mapping for a static app.
- `references/nexusbox-lessons.md` — Lessons learned from the previous migration.
- `references/qa-checklist.md` — Functional acceptance and release checklist.
- `references/deployment.md` — Preview/Production separation, GitHub/Vercel commands.

## Failure handling

If capture creates a page that looks right but breaks when revisited: verify deep-link route mapping, SPA hydration, `__data.json`, worker URL paths, module imports, fonts and WASM. If browsers render differently: use fixed-time simulation, feature detection, WebCodecs support checks, explicit errors, and avoid changing desktop behavior while fixing mobile. If private APIs are required and no replacement is permitted: report the feature blocked and design an original alternative instead of bypassing access.

## Delivery format

Respond with a concise status table: target, permission scope, repo/branch/commit, Preview, test results, production status, costs/limits, and remaining blockers. Never claim success without a tested artifact or verified deployment.

# CLAUDE.md

Guidance for future Claude Code sessions working on this repo. Written in
plain language on purpose — the owner (Alex) is not a developer.

## What this project is

A Telegram bot (`@olxfreestuffbot`) that posts free ("za darmo") listings
scraped from OLX.pl's Warsaw classifieds to subscribers, in their choice of
6 UI languages (English, Polish, Russian, Belarusian, Ukrainian, German —
only the menu/button text is translated, listings themselves are shown as
scraped, in Polish).

## Architecture — three pieces, only one of them in this repo

```
Claude Code scheduled task        Cloudflare Worker              GitHub (this repo)
 "OLX Free Stuff Scrape"   --POST-->  olx-free-stuff-worker --PUT-->  data/offers.json
 (runs via Alex's Chrome,       (auth: X-Secret header)   |
  NOT part of this repo)                                  +-> Workers KV (live cache)
                                                            +-> Telegram Bot API
                                                                (webhook: menu, language
                                                                 picker, offer delivery)
```

1. **The scraper is a Claude Code *scheduled task*, not a file anywhere in
   git.** It only exists as a trigger definition (`trig_01KefjPocyMk5isGEV6gDGvX`,
   name "OLX Free Stuff Scrape"). Each run: opens OLX.pl in Alex's actual
   Chrome browser (via the Claude-in-Chrome extension — scraping needs a
   real browser because OLX's listing grid is virtualized/JS-rendered),
   scrapes the newest "oddam za darmo" listings, filters out junk categories
   (pets, broken items, baby items, food), dedupes against a list of
   previously-seen URLs stored in a claude.ai Project doc
   (`claude/olx_seen_listings.json` in the "Olx Free Stuff Bot" project),
   then sends the new listings to the Cloudflare Worker below.
   A readable copy of its current instructions is kept at
   [`scheduled-task/olx-scrape-task.md`](scheduled-task/olx-scrape-task.md)
   for transparency — **that file is documentation, not executable code;
   the real logic lives in the scheduled task itself** (view/edit it with
   the Claude Code scheduled-task tools, not by editing that file).
   **Status: disabled since 2026-09-18** — see "Current status" below.

2. **The Cloudflare Worker** (`olx-free-stuff-worker`) — its source **is**
   committed here, at [`cloudflare/olx-free-stuff-worker.js`](cloudflare/olx-free-stuff-worker.js),
   and deploys automatically on every push to `main` via
   [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).
   Confirmed on 2026-11-06 by diffing the actually-deployed (bundled) code
   against this repo's `main` — they matched exactly, so the auto-deploy is
   genuinely working and this file is the real source of truth. It:
   - stores incoming scraped offers in Workers KV, then backs them up to
     this repo's `data/offers.json` via the GitHub Contents API
   - serves the Telegram webhook: menu, language picker, delivering the
     current offer batch

3. **This repo** — the Worker's source, the data snapshot, and a fully
   legacy Python/aiogram bot (`main.py` and its supporting `config/`,
   `database/`, `handlers/`, `keyboards/`, `locales/`, `utils/` modules)
   that used to run on Railway. Railway has been decommissioned; none of
   that Python code runs anywhere today. Kept for reference only.

See [`README.md`](README.md) for full endpoint docs, required Cloudflare
config, and the legacy bot's original documentation.

## Current status (as of 2026-11-06)

- **Cloudflare Worker: live**, confirmed matching this repo's `main`.
- **Telegram bot: should be live** via the Worker's webhook — not yet
  independently re-confirmed with `getWebhookInfo` this round; check before
  relying on that assumption.
- **Scraper: NOT running.** Disabled since 2026-09-18 — `data/offers.json`
  hasn't had real new data since 2026-09-17. It's being reworked (removing
  a hardcoded secret from the task's instructions, switching its delivery
  step from a browser-relayed fetch to a direct request from the sandbox)
  before being turned back on. Do not re-enable it without checking with
  Alex first — he asked for this explicitly during the 2026-11 cleanup.
- **`alexalkor/olx-bot`** is a duplicate/mirror of this repo (byte-identical
  at the same commit) with no role in the live system. Alex asked for it to
  be deleted; deleting a GitHub repo isn't something these tools can do, so
  it's on him to remove via GitHub's own UI.

## Rules for future sessions

- **This repo is public — never commit secrets** (bot tokens, webhook
  secrets, GitHub PATs, etc.) in any file, commit message, or code comment.
  Secrets belong in Cloudflare's dashboard (Settings → Variables, as
  "Encrypt"/secret) or in this environment's stored credentials
  (`request_credential`) — never typed into a scheduled task's prompt text
  either, which is just as real a leak surface as a committed file, even
  though it's not literally in the public repo.
- **Always confirm with Alex before**: redeploying over the live Worker,
  changing the Telegram webhook, enabling/disabling/changing the scraper's
  scheduled task, rotating secrets, or deleting/archiving anything on
  GitHub. These affect a live, user-facing system.
- **Safe without asking**: documentation updates, local git commits on a
  feature branch, reading/exploring, anything reversible.
- **To check what's actually live** (git can lie by omission — code can be
  deployed by hand outside of what's committed): the most reliable check
  for the Telegram side is asking Alex to open
  `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` in his own browser
  and paste back the result — never ask him for the bot token itself. For
  the Worker side, ask him what's in the Cloudflare dashboard's Build/Git
  settings for `olx-free-stuff-worker`, or compare deployed output against
  `cloudflare/olx-free-stuff-worker.js` the way this round did.

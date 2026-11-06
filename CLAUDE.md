# CLAUDE.md

Guidance for future Claude Code sessions working on this repo. Written in
plain language on purpose — the owner (Alex) is not a developer.

## What this project is

A Telegram bot (`@olxfreestuffbot`) that posts free ("za darmo") listings
scraped from OLX.pl's Warsaw classifieds to subscribers, in their choice of
6 UI languages (English, Polish, Russian, Belarusian, Ukrainian, German —
only the menu/button text is translated, listings themselves are shown as
scraped, in Polish).

## Architecture — four pieces, only two of them in this repo

```
Claude Code scheduled task        Cloudflare Worker              GitHub (this repo)
 "OLX Free Stuff Scrape"   --POST-->  olx-free-stuff-worker --PUT-->  data/offers.json
 (runs via Alex's Chrome,       (auth: X-Secret header)   |
  NOT part of this repo)                                  +-> Workers KV (live cache)
                                                            +-> Telegram Bot API
                                                                (webhook: menu, language
                                                                 picker, offer delivery)

Claude Code scheduled task
 "OLX offers freshness watchdog"  --GET /offers / POST /admin/alert-->  same Worker
 (fully cloud, NOT part of this repo, NOT dependent on Alex's PC)
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
   - serves `POST /admin/alert` (added 2026-11-06): sends a Telegram
     message to `ADMIN_CHAT_ID`, used by the watchdog task below

3. **The freshness watchdog** (`trig_01Uf35WF3PkZr8QzTmRDfYte`, "OLX offers
   freshness watchdog", added 2026-11-06) — a second, independent Claude
   Code scheduled task, also not a file anywhere in git, that runs every
   12h fully in the cloud: `GET /offers`, checks how stale `timestamp` is,
   and `POST`s `/admin/alert` if the scraper (item 1) hasn't posted
   recently. It exists specifically because item 1's scrape step can't run
   in the cloud (OLX blocks cloud/datacenter IPs) — this is the piece that
   *can*, so it watches for item 1 going silent instead of replacing it.

4. **This repo** — the Worker's source, the data snapshot, and a fully
   legacy Python/aiogram bot under `legacy/` (`legacy/main.py` and its
   supporting `config/`, `database/`, `handlers/`, `keyboards/`, `locales/`,
   `utils/` modules) that used to run on Railway. Railway has been
   decommissioned; none of that Python code runs anywhere today. Kept for
   reference only, and moved under `legacy/` (2026-11-06) so Cloudflare
   Workers Builds stops auto-detecting its `requirements.txt` and trying to
   `pip install` it before every deploy — that was breaking every build
   regardless of what changed in the Worker's own code.

See [`README.md`](README.md) for full endpoint docs, required Cloudflare
config, and the legacy bot's original documentation.

## Current status (as of 2026-11-06)

- **Cloudflare Worker: live**, confirmed matching this repo's `main`.
- **Telegram bot: should be live** via the Worker's webhook — not yet
  independently re-confirmed with `getWebhookInfo` this round; check before
  relying on that assumption.
- **Scraper: still NOT running, and staying off.** Disabled since
  2026-09-18 — `data/offers.json` hasn't had real new data since
  2026-09-17. The rework (removing a hardcoded secret from the task's
  instructions, switching delivery from a browser-relayed fetch to a
  direct sandbox request) is done. Alex has confirmed: leave it disabled
  for now — do not re-enable without checking with him first.
- **Freshness watchdog: live**, added 2026-11-06, see item 3 above.
- **Correction, 2026-11-06:** an earlier version of this file claimed
  `alexalkor/olx-bot` was a duplicate repo Alex wanted deleted. That's
  self-contradictory as written — this file, this CLAUDE.md, is itself
  committed in `alexalkor/olx-bot`, which is also where the Worker's
  source, `data/offers.json`, and all the active PRs for this project
  live. The Worker's `GITHUB_REPO` var backs up data to a *differently
  named* repo, `alexalkor/olx-free-stuff-bot` — that's most likely what
  was actually meant (possibly a stale name from before a rename, now
  only receiving automated data-backup pushes with no code or human
  activity of its own). Don't act on either claim — confirm with Alex
  which repo (if any) is actually redundant before anyone considers
  deleting anything.

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

# CLAUDE.md

Guidance for future Claude Code sessions working on this repo. Written in
plain language on purpose — the owner (Alex) is not a developer.

## What this project is

A Telegram bot (`@olxfreestuffbot`) that is "OLX search inside Telegram":
each person saves searches (category, keywords, location, price / free only,
"real items only" junk filter, excluded words), refreshes them with one tap,
and can subscribe (hourly / every 3h / daily 9:00) to get new listings sent
automatically. Menus in 6 languages (EN, PL, RU, BE, UK, DE); listings are
shown as posted (Polish). Personal use for now — no paid tier.

Until v3 (Nov 2026) it was a single shared "free stuff" list fed by a Chrome
scraper on Alex's PC; that is retired. "Free stuff — Warsaw" is now a
ready-made search.

## Architecture (v3)

```
Telegram <--webhook--> Cloudflare Worker olx-free-stuff-worker --GET--> www.olx.pl/api/v1 (public JSON)
                           | hourly cron "7 * * * *"
                           v
                       Workers KV (OFFERS_KV): searches, sent ids, language
```

- Everything runs in the Worker. **OLX answers Cloudflare but blocks other
  cloud machines** (including Claude Code cloud sandboxes, 403 from
  CloudFront) — so never move OLX calls into a scheduled task or GitHub
  Actions. To look at raw OLX responses from a session, Alex can paste a tiny
  script into the throwaway `olx-test` Worker and paste back the output (done
  2026-11-15; facts are recorded at the top of `cloudflare/lib/olx.js`).
- Source: `cloudflare/olx-free-stuff-worker.js` + `cloudflare/lib/*`, tests in
  `tests/` (`npm test`). Deployed by Cloudflare **Workers Builds on every push
  to `main`** (confirmed 2026-11-06; the dashboard shows the Worker linked to
  `alexalkor/olx-free-stuff-bot`, which is this repo's old name — GitHub
  redirects it, so it is NOT a separate/duplicate repo). Other branches get
  preview copies that share the live KV but never touch the live bot's
  webhook or cron.
- Design: `docs/superpowers/specs/2026-11-15-olx-search-bot-design.md`.
- `legacy/` is the old Python/aiogram bot (Railway, decommissioned) — reference
  only, kept under `legacy/` so Workers Builds doesn't try to pip-install it.

### Scheduled tasks (not in git)

- "OLX Free Stuff Scrape" (`trig_01KefjPocyMk5isGEV6gDGvX`) — the retired
  Chrome scraper. Disabled since 2026-09-18; obsolete with v3.
- "OLX offers freshness watchdog" (`trig_01Uf35WF3PkZr8QzTmRDfYte`) — polled
  `GET /offers`, which v3 removes, so it must be disabled when v3 goes live
  (the Worker's own cron now alerts `ADMIN_CHAT_ID` if OLX stops answering).
  Ask Alex before changing either task.

## Current status (2026-11-15)

- v3 built on branch `claude/friendly-newton-dgdkcm` (PR #4), tests passing;
  waiting for Alex's go-ahead to merge (= deploy). Until then the live Worker
  is v2 (`/health` shows the version).

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

## Git: merge automatically (Alex's rule for all repos)
When a change is finished and its checks pass, push it and merge it into
`main` without asking, then tell Alex what was merged. Ask first only when the
change would affect something live right away: deploying, changing passwords,
tokens or secrets, deleting data, or changing scheduled tasks.
In this repo a push to `main` deploys the live Worker automatically
(Cloudflare Workers Builds), so a change to the Worker code in `cloudflare/`
counts as deploying: ask first. Documentation and data changes merge freely.

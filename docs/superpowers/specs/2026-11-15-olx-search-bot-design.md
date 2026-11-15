# OLX search bot — design (2026-11-15)

## Intent and the why

Turn @olxfreestuffbot from "one shared list of free stuff, fed by a Chrome
scraper on Alex's PC" into **OLX search inside Telegram**: each person saves
their own searches (category, keywords, location, price, junk filter), can
refresh them in one tap, and can subscribe so new matches arrive on their own
— OLX's email alerts, but in Telegram, and with better filtering. Inspired by
@thewarsawrentbot's flow (filter menu → "show what's listed now" → automatic
batches of new listings), without any paid tier.

Personal use for now (Alex and maybe a few friends). Must run fully in the
cloud with no PC, and stay inside Cloudflare's free limits.

## Key finding that makes this possible

OLX's JSON feed `https://www.olx.pl/api/v1/offers/` answers requests made
from a Cloudflare Worker (tested 2026-11-15 via a throwaway `olx-test` Worker:
HTTP 200, real listings with id, url, title, created/refresh time, params
incl. price, location, photos). It blocks this Claude cloud sandbox (403
from CloudFront) — so all OLX calls must happen inside the Worker, never from
a scheduled task or GitHub Actions.

## Goals

- Saved searches per chat, several per person (cap: 10).
- Each search has:
  - **Category** — picked from a 2-level menu of OLX categories (top level →
    subcategory), or "any".
  - **Keywords** — free text sent to OLX as `query` (e.g. "thinkpad").
  - **Location** — Warsaw by default; optionally Warsaw districts; optionally
    another city typed by name (resolved via OLX's location lookup), or
    "whole Poland".
  - **Price** — from/to in zł, or "free only".
  - **Real items only** switch (on by default) — drops parts, broken items,
    services and repairs ("na części", "uszkodzony", "nie działa", "naprawa",
    "serwis", "skup", "wymiana matrycy", …). Applied by the bot to title +
    description, since OLX can't exclude words itself.
  - **Excluded words** — the person's own list, applied the same way.
  - **Delivery** — off / hourly / every 3 hours / daily (09:00 Warsaw).
- **Show what's listed now**: runs the search immediately, sends the newest
  matches (first 5, then a "Show 5 more" button, up to 20), and marks them as
  seen so a subscription only sends things that are new after that.
- **Subscription batches**: a short header ("🔔 New for <search name>: 3")
  then the listings.
- **Listing message**: one photo (OLX's own image URL — Telegram fetches it,
  we store nothing) with a caption: title, price, place (city/district), time
  posted, and an "Open on OLX" link button. Falls back to text-only if there
  is no photo or Telegram can't fetch it.
- **Ready-made searches**, addable with one tap from the menu, so the old
  bot's purpose survives: "Free stuff — Warsaw" (Oddam za darmo, Warsaw,
  real-items-only on, plus the old scraper's exclusions: animals, baby
  items/furniture, food).
- Keep the 6 UI languages already in the bot (EN, PL, RU, BE, UK, DE) and the
  per-chat language stored as `lang:<chatId>`. Listings stay in Polish.

## Non-goals

- No payments / Premium / instant delivery tier.
- No translation of listing text.
- No storage of listing text or photos, and no GitHub backup of listings
  (`data/offers.json` and the GitHub-backup code go away).
- Not every OLX attribute filter (rooms, mileage, condition…). Category,
  keywords, location, price and the junk filters only. Category-specific
  attribute filters can come later.

## Anti-goals (failure even if it "works")

- Sending the same listing twice to the same search.
- Flooding a chat: a single batch is capped (10 listings; the rest summarized
  as "+N more — tap Show now").
- Breaking the live bot with no way back — see Rollout.
- Any secret in the repo, a commit, or a scheduled-task prompt.
- Silently dying: if OLX starts refusing the Worker, Alex must hear about it.

## Constraints

- Cloudflare Workers free plan: KV 100k reads / 1k writes per day, cron
  triggers allowed, 50 outbound requests per invocation.
- One Worker, one KV namespace (`OFFERS_KV`), auto-deployed from `main` by
  Workers Builds — so merging the Worker change to `main` IS the deploy and
  needs Alex's explicit go-ahead.
- Telegram limits: ~30 messages/sec overall, 1 msg/sec per chat (be gentle in
  batches: small delay between sends).

## Approaches considered

- **A. Upgrade the existing Worker and bot — chosen by Alex.** Same bot, KV,
  secrets and auto-deploy; add saved searches, filter menus and a Cloudflare
  cron trigger. Old free-stuff feed is replaced by a ready-made search.
- B. New separate bot + Worker. Leaves the old bot untouched but doubles
  upkeep and needs a new BotFather token/KV/secrets; the old feed is dead
  since September anyway. Rejected.
- Ruled out: Chrome scheduled tasks (need the PC, can't do per-user
  searches) and GitHub Actions runners (datacenter IPs, likely blocked like
  the sandbox).

## How it works

### Data in KV (all small)

- `lang:<chatId>` — unchanged.
- `searches:<chatId>` — JSON list of saved searches:
  `{ id, name, categoryId, categoryName, query, location:{cityId?, districtIds?, regionId?, label}, priceFrom?, priceTo?, freeOnly, realItemsOnly, excludeWords[], delivery: "off"|"1h"|"3h"|"daily", lastRunAt }`
- `seen:<chatId>:<searchId>` — the last ~200 OLX listing ids already sent
  (newest kept). Written only when something new was sent.
- `draft:<chatId>` — the search being edited plus "waiting for text input"
  state (e.g. after "✏️ Keywords" the next message is the keywords). Short
  TTL (1 day).
- `subs` — index list of `chatId:searchId` with delivery ≠ off, so the cron
  doesn't have to list all keys.
- `health` — last OLX success/failure time + consecutive failure count.

Budget check: 10 hourly searches ≈ 240 runs/day ≈ ≤240 writes (only on new
results) and a few hundred reads — far under limits.

### OLX requests

`GET https://www.olx.pl/api/v1/offers/?offset=0&limit=40&sort_by=created_at:desc&query=…&category_id=…&city_id=…&district_id=…&filter_float_price:from=…&filter_float_price:to=…`
(free-only = OLX's free price filter / the "Oddam za darmo" category as the
API supports). Same browser-like User-Agent and `Accept-Language: pl-PL` as
the successful test.

Category tree and location lookup come from OLX's own feed
(`/api/v1/categories/`, `/api/v1/geo-encoder/` or equivalent — builder to
confirm the exact endpoints from the Worker) and are cached in KV for a week.
The 2-level category menu shows a curated top-level list (Elektronika, Dom i
ogród, Moda, Sport i hobby, Muzyka i edukacja, Dla dzieci, Motoryzacja,
Nieruchomości, Oddam za darmo …) with OLX's subcategories under each.

**Sorting caveat:** in the test, `sort_by=created_at:desc` returned an old
promoted ad first. The builder must find the parameter OLX honours for
"newest". Either way the bot itself sorts results by `created_time` and drops
promoted/old ones (older than the search's last run, or older than 7 days
for "Show now").

### Matching after OLX returns

1. Drop ids already in `seen`.
2. Real-items-only: drop if title/description matches the junk word list
   (Polish, inflection-tolerant stems; list lives at the top of the Worker
   so it's easy to extend).
3. Drop if any of the search's excluded words match.
4. Price double-check against priceFrom/priceTo (OLX sometimes mixes
   "do negocjacji"/exchange listings).

### Cron

`[triggers] crons = ["7 * * * *"]` in `wrangler.toml` (hourly, minute 7).
Each run: read `subs`, pick searches that are due (1h / 3h / daily at 09:00
Europe/Warsaw), run each (cap ~40 searches per run to stay under the
50-subrequest limit; the rest roll to the next run), send new matches,
update `seen` and `lastRunAt`.
If OLX fails (non-200 or non-JSON) 3 runs in a row, message `ADMIN_CHAT_ID`
once ("OLX is refusing the bot since …") and again when it recovers. This
replaces the old freshness watchdog.

### Bot UI (inline buttons, like the rent bot)

`/start` → language (first time only) → main menu:

```
🔎 My searches          ➕ New search
⭐ Ready-made: Free stuff Warsaw
🌐 Language
```

A search's screen (also the editor for a new one):

```
🔎 ThinkPad under 1500
📂 Elektronika › Laptopy
🔤 thinkpad
📍 Warszawa (Mokotów, Wola)
💰 0–1500 zł
🧹 Real items only: on   🚫 Excluded: dell, hp
🔔 Delivery: hourly

[📂 Category] [🔤 Keywords]
[📍 Location] [💰 Price]
[🧹 Real items: on] [🚫 Excluded words]
[🔔 Delivery]
[📬 Show what's listed now]
[✏️ Rename] [🗑 Delete]   [⬅️ Back]
```

Text input (keywords, price, excluded words, city name, rename) is a prompt
message + "the next text you send is the answer", with a Cancel button.
Commands: `/start`, `/searches`, `/new`, `/language`, `/help`.

### Endpoints after the change

Kept: `GET /health`, `POST /webhook`, `GET /admin/set-webhook`,
`GET /admin/webhook-info`, `POST /admin/alert`.
Removed: `GET/POST /offers` (scraper ingest and the debug read) and GitHub
backup; `GITHUB_REPO`/`GITHUB_FILE` vars and `GITHUB_PAT` secret become
unused (Alex can delete the PAT later).
New: `scheduled()` handler (cron), and `GET /admin/run-cron?secret=…` to
trigger one run by hand for testing.

## Rollout

1. Build on branch `claude/friendly-newton-dgdkcm`, with local tests (node)
   for: query building, junk/excluded filtering, seen-dedup, due-time logic,
   message formatting — using a saved real OLX response as a fixture.
2. Before merging, run the new code against real OLX once from the throwaway
   `olx-test` Worker (Alex pastes it, no secrets, no bot) to confirm the
   category/location endpoints and the sort parameter.
3. **Ask Alex** before merging to `main` (= deploy). After deploy: Alex
   presses /start, creates a search, taps Show now, sets hourly; we trigger
   `/admin/run-cron` once to confirm a batch.
4. Rollback if needed: Cloudflare dashboard → olx-free-stuff-worker →
   Deployments → Rollback (one click), then `git revert` on main.
5. **Ask Alex** before retiring the two scheduled tasks (disabled scraper
   `trig_01KefjPocyMk5isGEV6gDGvX`, freshness watchdog
   `trig_01Uf35WF3PkZr8QzTmRDfYte` — the watchdog would false-alarm once
   `/offers` is gone, so disable it in the same step as the deploy).
6. Update `README.md`, `CLAUDE.md` (incl. the repo-name correction: the
   Worker is linked to `alexalkor/olx-free-stuff-bot`, the old name of this
   repo), and mark `scheduled-task/olx-scrape-task.md` as retired.

## Calls made by Claude (Alex to check)

- Keep all 6 UI languages.
- Up to 10 saved searches per chat; batches capped at 10 listings.
- Delivery options: off / hourly / every 3h / daily at 09:00.
- One photo per listing (not a 3-photo album) to keep batches compact.
- Real-items-only filter on by default.
- Old scraper's exclusions (animals, baby items, food) baked into the
  "Free stuff — Warsaw" ready-made search only, not into every search.
- Category-specific attribute filters (rooms, condition, …) deferred.

## Left to the builder

- Exact OLX endpoints/params for categories, location lookup, districts,
  free-price filter and newest-first sort (confirm via `olx-test`).
- Exact junk-word list and stem matching.
- Wording of all UI strings in the 6 languages.
- Code layout: may split the Worker into a few modules under `cloudflare/`
  (Workers Builds bundles them) if one file gets unwieldy.

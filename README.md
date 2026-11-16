# OLX Search Bot (Telegram)

OLX search inside Telegram. Each person saves their own searches —
category, keywords, location (city / districts / whole Poland), price or
"free only", a **"real items only"** switch that hides parts, broken items and
repair services, and their own excluded words — then either refreshes a search
with one tap (**📬 Show what's listed now**) or subscribes to it (every hour,
every 3 hours, or daily at 9:00) and gets new listings delivered as they appear.
The category menu is OLX's own live category tree, to any depth
(Elektronika › Komputery › Laptopy › Lenovo), with listing counts.
A ready-made **"Free stuff — Warsaw"** search keeps the bot's original purpose.

Bot: `@olxfreestuffbot` (display name can be changed in BotFather).
Menus in English, Polish, Russian, Belarusian, Ukrainian and German; listings
are shown as posted on OLX (Polish).

## How it works

```
Telegram  <--webhook-->  Cloudflare Worker (olx-free-stuff-worker)  --GET-->  OLX public JSON feed
                               |   ^ hourly cron (minute 7)                  (www.olx.pl/api/v1)
                               v
                          Workers KV: saved searches, ids already sent, language
```

- The Worker asks OLX's own JSON feed directly. OLX answers requests from
  Cloudflare (checked 2026-11-15) but blocks most other cloud machines, so
  all OLX calls happen inside the Worker. No scraper, no PC, no browser.
- Nothing heavy is stored: per chat, the saved searches (max 10) and, per
  search, the newest 200 OLX listing ids already sent (so nothing is sent
  twice). Photos are loaded by Telegram straight from OLX's image servers.
- "New" means posted after you subscribed. OLX's own "newest" order is really
  "most recently refreshed" with paid ads on top, so the bot sorts by the
  real posting time itself.
- If OLX refuses the hourly check 3 times in a row, `ADMIN_CHAT_ID` gets one
  Telegram alert, and another when it recovers.

Code: [`cloudflare/olx-free-stuff-worker.js`](cloudflare/olx-free-stuff-worker.js)
(entry) and [`cloudflare/lib/`](cloudflare/lib/) (one file per job — see the
header comment of the entry file). Design:
[`docs/superpowers/specs/2026-11-15-olx-search-bot-design.md`](docs/superpowers/specs/2026-11-15-olx-search-bot-design.md).

## Deploying

Workers Builds deploys `main` automatically on every push (preview copies are
built for other branches). Merging to `main` therefore updates the live bot.
Rollback: Cloudflare dashboard → `olx-free-stuff-worker` → Deployments →
Rollback.

Cloudflare settings this Worker needs:
- KV binding `OFFERS_KV` (in `wrangler.toml`)
- Secrets `BOT_TOKEN`, `WEBHOOK_SECRET`
- Variable/secret `ADMIN_CHAT_ID` (alerts)
- Cron trigger `7 * * * *` (in `wrangler.toml`)

## Endpoints

| Path | Auth | What it does |
|---|---|---|
| `GET /health` | — | liveness + version |
| `POST /webhook` | Telegram secret token | Telegram updates |
| `GET /admin/set-webhook` | `X-Secret` header or `?secret=` | register the webhook with Telegram |
| `GET /admin/webhook-info` | same | Telegram `getWebhookInfo` |
| `POST /admin/alert` | same | send `{ "message": "…" }` to `ADMIN_CHAT_ID` |
| `GET/POST /admin/run-cron` | same | run the hourly subscription check now |
| `GET /admin/olx-get?path=/…` | same | read-only GET of a public www.olx.pl page/API (for debugging; OLX blocks most other cloud machines) |

The old `GET/POST /offers` endpoints (scraper ingest) and the GitHub backup to
`data/offers.json` were removed in v3; `data/offers.json` is the last snapshot
from the retired scraper and is no longer updated.

## Tests

```bash
npm test
```

Node 20+, no dependencies. Tests use a saved real OLX response
(`tests/fixtures/olx-offers.json`) and fake Telegram/KV.

## Repository layout

- `cloudflare/` — the live Worker
- `tests/` — `node:test` tests
- `docs/superpowers/` — design and build plan
- `scheduled-task/olx-scrape-task.md` — the retired Chrome scraper's instructions (history)
- `data/offers.json` — last snapshot from the retired scraper
- `legacy/` — the original Railway/aiogram bot (not deployed)

## Legacy: the Railway/aiogram bot (not deployed)

Everything in this section describes the bot as it worked **before Railway
was decommissioned**. None of it runs today. It's left in the repo, under
[`legacy/`](legacy/), for reference; Telegram delivery has since been rebuilt
as a Cloudflare Worker acting as a Telegram webhook (the pattern
`warsaw-events-worker` uses for the sibling project), described above, rather
than a redeployed Railway/aiogram polling process.

<details>
<summary>Expand for the original Railway-era documentation</summary>

A Telegram bot built with Python and aiogram 3.x that posted free ("za
darmo") listings scraped from OLX. It supported 6 languages: Polish,
English, Russian, Belarusian, Ukrainian, and German.

### How it fit together (Railway era)

```
OLX Free Stuff Scrapper    this bot (Railway)      Telegram users
  (scheduled task)  --POST-->  /offers webhook  --menu-->  see the offers
                     (auth: X-Secret header)
```

1. The scheduled scraper task scraped OLX, filtered for free listings, and
   formatted them as a numbered, newline-separated list (see **Offer
   format** below).
2. It `POST`ed that text to the bot's `/offers` endpoint.
3. The bot stored it (SQLite + a GitHub-backed JSON backup so it survived
   redeploys), machine-translated it into the other 5 languages in the
   background, and served it to any user who tapped the **Free OLX offers**
   button in the menu.

### Setup

1. **Prerequisites**: Python 3.10+
2. **Install dependencies**: `cd legacy && pip install -r requirements.txt`
3. **Configure environment**: `cp .env.example .env` (inside `legacy/`), then fill in:

   | Variable | Purpose |
   |-------------------|--------------------------------------------------------------------------|
   | `BOT_TOKEN` | Telegram bot token from @BotFather (for `@olxfreestuffbot`) |
   | `WEBHOOK_SECRET` | Shared secret the scraper's scheduled task must send as `X-Secret` |
   | `PORT` | HTTP port for the aiohttp server (Railway set this automatically) |
   | `ADMIN_USER_ID` | Telegram numeric user ID (send `/myid` to the bot to find it) |
   | `GITHUB_PAT` | A GitHub PAT with `contents:write` on this repo, for the JSON backup |
   | `MYMEMORY_EMAIL` | Email registered with MyMemory for the higher 50k-word/day quota |
   | `GITHUB_REPO` | `owner/repo` — defaults to `alexalkor/olx-bot` |

4. **Run the bot**: `python main.py` (from inside `legacy/`) — polls Telegram
   for updates and also runs a small HTTP server (for the scraper webhook +
   health checks).

### Commands

| Command | Description |
|--------------|--------------------------------------------------|
| `/start` | Shows the language picker (new users) or menu |
| `/language` | Shows the language picker again |
| `/help` | Displays help text in the user's chosen language |
| `/myid` | Replies with your Telegram user ID |

### Menu

- **🆓 Free OLX offers** — shows the current batch of free listings
- **🌐 Change language** — re-opens the language picker
- **⛔ Stop** — stops the bot (send `/start` to resume)

### Feeding it from the scheduled task (Railway era)

`POST /offers` with header `X-Secret: <WEBHOOK_SECRET>` and JSON body:

```json
{
  "text": "1. 🆓 Kanapa rozkładana, stan dobry\nOddam za darmo, trzeba odebrać.\n📍 Warszawa, Mokotów\n🔗 https://www.olx.pl/d/oferta/...\n\n2. 🆓 Zabawki dla dzieci\n...",
  "mode": "replace"
}
```

- `mode: "replace"` (default) — wipes the current batch and cached
  translations, then stores this text as the new one.
- `mode: "append"` — adds these listings onto the current batch instead of
  replacing it.

#### Offer format

Each offer was a numbered item (`N. `) so the bot could split long batches
across multiple Telegram messages without breaking one listing apart:

```
N. 🆓 <title>
<optional description line(s)>
📍 <location>
🔗 <OLX link>
```

Prefixing the title with the placeholder emoji `🆓` let the bot swap in a
more specific category emoji based on Polish keywords in the title — see
`_assign_emojis` in `main.py`.

Other legacy endpoints: `GET /debug` (version, cached-translation counts,
whether `GITHUB_PAT` is set), `POST /admin/clear-cache` (wipes cached
translations, same `X-Secret` auth), `GET /test-translate` (sanity-checks
the MyMemory integration).

### How it worked

- Offer text was stored per-batch in SQLite (`bot.db`) and mirrored to
  `data/offers.json` via the GitHub Contents API, so a Railway redeploy
  didn't lose the current listings.
- Translations (Polish → English/Russian/Belarusian/Ukrainian/German) were
  computed lazily via the free MyMemory API, cached in SQLite + the GitHub
  JSON backup.
- Language preference was stored per user in SQLite.
- `/myid` + `ADMIN_USER_ID` gave a manual way to push a batch of offers from
  Telegram itself.

</details>

## License

[MIT](LICENSE)

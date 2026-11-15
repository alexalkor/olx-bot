# OLX Search Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared free-stuff feed in `olx-free-stuff-worker` with per-chat saved OLX searches, "show now", and cron-driven subscriptions.

**Architecture:** One Cloudflare Worker (ES modules, bundled by Workers Builds/wrangler). Pure logic (OLX URL building + normalising, filtering, due-time, formatting, i18n) lives in small modules under `cloudflare/lib/` with node tests; the entry file wires routes, the Telegram webhook and the `scheduled()` cron handler. State is small JSON in the existing `OFFERS_KV`.

**Tech Stack:** Cloudflare Workers (ESM), Workers KV, Cron Triggers, Telegram Bot API, OLX `api/v1` JSON feed, `node:test` for tests (Node ≥ 20, no new dependencies).

**Spec:** `docs/superpowers/specs/2026-11-15-olx-search-bot-design.md`

## Global Constraints

- No secrets in any file, commit or comment (public repo).
- No new npm runtime dependencies; tests use `node:test` + `node:assert`.
- KV binding name stays `OFFERS_KV`; per-chat language key stays `lang:<chatId>`.
- 6 UI languages: en, pl, ru, be, uk, de. Listing text stays Polish.
- Max 10 saved searches per chat; batch cap 10 listings; Show-now pages of 5 up to 20; seen list keeps newest 200 ids.
- Delivery values: `"off" | "1h" | "3h" | "daily"`; daily fires on the first cron run at/after 09:00 Europe/Warsaw.
- Cron: `"7 * * * *"`; ≤ 40 OLX requests per cron run.
- OLX failure alert to `ADMIN_CHAT_ID` after 3 consecutive failed cron runs, once; a recovery message once.
- Merging to `main` deploys live — needs Alex's explicit go-ahead.

## Review Focus

- OLX returns a non-JSON / 403 / empty `data` → bot replies "OLX didn't answer, try later", cron counts a failure, never crashes or marks anything seen.
- Listing with no photo, or a photo Telegram refuses → falls back to a text message with the link.
- Text input arrives while no prompt is pending (or after the draft expired) → treated as a normal message (show main menu), not as keywords.
- Price input like "500", "100-500", "-1500", "1 500 zł", "abc" → parsed or politely rejected with the expected format.
- Same listing returned again after being bumped/refreshed → never re-sent to that search.

---

### Task 1: OLX client (`cloudflare/lib/olx.js`)

**Files:** Create `cloudflare/lib/olx.js`, `tests/fixtures/olx-offers.json`, `tests/olx.test.mjs`. Modify `package.json` (add `"test": "node --test tests/"`, `"type": "module"`).

**Interfaces — Produces:**
- `buildOffersUrl(search, { offset = 0, limit = 40 } = {}) -> string` — `https://www.olx.pl/api/v1/offers/?…` with `query`, `category_id`, `city_id`, `district_id`, `region_id`, price from/to, free filter, newest-first sort (exact param names confirmed by the probe).
- `normalizeOffer(raw) -> Offer` where `Offer = { id:number, url, title, description (plain text, ≤500 chars), createdAt:string ISO, refreshedAt, priceLabel:string, priceValue:number|null, isFree:boolean, city, district|null, photo:string|null (sized link, `{width}x{height}` → `800x600`), promoted:boolean }`.
- `fetchOffers(search, { fetchImpl = fetch, limit } = {}) -> Promise<{ ok:true, offers:Offer[] } | { ok:false, status:number, error:string }>` — sends browser UA + `Accept-Language: pl-PL`.

- [ ] Step 1: Save a real response (from the probe) as `tests/fixtures/olx-offers.json`.
- [ ] Step 2: Tests: URL for `{query:"thinkpad", categoryId:X, location:{cityId:17871, districtIds:[a]}, priceTo:1500}` contains exactly those params; `freeOnly` adds the free filter and no price params; `normalizeOffer` on fixture item 0 yields the fixture's id/title/priceLabel and a photo URL without `{width}`; description HTML tags stripped; `fetchOffers` with a fake fetch returning 403 → `{ok:false,status:403}`; non-JSON 200 → `ok:false`.
- [ ] Step 3: Run `npm test` → fail. Implement. Run → pass. Commit.

### Task 2: Filtering + due logic (`cloudflare/lib/filter.js`, `cloudflare/lib/schedule.js`)

**Interfaces — Produces:**
- `JUNK_STEMS: string[]` (parts/broken/services: `na części`, `na czesci`, `uszkodz`, `zepsut`, `nie dział`, `nie dzial`, `do naprawy`, `naprawa`, `naprawy`, `serwis`, `skup`, `wymiana`, `matryc`, `zasilacz`, `obudow`, `płyta główna`, `plyta glowna`, `klawiatur`, `bateri`, `części`, `czesci`) and `FREE_STUFF_EXCLUDES` (animals, baby items/furniture, food stems from `scheduled-task/olx-scrape-task.md` step 4).
- `matchesSearch(offer:Offer, search) -> boolean` — case- and diacritics-insensitive stem match on title + description against junk (if `realItemsOnly`) and `excludeWords`; price bounds check when `priceValue` known.
- `selectNew(offers, seenIds:number[], search, { since?:string }) -> Offer[]` — drop seen, drop non-matching, drop `createdAt < since` when given, sort newest `createdAt` first.
- `isDue(search, now:Date) -> boolean` and `warsawHour(now) -> number` — `1h`: lastRunAt null or ≥ 55 min ago; `3h`: ≥ 175 min; `daily`: Warsaw hour ≥ 9 and lastRunAt not on today's Warsaw date; `off`: false.

- [ ] Tests (`tests/filter.test.mjs`, `tests/schedule.test.mjs`): "Matryca do laptopa Lenovo" dropped with realItemsOnly, kept without; "Laptop Dell" dropped when excludeWords `["dell"]`, "DELL" too; "Zasilacz" diacritic-free variant "zasilacz" matched; seen ids dropped; result sorted newest first; daily at 08:59 Warsaw false, at 09:07 true, again same day false; 1h at 54 min false / 56 min true; DST: 2026-03-29 07:07Z is 09:07 Warsaw → true.
- [ ] Fail → implement → pass → commit.

### Task 3: Storage (`cloudflare/lib/store.js`)

**Interfaces — Produces** (all take `kv` = `env.OFFERS_KV`):
- `getSearches(kv, chatId) -> Search[]`, `saveSearches(kv, chatId, list)` (also syncs the `subs` index: add `chatId:searchId` when delivery ≠ off, remove otherwise).
- `newSearch(partial) -> Search` — defaults `{ id: 8-char random, name:"", categoryId:null, categoryName:"", query:"", location:{cityId:17871, label:"Warszawa"}, priceFrom:null, priceTo:null, freeOnly:false, realItemsOnly:true, excludeWords:[], delivery:"off", lastRunAt:null, createdAt: now ISO }`.
- `getSeen(kv, chatId, searchId) -> number[]`, `addSeen(kv, chatId, searchId, ids)` — prepend, dedupe, keep 200.
- `getDraft / setDraft(kv, chatId, {searchId, awaiting}) / clearDraft` — `expirationTtl: 86400`.
- `getSubs(kv) -> string[]`; `getHealth / setHealth(kv, {fails, lastOk, lastFail, alerted})`.
- `deleteSearch(kv, chatId, searchId)` — removes from list, `seen:` key and `subs`.

- [ ] Tests with an in-memory fake KV (`tests/helpers/fake-kv.mjs`: `get(key,{type})`, `put(key,val,opts)`, `delete`): 11th search rejected (`saveSearches` throws `"limit"`); seen capped at 200 newest; subs index follows delivery changes; delete cleans all three.
- [ ] Fail → implement → pass → commit.

### Task 4: i18n + formatting (`cloudflare/lib/i18n.js`, `cloudflare/lib/format.js`)

**Interfaces — Produces:**
- `t(lang, key, ...args) -> string` (falls back to `en`, then key); `LANG_NAMES`.
- `searchSummary(search, lang) -> string` (HTML) matching the spec's search screen block; `searchKeyboard(search, lang)`, `mainMenu(lang)`, `deliveryKeyboard(search, lang)`, `categoryKeyboard(parentId|null, lang)`, `districtKeyboard(search, lang)`, `langKeyboard()`.
- `offerCaption(offer, lang, now) -> string` — `<b>title</b>\n\n💰 price\n📍 city, district\n🕐 Posted at HH:MM (Warsaw) · N min/h ago` (≤ 1024 chars, HTML-escaped).
- Callback data scheme (≤ 64 bytes): `m:<action>`, `s:<searchId>:<action>[:<arg>]` — actions `open, show, more:<offset>, cat, catp:<id>, catset:<id>, kw, loc, dist:<id>, distall, city, price, free, real, excl, deliv, deliv:<value>, ren, del, delok`.

- [ ] Tests: every key exists in all 6 languages (loop over `en` keys); caption escapes `<`; caption ≤ 1024 for a 300-char title; all callback strings built by keyboards ≤ 64 bytes.
- [ ] Fail → implement → pass → commit.

### Task 5: Catalog (`cloudflare/lib/catalog.js`)

**Interfaces — Produces:** `CATEGORIES: {id, name, children?: {id,name}[]}[]` (curated top level per spec, ids from the probe), `WARSAW_CITY_ID = 17871`, `WARSAW_DISTRICTS: {id,name}[]`, `FREE_CATEGORY_ID`, `findCategory(id)`, `lookupCity(name, fetchImpl) -> {cityId,label}|null` (OLX location autocomplete), `readyMadeSearches() -> Search partials` ("Free stuff — Warsaw": free category, realItemsOnly, `excludeWords: FREE_STUFF_EXCLUDES`).
- [ ] Test: every child id unique; `findCategory` finds a child; ready-made search has free category. Commit.

### Task 6: Bot handlers (`cloudflare/lib/bot.js`)

**Interfaces — Consumes** Tasks 1–5. **Produces:** `handleUpdate(update, env, deps = { fetchImpl: fetch, now: () => new Date() })`, `runShowNow(env, chatId, search, offset, deps)`, `sendOffer(env, chatId, offer, lang, deps)` (sendPhoto with caption + inline "Open on OLX" url button; on Telegram error → sendMessage text).

Behaviour: `/start` (first time → language picker, else main menu), `/searches`, `/new`, `/language`, `/help`; callbacks per Task 4 scheme; text when a draft is awaiting → parse (keywords, price `parsePrice(text) -> {from,to}|null`, excluded words comma-separated, city name via `lookupCity`, rename) then re-show the search screen; otherwise main menu. Show now: fetch, `selectNew` with seen=[] for display but mark everything displayed as seen; 5 per page with "Show 5 more" up to 20; "Nothing matches right now" when empty; OLX failure → friendly error.

- [ ] Tests (`tests/bot.test.mjs`) with fake KV, fake fetch (OLX fixture + records Telegram calls): `/new` creates a draft search and shows its screen; tapping `kw` then sending "thinkpad" sets query; `parsePrice` cases from Review Focus; Show now sends ≤ 5 offers + "more" button and records seen ids; OLX 403 → one friendly message, seen unchanged; plain text with no draft → main menu; photo failure → text fallback.
- [ ] Fail → implement → pass → commit.

### Task 7: Cron + entry wiring

**Files:** Create `cloudflare/lib/cron.js`; rewrite `cloudflare/olx-free-stuff-worker.js`; modify `wrangler.toml` (add `[triggers] crons = ["7 * * * *"]`, drop GitHub vars), delete `data/offers.json` usage.

**Interfaces — Produces:** `runCron(env, deps) -> { checked, sent, failed }`.

Behaviour: read `subs`, load each chat's searches, `isDue` filter, cap 40, for each: `fetchOffers` → `selectNew(…, { since: search.createdAt })`, send up to 10 (header "🔔 New for <name>: N", "+N more" note if over), `addSeen` with all new ids, set `lastRunAt`. Health: any OLX failure in a run → `fails+1`; at 3 and not alerted → admin message; on success after alert → recovery message, reset. Entry: keep `/health` (VERSION `v3.0-olx-search`), `/webhook`, `/admin/set-webhook`, `/admin/webhook-info`, `/admin/alert`; add `GET /admin/run-cron` (X-Secret header or `?secret=`); remove `/offers` and GitHub backup; `scheduled(event, env, ctx)` → `ctx.waitUntil(runCron(env))`; on webhook, also call `setMyCommands` once per version (KV flag `cmds:<VERSION>`).

- [ ] Tests (`tests/cron.test.mjs`): a due hourly search with 3 new fixture offers sends header + 3 offers and stores seen; second run sends nothing; 3 failing runs → exactly one admin alert; success afterwards → one recovery message; 50 due searches → only 40 OLX calls.
- [ ] `npx wrangler deploy --dry-run --outdir /tmp/x` bundles without error (if wrangler installable; otherwise `node --check` each file).
- [ ] Commit.

### Task 8: Docs + rollout

- Update `README.md`, `CLAUDE.md` (architecture, status, repo-name correction), mark `scheduled-task/olx-scrape-task.md` retired; delete `tools/olx-probe-worker.js`.
- Push branch; get Alex's go-ahead; merge to `main`; verify `/health` shows v3.0; run `/admin/run-cron`; Alex tests in Telegram; with Alex's OK disable watchdog `trig_01Uf35WF3PkZr8QzTmRDfYte` (scraper is already disabled).

# Category filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-category OLX filters, a working Category & filters screen, and an 8-button search screen.

**Architecture:** OLX's filter catalog (`/api/v1/offers/metadata/filters/`, 1.5 MB, ~10 ms to parse) is
too heavy to parse inside a Worker request on the free plan, so a script slims it to
`cloudflare/lib/filters-data.js` (≈600 KB, bundled). `filters.js` answers "which filters does
category X have", builds URL params and labels; `filters-i18n.js` translates common Polish labels.

**Tech Stack:** Cloudflare Worker (ES modules), node:test.

**Spec:** `docs/superpowers/specs/2026-11-23-category-filters-design.md`

## Global Constraints
- Callback data ≤ 64 bytes. Old searches (no `filters`) behave exactly as before.
- Skip keys: `sort_by`, `filter_float_price`, `filter_enum_price`, `filter_enum_vin`, type `dynamicmultichoice`/`price`.
- URL params (verified live 2026-11-22): enum `key[i]=value`; range `key:from`/`key:to`;
  bool `key=1`; `owner_type=<value>` only when exactly one value picked.
- A category's filters = variants whose `categories` include that exact id (parents and children are listed explicitly; car Model only on brands).

## Review Focus
- Leaf category + 📂 tap must show a different screen (siblings, ✅ on current) — test.
- Switching category drops filters/values the new category lacks — test.
- Range typed as garbage keeps waiting; `-` clears — test.
- Car models list (BMW 47) pages at 20 — test.
- Unknown Polish label falls back to 🔧 + Polish — test.

---

### Task 1: data + filters.js
**Files:** Create `scripts/update-filters.mjs`, `cloudflare/lib/filters-data.js`, `cloudflare/lib/filters.js`, `cloudflare/lib/filters-i18n.js`; Test `tests/filters.test.mjs`
**Produces:**
- `categoryFilters(categoryId) -> [{key, kind:"enum"|"range"|"bool", label, unit, values:[[value,label]]}]` (OLX order)
- `filterParams(filters) -> [[name, value]]`
- `pruneFilters(filters, categoryId) -> filters`
- `filterName(f, lang)`, `valueName(label, lang)`, `filterValueText(f, sel, lang)`, `filtersSummary(search, lang)`
- [ ] Tests: 15 has rooms/m/furniture, no state; 183 has model (contains x5), petrol, car_body; 1199 has state; params for rooms two+three, m from 40, owner_type single/both, bool; prune 15→183 drops rooms; names en/ru for Liczba pokoi, 🔧 fallback.
- [ ] Implement, `npm test`, commit.

### Task 2: URL + store
**Files:** Modify `cloudflare/lib/olx.js` (`buildOffersUrl` appends `filterParams(search.filters||{})`), `cloudflare/lib/store.js` (`filters: {}`); Test `tests/olx.test.mjs`
- [ ] Test URL contains `filter_enum_rooms%5B0%5D=two`; old search URL unchanged. Implement, commit.

### Task 3: screens
**Files:** Modify `cloudflare/lib/bot.js`, `cloudflare/lib/format.js`, `cloudflare/lib/i18n.js`, `cloudflare/lib/catalog.js`; Test `tests/bot.test.mjs`, `tests/i18n.test.mjs`
Callbacks: `cat` current screen; `cp:<id>` browse; `cs:<id>` select → current screen; `flt` filters; `fk:<i>[:<page>]` filter values; `fv:<i>.<v>` toggle; `fa:<i>` any; `fb:<i>` bool toggle; `fc` clear all; `xtra` More screen. Draft `awaiting:"rng", fi:<i>` for ranges.
- [ ] Tests: search keyboard ≤ 8 buttons; leaf cat tap shows siblings + Filters/Up/Clear; flats rooms toggle saves `["two"]`; range `40-70` saves; `abc` re-asks; switching category prunes; More screen has Delete.
- [ ] Implement, `npm test`, bump VERSION, commit, push main, check `/health`, live-check URLs via `/admin/olx-get`.

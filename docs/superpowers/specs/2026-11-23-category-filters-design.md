# Category filters + tidier search screen — design (2026-11-23)

## Why
Alex picks a category (e.g. Nieruchomości › Mieszkania › Wynajem) and can't go
further: no rooms/size/furnished for flats, no model/fuel/body for cars, no
new/used for electronics. Tapping 📂 Category on a leaf category looks dead (it
re-selects the same leaf and redraws the same screen). He wants the bot to set
up a search as precisely as the OLX website, without a wall of buttons.

## Goals
- Every category offers its own OLX filters, any depth, without hand-made menus.
- 📂 Category always does something visible: go deeper, pick a sibling, clear it.
- Search screen stays at ≤ 8 buttons.
- Common filters read the same in all 6 languages, with emojis.
- Filters apply to "show now" and to subscriptions.

Non-goals: sorting, distance radius, currency, translating all ~370 filters.
Anti-goal: old saved searches break or change results.

## Approach (chosen)
Read OLX's own filter catalog and draw the buttons from it.
`GET /api/v1/offers/metadata/filters/` (≈1.5 MB) returns every filter for every
category: `data[<key>] = [variant…]`, each variant `{type, label, unit,
values:[{value,label}], options:[{categories:[ids], orderForSearch, ranges}]}`.
A category's filters = variants whose `options[].categories` contains the
category id or its nearest ancestor (cars: body/fuel are listed on 84 =
Samochody osobowe and on each brand). Confirmed live 2026-11-22:
`filter_enum_rooms[0]=two&filter_enum_rooms[1]=three&filter_float_m:from=40`
and `category_id=183&filter_enum_model[0]=x5&filter_enum_petrol[0]=diesel`
both filter correctly.

Rejected: hand-made per-category menus (covers only what we type, goes stale,
misses most of ~5,000 categories).

## Design
**Search screen** (8 buttons):
```
📬 Show what's listed now
📂 Category & filters   🔤 Keywords
📍 Location             💰 Price
🔔 New listings: off    ⋯ More
⬅️ Back
```
⋯ More → Free only, Real items only, Excluded words, Rename, Delete, Back.

**📂 Category & filters** screen: header shows the path and active filters.
- Subcategories of the current category (deeper), or — on a leaf — its
  siblings with the current one marked ✅.
- `⬆️ Up a level`, `✖️ Clear category`, `⚙️ Filters (n)`, `⬅️ Back`.
- With no category: top level, as today.

**⚙️ Filters** screen: one button per filter of the category, in OLX's
`orderForSearch` order, label showing current value (`🛏 Rooms: 2, 3`).
Skip `price` (has its own button), `sort_by`, and filters with no values and
no ranges. `✖️ Clear filters`, `⬅️ Back`.
- enum (select/checkboxes): tick list, several allowed; `Any` clears it.
  Long lists (car models) paged 20 at a time.
- float/input (m², year, mileage…): typed like price, `40-70`.
- Changing category drops filters the new category doesn't have.

**Storage**: `search.filters = { "filter_enum_rooms": ["two","three"],
"filter_float_m": {from:40,to:null} }`. `buildOffersUrl` adds
`key[i]=value` and `key:from/:to`. Missing `filters` = none (old searches
unchanged).

**Catalog cache**: the full catalog is too big per request; build a slim
per-category list (`key, type, label, unit, values`) and cache it in KV per
category for a day, like the category tree.

**Language**: i18n table for ~30 common filter keys (label + emoji) and their
common values in en/pl/ru/be/uk/de. Unknown keys/values → OLX's Polish label
with 🔧. Callback data uses value indices, not raw values (64-byte limit).

**Tests**: catalog slicing for 15 (flats rent), 183 (BMW), a laptop category;
URL building with enum + range; old search without filters; category screen
on a leaf; filter toggle round-trip. Then one live check per example through
`/admin/olx-get`.

## Left to the builder
Exact i18n wording; which ~30 keys (pick by frequency across categories);
paging size; callback encoding.

# OLX scraper — Claude Code scheduled task (read-only mirror)

This is **not executable code** and nothing in this repo runs it. It's a
plain-text copy of the instructions behind the Claude Code scheduled task
that does the actual scraping, kept here so the logic isn't invisible to
anyone just reading the git history. The real thing lives as a scheduled
task (trigger id `trig_01KefjPocyMk5isGEV6gDGvX`, name "OLX Free Stuff
Scrape") — edit it with Claude Code's scheduled-task tools, not by editing
this file. If you change the real task, update this mirror to match in the
same session.

**As of 2026-11, this task is disabled.** See the repo's `CLAUDE.md` for
current status and why.

The secret value below is a placeholder (`<WEBHOOK_SECRET>`) — the real
task must never have the literal secret typed into its prompt text. See
`CLAUDE.md` for how the secret should be supplied instead.

---

You are running a scheduled daily task with no memory of any prior
conversation. Your job: scrape OLX.pl's Warsaw "oddam za darmo" (free
stuff) listings via the user's Chrome browser, filter out unwanted
categories, exclude listings already seen in previous runs, and POST the
new qualifying items as JSON to the olx-free-stuff-worker Cloudflare Worker
(which backs them up to GitHub at alexalkor/olx-free-stuff-bot/data/offers.json
and serves the @olxfreestuffbot Telegram bot).

**Step 1 — Load Chrome tools.** Load browser automation tools with
ToolSearch query:
`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__javascript_tool`.
This task requires the user's Chrome browser (with the Claude-in-Chrome
extension) to be open/connected on their computer. If it's not available,
say so plainly in your final output rather than guessing at listings.

**Step 2 — Open the page.** Call `tabs_context_mcp` first, then open a NEW
tab (do not reuse a tab from another session) and navigate to:
`https://www.olx.pl/oddam-za-darmo/warszawa/?search%5Border%5D=created_at:desc&search%5Bfilter_float_price:from%5D=free`
Listings are sorted newest-first.

**Step 3 — Extract listings.** Use `get_page_text`/`read_page` to extract
each listing's: title, URL/link, short description snippet, posted time if
shown, and category/breadcrumb if visible. Scroll/paginate enough to
capture roughly the newest 60 listings (about the last day or two of
postings — no need to go further back since this runs daily). Note: OLX's
listing grid is virtualized — `read_page` only shows rows currently
rendered near the viewport, so scroll in small increments (~8-10 ticks)
and call `read_page` after each scroll to avoid skipping rows between
reads.

**Step 4 — Filter out unwanted categories.** Exclude any listing that is
primarily about:
- Animals/pets (e.g. zwierzęta, pies, kot, szczeniak, kotek, klatka,
  akwarium z rybkami, karma dla zwierząt)
- Broken/damaged/non-functional items (e.g. uszkodzone, zepsute, do
  naprawy, na części, nie działa, uszkodzony)
- Baby/infant clothing (e.g. ubranka niemowlęce, ubrania dla
  dziecka/niemowlaka) — this includes children's shoes/sandals in child
  sizes
- Baby/children's furniture and gear (e.g. łóżeczko dziecięce, kojec,
  przewijak, fotelik samochodowy, wózek dziecięcy, krzesełko do karmienia,
  rowerek dziecięcy) — regular adult furniture (meble, szafa, kanapa,
  stół, krzesło, fotel, łóżko, komoda) is NOT excluded and should be
  included if it otherwise qualifies
- Food (e.g. jedzenie, żywność, produkty spożywcze)

Use judgment based on title + description + OLX's own category label when
shown, not just rigid keyword matching — Polish listings phrase things in
varied ways. Keep original Polish text in the payload; no need to
translate.

**Step 5 — Deduplicate against previous runs.** This session should be
attached to the claude.ai Project "Olx Free Stuff Bot". Use the Projects
tool: `project_read` the doc at path `claude/olx_seen_listings.json` — it's
JSON shaped like `{"seen_urls": [...]}`. A listing counts as "new" for this
run's payload only if its URL is NOT already in `seen_urls`. If the
Projects tool errors, the doc is missing, or this session isn't bound to
that project, treat every currently-qualifying listing as new for this
run, and note this limitation clearly in your final output (dedup state
could not be read).

**Step 6 — Build the JSON payload.**
```json
{
  "date": "<today's date, YYYY-MM-DD>",
  "listings": [
    {"title": "...", "link": "https://www.olx.pl/d/oferta/...", "description": "...", "posted_at": "..."}
  ]
}
```
Include only the NEW listings that passed both the category filter (step
4) and the dedup check (step 5). Links must be the full
`https://www.olx.pl/...` URL. If there are zero new qualifying listings,
still POST with an empty `listings` array (don't skip the POST) so the
worker/bot state reflects "nothing new today" — but note the zero count
clearly in your final chat output.

**Step 7 — Deliver it to the Cloudflare Worker.** POST to
`https://olx-free-stuff-worker.alexandr130514.workers.dev/offers` with
header `X-Secret: <WEBHOOK_SECRET>` and the JSON body from step 6. (As of
the 2026-11 cleanup this should be a direct request from the sandbox with
the secret injected by the environment's credential store — not a
browser-relayed fetch with the secret typed in plain text. If the
environment can't reach that host directly, that's a setup problem to
fix, not a reason to fall back to pasting the real secret into this
prompt.) Report the parsed result in your final chat output, including the
count and whether the GitHub backup succeeded (`github.status`). If the
request fails, say so plainly — do not silently treat it as success.

**Step 8 — Update dedup state.** Add the URL of every listing encountered
in step 3 (whether or not it passed the category filter — this stops the
same excluded listing from being re-evaluated every day) to `seen_urls`.
Keep only the most recent 500 URLs (trim the oldest ones if the list would
exceed that). Write the updated JSON back to `claude/olx_seen_listings.json`
via `project_write`. Skip this step (and say so in your output) if step 5
already determined dedup state isn't accessible.

**Step 9 — Final summary.** State clearly: how many new listings were
found, whether the worker POST succeeded, whether the GitHub backup
succeeded, and whether dedup state was read/written successfully.

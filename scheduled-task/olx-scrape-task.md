# OLX scraper — Claude Code scheduled task (read-only mirror)

This is **not executable code** and nothing in this repo runs it. It's a
plain-text copy of the instructions behind the Claude Code scheduled task
that does the actual scraping, kept here so the logic isn't invisible to
anyone just reading the git history. The real thing lives as a scheduled
task (trigger id `trig_01KefjPocyMk5isGEV6gDGvX`, name "OLX Free Stuff
Scrape") — edit it with Claude Code's scheduled-task tools (or the Claude
desktop app on the computer it's bound to), not by editing this file. If
you change the real task, update this mirror to match in the same session.

**As of 2026-11, this task is disabled, and staying off until Alex says
otherwise.** See the repo's `CLAUDE.md` for current status and why. A
separate, fully-cloud scheduled task ("OLX offers freshness watchdog",
`trig_01Uf35WF3PkZr8QzTmRDfYte`) watches for this task going silent and
alerts via Telegram — it doesn't replace this task, it just notices when
this one isn't running.

**As of 2026-11-06, the secret has been rotated and is stored as a proper
credential** (no longer typed in plain text in the task's instructions —
the placeholder header value below is replaced automatically by the
environment's network proxy). The pending change below (switching step 7
from a browser-relayed fetch to a direct sandbox request) is proposed but
not yet applied to the real task — it needs approval from a Cowork
conversation linked to the computer the task runs on ("AlexPC"), or a
manual edit there. This file already reflects the *intended* version.

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
extension) to be open/connected on their computer — needed for the
scraping step only (steps 2-3), NOT for delivery (step 7, which now runs
as a direct sandbox request). If Chrome isn't available, say so plainly in
your final output rather than guessing at listings.

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

**Step 7 — Deliver it to the Cloudflare Worker.** POST the JSON payload
directly from the sandbox with a plain curl call (do NOT route this
through the browser — the sandbox's environment has direct network access
to this host and an auto-injected credential):

```
curl -s -X POST https://olx-free-stuff-worker.alexandr130514.workers.dev/offers \
  -H "Content-Type: application/json" \
  -H "X-Secret: proxy-injected" \
  -d '<the JSON payload from step 6, as a compact JSON string>'
```

IMPORTANT: `proxy-injected` above is a placeholder, not a real secret —
this environment's network proxy replaces that header's value
automatically before the request leaves the sandbox. NEVER put the actual
`WEBHOOK_SECRET` value in this task's instructions or in any file; doing
so defeats the point of storing it as a credential. If the response is
401/403 (unauthorized), do not retry with a guessed header value — report
the failure plainly in your final output (it likely means the stored
credential for this host needs to be re-saved via `request_credential` by
the user, or the host's network access rule changed) and stop.

Parse the JSON response and report it in your final chat output, including
the count and whether the GitHub backup succeeded (`github.status`). If
the request fails for any other reason (connection error, non-200/201
without `ok:true`, or `github.status` indicating failure), say so plainly
— do not silently treat it as success.

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

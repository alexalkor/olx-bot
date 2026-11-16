// OLX search bot — Cloudflare Worker (v3)
//
// A Telegram bot that is "OLX search inside Telegram": each chat saves its own
// searches (category, keywords, location, price, junk filters), refreshes them
// with one tap ("Show what's listed now"), and can subscribe so new matches
// arrive on their own (hourly / every 3h / daily). The Worker asks OLX's public
// JSON feed directly — no scraper, no PC, nothing stored but the searches
// themselves and the ids of listings already sent. Photos are shown straight
// from OLX's image servers.
//
// Code layout (all bundled by wrangler / Workers Builds):
//   cloudflare/lib/olx.js       OLX feed client (search, cities, districts, slugs)
//   cloudflare/lib/catalog.js   category menu (resolved from OLX on first use)
//   cloudflare/lib/filter.js    "real items only", excluded words, dedupe
//   cloudflare/lib/schedule.js  when a subscription is due
//   cloudflare/lib/store.js     what is kept in KV and under which keys
//   cloudflare/lib/i18n.js      menu text in 6 languages
//   cloudflare/lib/format.js    messages and buttons
//   cloudflare/lib/bot.js       Telegram updates (commands, buttons, answers)
//   cloudflare/lib/cron.js      hourly subscription check + OLX health alert
//
// Required setup in the Cloudflare dashboard for this Worker:
//   Bindings:  KV namespace OFFERS_KV (unchanged)
//   Secrets:   BOT_TOKEN       Telegram bot token
//              WEBHOOK_SECRET  Telegram webhook secret_token, and the key for
//                              /admin/* (X-Secret header or ?secret=)
//   Variables: ADMIN_CHAT_ID   chat that gets "OLX is refusing the bot" alerts
//   Cron:      "7 * * * *" — declared in wrangler.toml
//
// Endpoints:
//   GET  /health              -> liveness + version
//   POST /webhook             -> Telegram updates
//   GET  /admin/set-webhook   -> registers this Worker's /webhook with Telegram
//   GET  /admin/webhook-info  -> Telegram getWebhookInfo
//   POST /admin/alert         -> send a message to ADMIN_CHAT_ID
//   GET|POST /admin/run-cron  -> run the hourly subscription check now
//   GET  /admin/olx-get?path= -> read-only GET of a public www.olx.pl page/API
//                                (OLX blocks Claude's cloud sandboxes but not
//                                this Worker; lets a session inspect OLX)
//
// This file IS the source of truth: Workers Builds deploys it on every push to
// `main`. Don't hand-edit the Worker in the dashboard.

import { handleUpdate, send, tg } from "./lib/bot.js";
import { runCron } from "./lib/cron.js";
import { OLX_HEADERS } from "./lib/olx.js";

const VERSION = "v3.2-olx-search";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function deps() {
  return { fetchImpl: (...a) => fetch(...a), now: () => new Date() };
}

function isAdmin(request, url, env) {
  if (!env.WEBHOOK_SECRET) return false;
  return request.headers.get("X-Secret") === env.WEBHOOK_SECRET || url.searchParams.get("secret") === env.WEBHOOK_SECRET;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") return json({ ok: true, version: VERSION });

    if (path === "/webhook" && request.method === "POST") {
      if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN not configured" }, 500);
      let update;
      try { update = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      ctx.waitUntil(handleUpdate(update, env, deps()).catch((e) => console.error("handleUpdate:", e && e.stack || e)));
      return json({ ok: true });
    }

    if (path.startsWith("/admin/")) {
      if (!isAdmin(request, url, env)) return json({ ok: false, error: "Unauthorized" }, 401);
      if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN not configured" }, 500);

      if (path === "/admin/set-webhook") {
        const webhookUrl = `${url.origin}/webhook`;
        const telegram = await tg(env, "setWebhook", { url: webhookUrl, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] }, deps());
        return json({ ok: true, webhookUrl, telegram });
      }
      if (path === "/admin/webhook-info") {
        return json({ ok: true, telegram: await tg(env, "getWebhookInfo", {}, deps()) });
      }
      if (path === "/admin/alert" && request.method === "POST") {
        if (!env.ADMIN_CHAT_ID) return json({ ok: false, error: "ADMIN_CHAT_ID not configured" }, 500);
        let payload = {};
        try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
        const message = typeof payload.message === "string" && payload.message.trim() ? payload.message : "⚠️ OLX bot alert";
        return json({ ok: true, telegram: await send(env, env.ADMIN_CHAT_ID, message, deps()) });
      }
      if (path === "/admin/olx-get" && request.method === "GET") {
        // Fixed host, GET only, path must be a plain absolute path on www.olx.pl.
        const p = url.searchParams.get("path") || "";
        if (!/^\/[^\s]*$/.test(p) || p.startsWith("//")) return json({ ok: false, error: "path must start with /" }, 400);
        const max = Math.min(Number(url.searchParams.get("max")) || 200000, 2000000);
        const r = await fetch("https://www.olx.pl" + p, { headers: OLX_HEADERS });
        const body = await r.text();
        return json({ ok: true, status: r.status, length: body.length, body: body.slice(0, max) });
      }
      if (path === "/admin/run-cron") {
        return json({ ok: true, result: await runCron(env, deps()) });
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, deps()).then((r) => console.log("cron", JSON.stringify(r))).catch((e) => console.error("cron:", e && e.stack || e)));
  },
};

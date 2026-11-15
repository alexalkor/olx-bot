// Hourly job: check every subscribed search that is due and send what's new.
import { t, I18N } from "./i18n.js";
import * as st from "./store.js";
import { fetchOffers } from "./olx.js";
import { selectNew } from "./filter.js";
import { isDue } from "./schedule.js";
import { send, sendOffer, tg } from "./bot.js";
import { escapeHtml, searchTitle } from "./format.js";

export const MAX_OLX_PER_RUN = 40;
export const BATCH_MAX = 10;
export const ALERT_AFTER_FAILS = 3;
export const COMMANDS_VERSION = "v3.0";

async function ensureCommands(env, deps) {
  const kv = env.OFFERS_KV;
  if (await kv.get(`cmds:${COMMANDS_VERSION}`)) return;
  const list = (lang) => ["start", "searches", "new", "language", "help"].map((c) => ({ command: c, description: t(lang, `cmd_${c}`) }));
  let ok = (await tg(env, "setMyCommands", { commands: list("en") }, deps)).ok;
  for (const lang of Object.keys(I18N)) {
    if (lang === "en") continue;
    const r = await tg(env, "setMyCommands", { commands: list(lang), language_code: lang }, deps);
    ok = ok && r.ok;
  }
  if (ok) await kv.put(`cmds:${COMMANDS_VERSION}`, "1");
}

export async function runCron(env, deps) {
  const kv = env.OFFERS_KV;
  const now = deps.now();
  await ensureCommands(env, deps).catch((e) => console.error("setMyCommands", e));

  const subs = await st.getSubs(kv);
  const byChat = new Map();
  for (const key of subs) {
    const [chatId, searchId] = key.split(":");
    if (!byChat.has(chatId)) byChat.set(chatId, []);
    byChat.get(chatId).push(searchId);
  }

  let calls = 0, ok = 0, failed = 0, sent = 0;
  for (const [chatId, ids] of byChat) {
    if (calls >= MAX_OLX_PER_RUN) break;
    const searches = await st.getSearches(kv, chatId);
    const lang = (await st.getLang(kv, chatId)) || "en";
    let changed = false;
    for (const s of searches) {
      if (!ids.includes(s.id) || !isDue(s, now)) continue;
      if (calls >= MAX_OLX_PER_RUN) break; // the rest waits for the next run
      calls++;
      const r = await fetchOffers(s, { fetchImpl: deps.fetchImpl });
      if (!r.ok) { failed++; console.error("cron OLX fail", r.status, r.error); continue; }
      ok++;
      const seen = await st.getSeen(kv, chatId, s.id);
      const fresh = selectNew(r.offers, seen, s, { since: s.subscribedAt || s.createdAt });
      if (fresh.length) {
        await send(env, chatId, t(lang, "batch", escapeHtml(searchTitle(s, lang)), fresh.length), deps);
        for (const o of fresh.slice(0, BATCH_MAX)) { await sendOffer(env, chatId, o, lang, deps); sent++; }
        if (fresh.length > BATCH_MAX) {
          await send(env, chatId, t(lang, "batch_more", fresh.length - BATCH_MAX), deps, {
            reply_markup: { inline_keyboard: [[{ text: t(lang, "b_show"), callback_data: `s:${s.id}:show` }]] },
          });
        }
        await st.addSeen(kv, chatId, s.id, fresh.map((o) => o.id));
      }
      s.lastRunAt = now.toISOString();
      changed = true;
    }
    if (changed) await st.saveSearches(kv, chatId, searches);
    // Drop index entries whose search was deleted.
    const live = new Set(searches.map((s) => s.id));
    if (ids.some((id) => !live.has(id))) await st.saveSearches(kv, chatId, searches);
  }

  // OLX health: alert the admin once after repeated failures, and once on recovery.
  if (calls > 0) {
    const h = await st.getHealth(kv);
    if (ok > 0) {
      if (h.alerted && env.ADMIN_CHAT_ID) await send(env, env.ADMIN_CHAT_ID, t("en", "recovered"), deps);
      if (h.fails || h.alerted || !h.lastOk || now - Date.parse(h.lastOk) > 6 * 3600e3) {
        await st.setHealth(kv, { fails: 0, lastOk: now.toISOString(), lastFail: h.lastFail, alerted: false });
      }
    } else {
      const fails = (h.fails || 0) + 1;
      let alerted = h.alerted;
      if (fails >= ALERT_AFTER_FAILS && !alerted && env.ADMIN_CHAT_ID) {
        await send(env, env.ADMIN_CHAT_ID, `⚠️ OLX search bot: OLX has refused the last ${fails} hourly checks (since ${h.lastOk || "unknown"}). Subscriptions are paused until it answers again.`, deps);
        alerted = true;
      }
      await st.setHealth(kv, { ...h, fails, lastFail: now.toISOString(), alerted });
    }
  }
  return { checked: calls, ok, failed, sent };
}

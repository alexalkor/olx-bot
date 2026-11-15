// Telegram update handling: commands, menu buttons, text answers, "show now".
import { t, LANG_NAMES } from "./i18n.js";
import * as st from "./store.js";
import * as f from "./format.js";
import { fetchOffers, lookupCity } from "./olx.js";
import { selectNew, FREE_STUFF_EXCLUDES } from "./filter.js";
import { getTopCategories, getSubcategories, getDistricts, FREE_CATEGORY_ID } from "./catalog.js";

export const PAGE = 5;
export const SHOW_MAX = 20;
const SHOW_MAX_AGE_DAYS = 30;

const defaultDeps = () => ({ fetchImpl: (...a) => fetch(...a), now: () => new Date() });

export async function tg(env, method, body, deps) {
  try {
    const r = await deps.fetchImpl(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

export function send(env, chatId, text, deps, extra = {}) {
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }, deps);
}

// Edit the menu message in place when possible, otherwise send a new one.
async function render(env, chatId, msgId, text, keyboard, deps) {
  if (msgId) {
    const r = await tg(env, "editMessageText", {
      chat_id: chatId, message_id: msgId, text, parse_mode: "HTML", disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    }, deps);
    if (r && (r.ok || /not modified/i.test(r.description || ""))) return r;
  }
  return send(env, chatId, text, deps, keyboard ? { reply_markup: keyboard } : {});
}

export async function sendOffer(env, chatId, offer, lang, deps) {
  const caption = f.offerCaption(offer, lang, deps.now());
  const reply_markup = f.offerKeyboard(offer, lang);
  if (offer.photo) {
    const r = await tg(env, "sendPhoto", { chat_id: chatId, photo: offer.photo, caption, parse_mode: "HTML", reply_markup }, deps);
    if (r && r.ok) return r;
  }
  return send(env, chatId, caption, deps, { reply_markup });
}

export function parsePrice(text) {
  const s = String(text || "").toLowerCase().replace(/z[łl]/g, "").replace(/(\d)[\s .](?=\d{3}\b)/g, "$1").trim();
  if (s === "-" || s === "–") return { from: null, to: null };
  let m = s.match(/^(\d+)$/);
  if (m) return { from: Number(m[1]), to: null };
  m = s.match(/^(\d+)?\s*[-–—]\s*(\d+)?$/);
  if (!m || (m[1] == null && m[2] == null)) return null;
  let from = m[1] != null ? Number(m[1]) : null;
  let to = m[2] != null ? Number(m[2]) : null;
  if (from != null && to != null && from > to) [from, to] = [to, from];
  return { from, to };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

async function showMain(env, chatId, lang, deps, msgId) {
  return render(env, chatId, msgId, t(lang, "main"), f.mainMenu(lang), deps);
}

async function showList(env, chatId, lang, deps, msgId) {
  const list = await st.getSearches(env.OFFERS_KV, chatId);
  const text = t(lang, "list_title") + "\n\n" + (list.length ? "" : t(lang, "list_empty"));
  return render(env, chatId, msgId, text.trim(), f.listKeyboard(list, lang), deps);
}

async function showSearch(env, chatId, search, lang, deps, msgId) {
  return render(env, chatId, msgId, f.searchSummary(search, lang), f.searchKeyboard(search, lang), deps);
}

async function showLocation(env, chatId, search, lang, deps, msgId) {
  const loc = search.location || {};
  const districts = loc.cityId ? await getDistricts(env.OFFERS_KV, loc.cityId, deps.fetchImpl) : [];
  return render(env, chatId, msgId, t(lang, "pick_dist", loc.label || "Polska"), f.locationKeyboard(search, districts, lang), deps);
}

async function createSearch(env, chatId, lang, deps, partial, msgId) {
  const kv = env.OFFERS_KV;
  if ((await st.getSearches(kv, chatId)).length >= st.MAX_SEARCHES) {
    return send(env, chatId, t(lang, "limit"), deps, { reply_markup: f.listKeyboard(await st.getSearches(kv, chatId), lang) });
  }
  const s = await st.addSearch(kv, chatId, st.newSearch(partial, deps.now()));
  return showSearch(env, chatId, s, lang, deps, msgId);
}

function readyFree(lang) {
  return {
    name: t(lang, "free_name"),
    categoryId: FREE_CATEGORY_ID,
    categoryName: "Oddam za darmo",
    freeOnly: true,
    realItemsOnly: true,
    excludeWords: [...FREE_STUFF_EXCLUDES],
  };
}

export async function runShowNow(env, chatId, search, offset, lang, deps) {
  const r = await fetchOffers(search, { fetchImpl: deps.fetchImpl });
  if (!r.ok) {
    console.error("OLX fetch failed", r.status, r.error);
    return send(env, chatId, t(lang, "olx_down"), deps, { reply_markup: f.searchKeyboard(search, lang) });
  }
  const since = new Date(deps.now().getTime() - SHOW_MAX_AGE_DAYS * 86400000).toISOString();
  const list = selectNew(r.offers, [], search, { since }).slice(0, SHOW_MAX);
  if (!list.length) {
    return send(env, chatId, t(lang, "nothing"), deps, { reply_markup: f.searchKeyboard(search, lang) });
  }
  const page = list.slice(offset, offset + PAGE);
  if (offset === 0) await send(env, chatId, t(lang, "found", list.length), deps);
  for (const o of page) await sendOffer(env, chatId, o, lang, deps);
  await st.addSeen(env.OFFERS_KV, chatId, search.id, page.map((o) => o.id));
  const next = offset + PAGE;
  if (next < list.length) {
    return send(env, chatId, `${next}/${list.length}`, deps, { reply_markup: f.moreKeyboard(search, next, lang) });
  }
  return send(env, chatId, t(lang, "end") + "\n\n" + f.searchSummary(search, lang), deps, { reply_markup: f.searchKeyboard(search, lang) });
}

// ---------------------------------------------------------------------------
// Text answers to a prompt ("send the keywords", "send the price", ...)
// ---------------------------------------------------------------------------

async function handleInput(env, chatId, draft, text, lang, deps) {
  const kv = env.OFFERS_KV;
  const search = await st.getSearch(kv, chatId, draft.searchId);
  if (!search) { await st.clearDraft(kv, chatId); return showMain(env, chatId, lang, deps); }
  const clear = text.trim() === "-";
  let patch = null;

  if (draft.awaiting === "kw") patch = { query: clear ? "" : text.trim().slice(0, 100) };
  else if (draft.awaiting === "ren") patch = { name: clear ? "" : text.trim().slice(0, 60) };
  else if (draft.awaiting === "excl") {
    patch = { excludeWords: clear ? [] : text.split(/[,;\n]/).map((w) => w.trim()).filter(Boolean).slice(0, 40).map((w) => w.slice(0, 40)) };
  } else if (draft.awaiting === "price") {
    const p = parsePrice(text);
    if (!p) return send(env, chatId, t(lang, "bad_price"), deps, { reply_markup: f.cancelKeyboard(search.id, lang) });
    patch = { priceFrom: p.from, priceTo: p.to, freeOnly: false };
  } else if (draft.awaiting === "city") {
    const c = await lookupCity(text.trim().slice(0, 60), deps.fetchImpl);
    if (!c) return send(env, chatId, t(lang, "city_nf"), deps, { reply_markup: f.cancelKeyboard(search.id, lang) });
    const updated = await st.updateSearch(kv, chatId, search.id, (s) => ({ ...s, location: { ...c, districtIds: [], districtNames: [] } }));
    await st.clearDraft(kv, chatId);
    return showLocation(env, chatId, updated, lang, deps);
  }
  if (!patch) { await st.clearDraft(kv, chatId); return showMain(env, chatId, lang, deps); }
  const updated = await st.updateSearch(kv, chatId, search.id, (s) => ({ ...s, ...patch }));
  await st.clearDraft(kv, chatId);
  return showSearch(env, chatId, updated, lang, deps);
}

const PROMPTS = { kw: "ask_kw", price: "ask_price", excl: "ask_excl", ren: "ask_rename", city: "ask_city" };

// ---------------------------------------------------------------------------
// Buttons on a saved search: s:<searchId>:<action>[:<arg>]
// ---------------------------------------------------------------------------

async function handleSearchAction(env, chatId, msgId, searchId, action, arg, lang, deps) {
  const kv = env.OFFERS_KV;
  let s = await st.getSearch(kv, chatId, searchId);
  if (!s) return showList(env, chatId, lang, deps, msgId);
  const upd = async (fn) => (s = await st.updateSearch(kv, chatId, s.id, fn));

  switch (action) {
    case "open":
      await st.clearDraft(kv, chatId);
      return showSearch(env, chatId, s, lang, deps, msgId);
    case "show":
      return runShowNow(env, chatId, s, 0, lang, deps);
    case "more":
      return runShowNow(env, chatId, s, Math.max(0, Number(arg) || 0), lang, deps);
    case "cat": {
      const cats = await getTopCategories(kv, deps.fetchImpl);
      if (!cats || !cats.length) return send(env, chatId, t(lang, "olx_down"), deps);
      return render(env, chatId, msgId, t(lang, "pick_cat"), f.categoryKeyboard(s, cats, lang), deps);
    }
    case "cp": {
      const parent = await getSubcategories(kv, Number(arg), deps.fetchImpl);
      if (!parent) return handleSearchAction(env, chatId, msgId, searchId, "cat", null, lang, deps);
      if (!parent.children.length) return handleSearchAction(env, chatId, msgId, searchId, "cs", String(parent.id), lang, deps);
      return render(env, chatId, msgId, t(lang, "pick_cat"), f.subcategoryKeyboard(s, parent, lang), deps);
    }
    case "cs": {
      const id = Number(arg) || null;
      let name = "";
      if (id) {
        const tops = (await getTopCategories(kv, deps.fetchImpl)) || [];
        const top = tops.find((c) => c.id === id);
        if (top) name = top.name;
        else {
          for (const c of tops.filter((x) => x.hasChildren)) {
            const sub = await kv.get(`cat:sub:${c.id}:v1`, { type: "json" });
            const ch = sub && sub.find((x) => x.id === id);
            if (ch) { name = `${c.name} › ${ch.name}`; break; }
          }
        }
      }
      await upd((x) => ({ ...x, categoryId: id, categoryName: name }));
      return showSearch(env, chatId, s, lang, deps, msgId);
    }
    case "loc":
      return showLocation(env, chatId, s, lang, deps, msgId);
    case "di": {
      const id = Number(arg);
      const districts = await getDistricts(kv, s.location.cityId, deps.fetchImpl);
      await upd((x) => {
        const cur = new Set(x.location.districtIds || []);
        if (cur.has(id)) cur.delete(id); else cur.add(id);
        const ids = [...cur];
        const names = ids.map((d) => (districts.find((z) => z.id === d) || {}).name).filter(Boolean);
        return { ...x, location: { ...x.location, districtIds: ids, districtNames: names } };
      });
      return showLocation(env, chatId, s, lang, deps, msgId);
    }
    case "da":
      await upd((x) => ({ ...x, location: { ...x.location, districtIds: [], districtNames: [] } }));
      return showLocation(env, chatId, s, lang, deps, msgId);
    case "pl":
      await upd((x) => ({ ...x, location: { label: "Polska", districtIds: [], districtNames: [] } }));
      return showLocation(env, chatId, s, lang, deps, msgId);
    case "waw":
      await upd((x) => ({ ...x, location: { ...st.WARSAW, districtIds: [], districtNames: [] } }));
      return showLocation(env, chatId, s, lang, deps, msgId);
    case "free":
      await upd((x) => ({ ...x, freeOnly: !x.freeOnly }));
      return showSearch(env, chatId, s, lang, deps, msgId);
    case "real":
      await upd((x) => ({ ...x, realItemsOnly: !x.realItemsOnly }));
      return showSearch(env, chatId, s, lang, deps, msgId);
    case "deliv":
      return render(env, chatId, msgId, `${f.searchSummary(s, lang)}\n\n${t(lang, "pick_deliv")}`, f.deliveryKeyboard(s, lang), deps);
    case "dv": {
      const v = ["off", "1h", "3h", "daily"].includes(arg) ? arg : "off";
      const nowIso = deps.now().toISOString();
      await upd((x) => ({
        ...x,
        delivery: v,
        // Only listings posted after subscribing count as "new".
        subscribedAt: v !== "off" && (x.delivery === "off" || !x.subscribedAt) ? nowIso : x.subscribedAt,
        lastRunAt: v !== "off" && x.delivery === "off" ? nowIso : x.lastRunAt,
      }));
      await render(env, chatId, msgId, f.searchSummary(s, lang), f.searchKeyboard(s, lang), deps);
      if (v !== "off") return send(env, chatId, t(lang, "subscribed", f.deliveryLabel(v, lang)), deps);
      return null;
    }
    case "kw": case "price": case "excl": case "ren": case "city":
      await st.setDraft(kv, chatId, { searchId: s.id, awaiting: action });
      return send(env, chatId, t(lang, PROMPTS[action]), deps, { reply_markup: f.cancelKeyboard(s.id, lang) });
    case "del":
      return render(env, chatId, msgId, `${f.searchSummary(s, lang)}\n\n${t(lang, "confirm_del")}`, f.confirmDeleteKeyboard(s, lang), deps);
    case "delok":
      await st.deleteSearch(kv, chatId, s.id);
      await render(env, chatId, msgId, t(lang, "deleted"), null, deps);
      return showList(env, chatId, lang, deps);
    default:
      return showSearch(env, chatId, s, lang, deps, msgId);
  }
}

// ---------------------------------------------------------------------------
// Entry point for one Telegram update
// ---------------------------------------------------------------------------

export async function handleUpdate(update, env, deps = defaultDeps()) {
  const kv = env.OFFERS_KV;

  if (update.message) {
    const { chat, text } = update.message;
    if (!chat || typeof text !== "string") return;
    const chatId = chat.id;
    const saved = await st.getLang(kv, chatId);
    const lang = saved || "en";
    const cmd = text.startsWith("/") ? text.split(/\s/)[0].split("@")[0] : null;

    if (cmd) await st.clearDraft(kv, chatId);
    if (cmd === "/start") {
      if (!saved) return send(env, chatId, t("en", "choose_lang"), deps, { reply_markup: f.langKeyboard() });
      return showMain(env, chatId, lang, deps);
    }
    if (cmd === "/language") return send(env, chatId, "🌐", deps, { reply_markup: f.langKeyboard() });
    if (cmd === "/help") return send(env, chatId, t(lang, "help"), deps, { reply_markup: f.mainMenu(lang) });
    if (cmd === "/searches") return showList(env, chatId, lang, deps);
    if (cmd === "/new") return createSearch(env, chatId, lang, deps, {});
    if (cmd) return showMain(env, chatId, lang, deps);

    const draft = await st.getDraft(kv, chatId);
    if (draft && draft.awaiting) return handleInput(env, chatId, draft, text, lang, deps);
    return showMain(env, chatId, lang, deps);
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    if (!cb.message) return;
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    const data = cb.data || "";
    await tg(env, "answerCallbackQuery", { callback_query_id: cb.id }, deps);
    let lang = (await st.getLang(kv, chatId)) || "en";

    // l:<code> (new) and lang:<code> (buttons left over from the old bot)
    const lm = data.match(/^(?:l|lang):(\w+)$/);
    if (lm && LANG_NAMES[lm[1]]) {
      lang = lm[1];
      await kv.put(`lang:${chatId}`, lang);
      await render(env, chatId, msgId, t(lang, "lang_set", LANG_NAMES[lang]), null, deps);
      return showMain(env, chatId, lang, deps);
    }
    if (data === "m:list") return showList(env, chatId, lang, deps, msgId);
    if (data === "m:new") return createSearch(env, chatId, lang, deps, {}, msgId);
    if (data === "m:free") return createSearch(env, chatId, lang, deps, readyFree(lang), msgId);
    if (data === "m:lang" || data === "menu:lang") return render(env, chatId, msgId, "🌐", f.langKeyboard(), deps);
    const sm = data.match(/^s:([a-z0-9]+):([a-z]+)(?::(.*))?$/);
    if (sm) return handleSearchAction(env, chatId, msgId, sm[1], sm[2], sm[3], lang, deps);
    // m:menu, and anything from the old bot's menu (menu:offers, menu:stop)
    return showMain(env, chatId, lang, deps, msgId);
  }
}

// Message text and inline keyboards.
// Callback data scheme (Telegram limit: 64 bytes):
//   m:<action>                      main-menu actions (list, new, free, lang, menu)
//   l:<code>                        language picked
//   s:<searchId>:<action>[:<arg>]   actions on one saved search
import { t, LANG_NAMES } from "./i18n.js";

export function escapeHtml(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const btn = (text, data) => ({ text, callback_data: data });

export function searchTitle(s, lang) {
  return s.name || s.query || s.categoryName || t(lang, "untitled");
}

export function deliveryLabel(d, lang) {
  return t(lang, { "1h": "d_1h", "3h": "d_3h", daily: "d_daily" }[d] || "d_off");
}

export function priceLabel(s, lang) {
  if (s.freeOnly) return t(lang, "l_free_only");
  if (s.priceFrom == null && s.priceTo == null) return t(lang, "l_any_price");
  if (s.priceFrom != null && s.priceTo != null) return `${s.priceFrom}–${s.priceTo} zł`;
  if (s.priceTo != null) return `≤ ${s.priceTo} zł`;
  return `≥ ${s.priceFrom} zł`;
}

export function locationLabel(s) {
  const loc = s.location || {};
  if (!loc.cityId && !loc.regionId) return "Polska";
  const names = loc.districtNames || [];
  return names.length ? `${loc.label} (${names.join(", ")})` : loc.label;
}

export function categoryLabel(s, lang) {
  return s.categoryId ? s.categoryName || String(s.categoryId) : t(lang, "l_any_cat");
}

export function searchSummary(s, lang) {
  const lines = [
    `🔎 <b>${escapeHtml(searchTitle(s, lang))}</b>`,
    "",
    `📂 ${escapeHtml(categoryLabel(s, lang))}`,
    `🔤 ${s.query ? escapeHtml(s.query) : t(lang, "l_no_kw")}`,
    `📍 ${escapeHtml(locationLabel(s))}`,
    `💰 ${escapeHtml(priceLabel(s, lang))}`,
    `🧹 ${t(lang, "l_real")}: ${t(lang, s.realItemsOnly ? "l_on" : "l_off")}`,
  ];
  if (s.excludeWords && s.excludeWords.length) {
    const shown = s.excludeWords.slice(0, 8).join(", ") + (s.excludeWords.length > 8 ? ", …" : "");
    lines.push(`🚫 ${t(lang, "l_excluded")}: ${escapeHtml(shown)}`);
  }
  lines.push(`🔔 ${t(lang, "l_delivery")}: ${deliveryLabel(s.delivery, lang)}`);
  return lines.join("\n");
}

export function searchKeyboard(s, lang) {
  const p = `s:${s.id}:`;
  const onoff = (v) => (v ? "✅" : "⬜");
  return {
    inline_keyboard: [
      [btn(t(lang, "b_show"), p + "show")],
      [btn(t(lang, "b_cat"), p + "cat"), btn(t(lang, "b_kw"), p + "kw")],
      [btn(t(lang, "b_loc"), p + "loc"), btn(t(lang, "b_price"), p + "price")],
      [btn(`${onoff(s.freeOnly)} ${t(lang, "b_free")}`, p + "free"), btn(`${onoff(s.realItemsOnly)} ${t(lang, "b_real")}`, p + "real")],
      [btn(t(lang, "b_excl"), p + "excl"), btn(`${t(lang, "b_deliv")}: ${deliveryLabel(s.delivery, lang)}`, p + "deliv")],
      [btn(t(lang, "b_rename"), p + "ren"), btn(t(lang, "b_delete"), p + "del")],
      [btn(t(lang, "b_back"), "m:list")],
    ],
  };
}

export function mainMenu(lang) {
  return {
    inline_keyboard: [
      [btn(t(lang, "btn_list"), "m:list"), btn(t(lang, "btn_new"), "m:new")],
      [btn(t(lang, "btn_ready_free"), "m:free")],
      [btn(t(lang, "btn_lang"), "m:lang")],
    ],
  };
}

export function listKeyboard(searches, lang) {
  const rows = searches.map((s) => [
    btn(`${s.delivery && s.delivery !== "off" ? "🔔" : "🔕"} ${searchTitle(s, lang)}`.slice(0, 60), `s:${s.id}:open`),
  ]);
  rows.push([btn(t(lang, "btn_new"), "m:new"), btn(t(lang, "b_back"), "m:menu")]);
  return { inline_keyboard: rows };
}

export function langKeyboard() {
  const codes = Object.keys(LANG_NAMES);
  const rows = [];
  for (let i = 0; i < codes.length; i += 2) rows.push(codes.slice(i, i + 2).map((c) => btn(LANG_NAMES[c], `l:${c}`)));
  return { inline_keyboard: rows };
}

export function deliveryKeyboard(s, lang) {
  const p = `s:${s.id}:dv:`;
  const mark = (v) => (s.delivery === v ? "• " : "");
  return {
    inline_keyboard: [
      [btn(mark("1h") + t(lang, "d_1h"), p + "1h"), btn(mark("3h") + t(lang, "d_3h"), p + "3h")],
      [btn(mark("daily") + t(lang, "d_daily"), p + "daily"), btn(mark("off") + t(lang, "d_off"), p + "off")],
      [btn(t(lang, "b_back"), `s:${s.id}:open`)],
    ],
  };
}

function rows2(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

function compact(n) {
  if (!n) return "";
  if (n >= 1e6) return ` · ${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return ` · ${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return ` · ${n}`;
}

// One level of OLX's category tree: level = {id, name, path, parentId, children}
export function categoryKeyboard(s, level, lang) {
  const p = `s:${s.id}:`;
  const rows = rows2(level.children.map((c) => btn(`${c.name}${compact(c.count)}`, `${p}cp:${c.id}`)));
  if (level.id) rows.unshift([btn(`✅ ${t(lang, "b_all_of", level.name)}`, `${p}cs:${level.id}`)]);
  else rows.unshift([btn(t(lang, "b_any_cat"), `${p}cs:0`)]);
  rows.push([btn(t(lang, "b_back"), level.id ? `${p}cp:${level.parentId}` : `${p}open`)]);
  return { inline_keyboard: rows };
}

// districts = [{id, name}] for the search's current city (may be empty)
export function locationKeyboard(s, districts, lang) {
  const p = `s:${s.id}:`;
  const loc = s.location || {};
  const chosen = new Set(loc.districtIds || []);
  const rows = rows2(districts.map((d) => btn(`${chosen.has(d.id) ? "✅ " : ""}${d.name}`, `${p}di:${d.id}`)));
  if (loc.cityId) rows.unshift([btn(`${!chosen.size ? "✅ " : ""}${t(lang, "b_all_districts", loc.label)}`, `${p}da`)]);
  rows.push([btn(t(lang, "b_other_city"), `${p}city`), btn(`${!loc.cityId && !loc.regionId ? "✅ " : ""}${t(lang, "b_poland")}`, `${p}pl`)]);
  if (loc.cityId !== 17871) rows.push([btn("📍 Warszawa", `${p}waw`)]);
  rows.push([btn(t(lang, "b_back"), `${p}open`)]);
  return { inline_keyboard: rows };
}

export function cancelKeyboard(searchId, lang) {
  return { inline_keyboard: [[btn(t(lang, "b_cancel"), `s:${searchId}:open`)]] };
}

export function confirmDeleteKeyboard(s, lang) {
  return { inline_keyboard: [[btn(t(lang, "b_yes_delete"), `s:${s.id}:delok`), btn(t(lang, "b_back"), `s:${s.id}:open`)]] };
}

export function moreKeyboard(s, offset, lang) {
  return { inline_keyboard: [[btn(t(lang, "b_more"), `s:${s.id}:more:${offset}`)], [btn(t(lang, "b_back"), `s:${s.id}:open`)]] };
}

function warsawTime(d) {
  return new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function agoLabel(createdMs, now, lang) {
  const m = Math.max(0, Math.round((now.getTime() - createdMs) / 60000));
  if (m < 60) return t(lang, "ago_m", m);
  const h = Math.floor(m / 60);
  if (h < 48) return t(lang, "ago_h", h);
  return t(lang, "ago_d", Math.floor(h / 24));
}

export function offerPrice(o, lang) {
  if (o.isFree) return t(lang, "p_free");
  if (o.priceKind === "exchange") return t(lang, "p_exchange");
  if (!o.priceLabel) return "—";
  return o.priceLabel + (o.negotiable ? ` (${t(lang, "p_neg")})` : "");
}

export function offerCaption(o, lang, now) {
  const created = Date.parse(o.createdAt);
  const place = [o.city, o.district].filter(Boolean).join(", ");
  const parts = [
    `<b>${escapeHtml((o.title || "").slice(0, 200))}</b>`,
    "",
    `💰 ${escapeHtml(offerPrice(o, lang))}`,
  ];
  if (place) parts.push(`📍 ${escapeHtml(place)}`);
  if (!Number.isNaN(created)) parts.push(t(lang, "posted", warsawTime(new Date(created)), agoLabel(created, now, lang)));
  return parts.join("\n").slice(0, 1024);
}

export function offerKeyboard(o, lang) {
  return { inline_keyboard: [[{ text: t(lang, "b_open"), url: o.url }]] };
}

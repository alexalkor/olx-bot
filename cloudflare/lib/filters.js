// Per-category OLX filters (rooms, m², fuel, model, condition, ...).
// Data: filters-data.js, a slim snapshot of /api/v1/offers/metadata/filters/
// (see scripts/update-filters.mjs). A category's filters are the variants
// that list that exact category id — OLX lists parents and children
// explicitly, and car "Model" only on each brand.
// search.filters = { "<key>": ["value", ...] | {from, to} | true }
import DATA from "./filters-data.js";
import { NAMES, VALUES, LANGS } from "./filters-i18n.js";

const memo = new Map();

// -> [{ key, kind: "enum"|"range"|"bool", label, unit, values: [[value, label]] }] in OLX's order
export function categoryFilters(categoryId) {
  const id = Number(categoryId) || 0;
  if (!id) return [];
  if (memo.has(id)) return memo.get(id);
  const list = [];
  for (const [key, variants] of Object.entries(DATA)) {
    const f = variants.find((x) => x.c.includes(id));
    if (f) list.push({ key, kind: f.k, label: f.l.trim(), unit: f.u ? f.u.trim() : null, values: f.v || [], order: f.o });
  }
  list.sort((a, b) => a.order - b.order);
  memo.set(id, list);
  return list;
}

// -> [[param, value]] for the offers URL. Formats verified live 2026-11-22.
export function filterParams(filters) {
  const out = [];
  for (const [key, v] of Object.entries(filters || {})) {
    if (Array.isArray(v)) {
      // owner_type takes one value; both picked = no filter.
      if (key === "owner_type") { if (v.length === 1) out.push([key, v[0]]); }
      else v.forEach((x, i) => out.push([`${key}[${i}]`, x]));
    } else if (v === true) out.push([key, "1"]);
    else if (v && typeof v === "object") {
      if (v.from != null) out.push([`${key}:from`, String(v.from)]);
      if (v.to != null) out.push([`${key}:to`, String(v.to)]);
    }
  }
  return out;
}

// Keep only what the (new) category supports.
export function pruneFilters(filters, categoryId) {
  const avail = new Map(categoryFilters(categoryId).map((f) => [f.key, f]));
  const out = {};
  for (const [key, v] of Object.entries(filters || {})) {
    const f = avail.get(key);
    if (!f) continue;
    if (f.kind === "enum" && Array.isArray(v)) {
      const ok = new Set(f.values.map((x) => x[0]));
      const kept = v.filter((x) => ok.has(x));
      if (kept.length) out[key] = kept;
    } else if (f.kind === "bool" && v === true) out[key] = true;
    else if (f.kind === "range" && v && typeof v === "object" && !Array.isArray(v)) out[key] = v;
  }
  return out;
}

const pick = (entry, lang, polish, offset) => {
  const i = LANGS.indexOf(lang);
  return i < 0 ? polish : entry.split("|")[i + offset];
};

export function filterName(f, lang) {
  const e = NAMES[f.label];
  if (!e) return `🔧 ${f.label}`;
  return `${e.split("|")[0]} ${pick(e, lang, f.label, 1)}`;
}

export function valueName(label, lang) {
  const e = VALUES[label];
  return e ? pick(e, lang, label, 0) : label;
}

// Current setting as short text, or "" when not set.
export function filterValueText(f, sel, lang) {
  if (sel == null) return "";
  if (f.kind === "bool") return sel === true ? "✅" : "";
  if (f.kind === "range") {
    const u = f.unit ? ` ${f.unit}` : "";
    if (sel.from != null && sel.to != null) return `${sel.from}–${sel.to}${u}`;
    if (sel.to != null) return `≤ ${sel.to}${u}`;
    if (sel.from != null) return `≥ ${sel.from}${u}`;
    return "";
  }
  const names = (sel || []).map((v) => valueName((f.values.find((x) => x[0] === v) || [v, v])[1], lang));
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
}

// One line per active filter, for the search summary.
export function filtersSummary(search, lang) {
  const set = search.filters || {};
  return categoryFilters(search.categoryId)
    .map((f) => [f, filterValueText(f, set[f.key], lang)])
    .filter(([, txt]) => txt)
    .map(([f, txt]) => `${filterName(f, lang)}: ${txt}`);
}

export function activeCount(search) {
  return filtersSummary(search, "pl").length;
}

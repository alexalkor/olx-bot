// Everything the bot remembers, as small JSON values in Workers KV.
//   searches:<chatId>            -> Search[]  (max 10)
//   seen:<chatId>:<searchId>     -> number[]  (newest 200 OLX ids already sent)
//   draft:<chatId>               -> { searchId, awaiting }  (1-day TTL)
//   subs                         -> ["<chatId>:<searchId>", ...] with delivery != off
//   health                       -> { fails, lastOk, lastFail, alerted }
//   lang:<chatId>                -> "en" | "pl" | ...  (unchanged from v2)

export const MAX_SEARCHES = 10;
export const SEEN_KEEP = 200;
export const WARSAW = { cityId: 17871, regionId: 2, label: "Warszawa" };

function rid() {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export function newSearch(partial = {}, now = new Date()) {
  return {
    id: rid(),
    name: "",
    categoryId: null,
    categoryName: "",
    query: "",
    location: { ...WARSAW },
    priceFrom: null,
    priceTo: null,
    freeOnly: false,
    realItemsOnly: true,
    excludeWords: [],
    filters: {},
    delivery: "off",
    lastRunAt: null,
    createdAt: now.toISOString(),
    ...partial,
  };
}

export async function getSearches(kv, chatId) {
  return (await kv.get(`searches:${chatId}`, { type: "json" })) || [];
}

export async function getSubs(kv) {
  return (await kv.get("subs", { type: "json" })) || [];
}

export async function saveSearches(kv, chatId, list) {
  if (list.length > MAX_SEARCHES) throw new Error("limit");
  await kv.put(`searches:${chatId}`, JSON.stringify(list));
  const subs = await getSubs(kv);
  const mine = new Set(list.filter((s) => s.delivery && s.delivery !== "off").map((s) => `${chatId}:${s.id}`));
  const next = subs.filter((k) => !k.startsWith(`${chatId}:`) || mine.has(k));
  for (const k of mine) if (!next.includes(k)) next.push(k);
  if (next.length !== subs.length || next.some((k, i) => k !== subs[i])) {
    await kv.put("subs", JSON.stringify(next));
  }
}

export async function getSearch(kv, chatId, searchId) {
  return (await getSearches(kv, chatId)).find((s) => s.id === searchId) || null;
}

// Apply fn(search) to one saved search and persist. Returns the updated search.
export async function updateSearch(kv, chatId, searchId, fn) {
  const list = await getSearches(kv, chatId);
  const i = list.findIndex((s) => s.id === searchId);
  if (i < 0) return null;
  const updated = fn({ ...list[i] }) || list[i];
  list[i] = updated;
  await saveSearches(kv, chatId, list);
  return updated;
}

export async function addSearch(kv, chatId, search) {
  const list = await getSearches(kv, chatId);
  list.push(search);
  await saveSearches(kv, chatId, list); // throws "limit"
  return search;
}

export async function deleteSearch(kv, chatId, searchId) {
  const list = (await getSearches(kv, chatId)).filter((s) => s.id !== searchId);
  await saveSearches(kv, chatId, list);
  await kv.delete(`seen:${chatId}:${searchId}`);
}

export async function getSeen(kv, chatId, searchId) {
  return (await kv.get(`seen:${chatId}:${searchId}`, { type: "json" })) || [];
}

export async function addSeen(kv, chatId, searchId, ids) {
  if (!ids.length) return;
  const prev = await getSeen(kv, chatId, searchId);
  const merged = [];
  const s = new Set();
  for (const id of [...ids.map(Number), ...prev]) if (!s.has(id)) { s.add(id); merged.push(id); }
  await kv.put(`seen:${chatId}:${searchId}`, JSON.stringify(merged.slice(0, SEEN_KEEP)));
}

export async function getDraft(kv, chatId) {
  return kv.get(`draft:${chatId}`, { type: "json" });
}
export async function setDraft(kv, chatId, draft) {
  await kv.put(`draft:${chatId}`, JSON.stringify(draft), { expirationTtl: 86400 });
}
export async function clearDraft(kv, chatId) {
  await kv.delete(`draft:${chatId}`);
}

export async function getHealth(kv) {
  return (await kv.get("health", { type: "json" })) || { fails: 0, lastOk: null, lastFail: null, alerted: false };
}
export async function setHealth(kv, h) {
  await kv.put("health", JSON.stringify(h));
}

export async function getLang(kv, chatId) {
  return (await kv.get(`lang:${chatId}`)) || null;
}

// Talking to OLX's public JSON feed (www.olx.pl/api/v1). Works from a
// Cloudflare Worker; blocked from most other cloud machines.
// Facts confirmed by the olx-test probe (2026-11-15):
//  - /api/v1/offers/ takes query, category_id, city_id, district_id,
//    region_id, filter_enum_price[0]=free, filter_float_price:from/to (numbers)
//  - sort_by=created_at:desc actually orders by last refresh, and paid ads
//    come first, so callers sort by created time themselves.
//  - /api/v1/offers/metadata/search/?category_id=X&facets=[{"field":
//    "category_without_exclusions","fetchLabel":true,"fetchUrl":true,"limit":199}]
//    -> X itself, its ancestors and descendants: {id,label,url,count}; url depth
//    gives the level (limit must be < 200). This is OLX's live category tree.
//  - /api/v1/geo-encoder/location-autocomplete/?query=  -> cities
//  - /api/v1/geo-encoder/cities/<id>/districts/          -> districts

export const OLX = "https://www.olx.pl";
export const OLX_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "pl-PL,pl;q=0.9",
  Accept: "application/json",
};

export async function olxJson(path, fetchImpl = fetch) {
  let r;
  try {
    r = await fetchImpl(OLX + path, { headers: OLX_HEADERS });
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
  const text = await r.text();
  if (r.status !== 200) return { ok: false, status: r.status, error: text.slice(0, 200) };
  try {
    return { ok: true, status: 200, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: r.status, error: "not JSON" };
  }
}

export function buildOffersUrl(search, { offset = 0, limit = 50 } = {}) {
  const p = new URLSearchParams();
  p.set("offset", String(offset));
  p.set("limit", String(limit));
  p.set("sort_by", "created_at:desc");
  if (search.query) p.set("query", search.query);
  if (search.categoryId) p.set("category_id", String(search.categoryId));
  const loc = search.location || {};
  const d = loc.districtIds || [];
  if (loc.cityId) {
    p.set("city_id", String(loc.cityId));
    if (d.length === 1) p.set("district_id", String(d[0]));
  } else if (loc.regionId) {
    p.set("region_id", String(loc.regionId));
  }
  if (search.freeOnly) p.set("filter_enum_price[0]", "free");
  else {
    if (search.priceFrom != null) p.set("filter_float_price:from", String(search.priceFrom));
    if (search.priceTo != null) p.set("filter_float_price:to", String(search.priceTo));
  }
  return `/api/v1/offers/?${p.toString()}`;
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOffer(raw) {
  const price = ((raw.params || []).find((x) => x.key === "price") || {}).value || null;
  const loc = raw.location || {};
  const photo = raw.photos && raw.photos[0] && raw.photos[0].link;
  const promo = raw.promotion || {};
  return {
    id: Number(raw.id),
    url: raw.url,
    title: raw.title || "",
    description: stripHtml(raw.description).slice(0, 500),
    createdAt: raw.created_time || raw.last_refresh_time || null,
    refreshedAt: raw.last_refresh_time || null,
    priceLabel: price ? price.label : null,
    priceValue: price && price.type !== "free" && price.type !== "exchange" && typeof price.value === "number" ? price.value : price && price.type === "free" ? 0 : null,
    priceKind: price ? price.type : null,
    negotiable: !!(price && price.negotiable),
    isFree: !!(price && price.type === "free"),
    city: loc.city ? loc.city.name : null,
    district: loc.district ? loc.district.name : null,
    districtId: loc.district ? loc.district.id : null,
    categoryId: raw.category ? raw.category.id : null,
    photo: photo ? photo.replace("{width}", "800").replace("{height}", "600") : null,
    promoted: !!(promo.top_ad || promo.highlighted),
  };
}

export async function fetchOffers(search, { fetchImpl = fetch, limit = 50 } = {}) {
  const r = await olxJson(buildOffersUrl(search, { limit }), fetchImpl);
  if (!r.ok) return r;
  if (!r.data || !Array.isArray(r.data.data)) return { ok: false, status: r.status, error: "no data array" };
  return { ok: true, offers: r.data.data.map(normalizeOffer) };
}

export async function lookupCity(name, fetchImpl = fetch) {
  const r = await olxJson(`/api/v1/geo-encoder/location-autocomplete/?query=${encodeURIComponent(name)}`, fetchImpl);
  const first = r.ok && r.data && Array.isArray(r.data.data) && r.data.data.find((x) => x.city);
  if (!first) return null;
  return { cityId: first.city.id, regionId: first.region ? first.region.id : null, label: first.city.name };
}

export async function fetchDistricts(cityId, fetchImpl = fetch) {
  const r = await olxJson(`/api/v1/geo-encoder/cities/${cityId}/districts/`, fetchImpl);
  if (!r.ok || !r.data || !Array.isArray(r.data.data)) return null;
  return r.data.data.map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

export async function fetchCategoryFacets(categoryId, fetchImpl = fetch) {
  const facets = JSON.stringify([{ field: "category_without_exclusions", fetchLabel: true, fetchUrl: true, limit: 199 }]);
  const q = (categoryId ? `category_id=${categoryId}&` : "") + `facets=${encodeURIComponent(facets)}`;
  const r = await olxJson(`/api/v1/offers/metadata/search/?${q}`, fetchImpl);
  const list = r.ok && r.data && r.data.data && r.data.data.facets && r.data.data.facets.category_without_exclusions;
  if (!Array.isArray(list)) return null;
  return list.map((x) => ({ id: Number(x.id), name: x.label, url: String(x.url || ""), count: x.count || 0 }));
}

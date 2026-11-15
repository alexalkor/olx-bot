// Throwaway probe: paste into the `olx-test` Worker (Cloudflare dashboard) to
// learn how OLX's JSON feed behaves when called from Cloudflare. No secrets,
// does not touch the live bot. Output is compact so it can be pasted back.
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "pl-PL,pl;q=0.9",
  Accept: "application/json",
};
const B = "https://www.olx.pl";

async function get(path) {
  try {
    const r = await fetch(B + path, { headers: UA });
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, t };
  } catch (e) {
    return { status: 0, j: null, t: String(e) };
  }
}

function brief(o) {
  const price = (o.params || []).find((p) => p.key === "price");
  return {
    id: o.id,
    created: o.created_time,
    refresh: o.last_refresh_time,
    promo: o.promotion && Object.keys(o.promotion).filter((k) => o.promotion[k] === true),
    cat: o.category,
    title: (o.title || "").slice(0, 50),
    price: price && price.value,
    loc: o.location && {
      city: o.location.city && [o.location.city.id, o.location.city.name],
      district: o.location.district && [o.location.district.id, o.location.district.name],
      region: o.location.region && [o.location.region.id, o.location.region.name],
    },
    photo: o.photos && o.photos[0] && o.photos[0].link,
    business: o.business,
  };
}

async function offers(qs) {
  const r = await get("/api/v1/offers/?" + qs);
  if (!r.j || !r.j.data) return { status: r.status, body: r.t.slice(0, 300) };
  return {
    status: r.status,
    n: r.j.data.length,
    meta: r.j.metadata && Object.keys(r.j.metadata),
    items: r.j.data.slice(0, 6).map(brief),
  };
}

async function raw(path, n = 700) {
  const r = await get(path);
  return { status: r.status, body: r.t.slice(0, n) };
}

export default {
  async fetch() {
    const out = {};
    // 1. Which sort is honoured?
    out.sort_default = await offers("offset=0&limit=6&query=laptop");
    out.sort_created = await offers("offset=0&limit=6&query=laptop&sort_by=created_at%3Adesc");
    // 2. Slug -> category/location ids
    out.fl_laptopy = await raw("/api/v1/friendly-links/query-params/elektronika,laptopy/");
    out.fl_free = await raw("/api/v1/friendly-links/query-params/oddam-za-darmo/");
    out.fl_warszawa = await raw("/api/v1/friendly-links/query-params/warszawa/");
    // 3. Category list endpoints
    out.categories = await raw("/api/v1/categories/", 1500);
    out.search_meta = await raw("/api/v1/offers/metadata/search/?query=laptop", 1500);
    // 4. Locations
    out.loc_autocomplete = await raw("/api/v1/geo-encoder/location-autocomplete/?query=Warsz", 900);
    out.districts = await raw("/api/v1/geo-encoder/cities/17871/districts/", 1500);
    // 5. A full sample offer (pruned) to build test fixtures from
    const s = await get("/api/v1/offers/?offset=0&limit=1&query=laptop&city_id=17871");
    if (s.j && s.j.data && s.j.data[0]) {
      const o = s.j.data[0];
      o.description = (o.description || "").slice(0, 200);
      delete o.user; delete o.contact; delete o.shop; delete o.safedeal; delete o.partner;
      out.sample_full = o;
      out.sample_city_filter = (s.j.data || []).map(brief);
    } else out.sample_full = { status: s.status, body: s.t.slice(0, 300) };
    // 6. Free-price filters
    out.free_a = await offers("offset=0&limit=4&city_id=17871&filter_enum_price%5B0%5D=free");
    out.free_b = await offers("offset=0&limit=4&city_id=17871&filter_float_price%3Afrom=free");
    return new Response(JSON.stringify(out, null, 1), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  },
};

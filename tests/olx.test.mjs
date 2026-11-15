import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOffersUrl, normalizeOffer, fetchOffers } from "../cloudflare/lib/olx.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/olx-offers.json", import.meta.url)));
const resp = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("url carries query, category, city, one district, price", () => {
  const u = new URL("https://x" + buildOffersUrl({ query: "thinkpad", categoryId: 99, location: { cityId: 17871, districtIds: [353] }, priceTo: 1500 }));
  const q = u.searchParams;
  assert.equal(q.get("query"), "thinkpad");
  assert.equal(q.get("category_id"), "99");
  assert.equal(q.get("city_id"), "17871");
  assert.equal(q.get("district_id"), "353");
  assert.equal(q.get("filter_float_price:to"), "1500");
  assert.equal(q.get("filter_float_price:from"), null);
});
test("several districts: city only (filtered locally); free uses enum filter, no prices", () => {
  const q = new URL("https://x" + buildOffersUrl({ location: { cityId: 17871, districtIds: [353, 359] }, freeOnly: true, priceTo: 9 })).searchParams;
  assert.equal(q.get("district_id"), null);
  assert.equal(q.get("filter_enum_price[0]"), "free");
  assert.equal(q.get("filter_float_price:to"), null);
});
test("whole Poland: no location params", () => {
  const q = new URL("https://x" + buildOffersUrl({ location: {} })).searchParams;
  assert.equal(q.get("city_id"), null);
  assert.equal(q.get("region_id"), null);
});
test("normalizeOffer", () => {
  const o = normalizeOffer(fixture.data[0]);
  assert.equal(o.id, 1112106379);
  assert.equal(o.priceLabel, "1 zł");
  assert.equal(o.priceValue, 1);
  assert.equal(o.district, "Praga-Północ");
  assert.equal(o.description, "Laptop ASUS w czarnej obudowie");
  assert.ok(o.photo.endsWith("image;s=800x600"));
  const free = normalizeOffer(fixture.data[3]);
  assert.equal(free.isFree, true);
  assert.equal(free.priceValue, 0);
  assert.equal(normalizeOffer(fixture.data[4]).photo, null);
  assert.equal(normalizeOffer(fixture.data[6]).priceValue, null);
  assert.equal(normalizeOffer(fixture.data[1]).promoted, true);
});
test("fetchOffers ok / 403 / non-JSON", async () => {
  const ok = await fetchOffers({ location: {} }, { fetchImpl: resp(200, fixture) });
  assert.equal(ok.ok, true);
  assert.equal(ok.offers.length, 7);
  const blocked = await fetchOffers({}, { fetchImpl: resp(403, "<html>") });
  assert.deepEqual([blocked.ok, blocked.status], [false, 403]);
  const junk = await fetchOffers({}, { fetchImpl: resp(200, "<html>") });
  assert.equal(junk.ok, false);
  const thrown = await fetchOffers({}, { fetchImpl: async () => { throw new Error("net"); } });
  assert.equal(thrown.ok, false);
});

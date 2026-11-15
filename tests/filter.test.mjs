import test from "node:test";
import assert from "node:assert/strict";
import { matchesSearch, selectNew, FREE_STUFF_EXCLUDES } from "../cloudflare/lib/filter.js";

const o = (id, title, extra = {}) => ({ id, title, description: "", createdAt: "2026-11-15T10:00:00Z", priceValue: 1000, isFree: false, ...extra });

test("real-items-only drops parts, keeps them when off", () => {
  const off = o(1, "Matryca do laptopa Lenovo");
  assert.equal(matchesSearch(off, { realItemsOnly: true }), false);
  assert.equal(matchesSearch(off, { realItemsOnly: false }), true);
  assert.equal(matchesSearch(o(2, "Laptop Lenovo ThinkPad T480"), { realItemsOnly: true }), true);
});
test("accent-free stems match accented text", () => {
  assert.equal(matchesSearch(o(1, "Laptop na części"), { realItemsOnly: true }), false);
  assert.equal(matchesSearch(o(1, "Laptop", { description: "Uszkodzona matryca, nie działa" }), { realItemsOnly: true }), false);
  assert.equal(matchesSearch(o(1, "Laptop", { description: "bateria trzyma 5h" }), { realItemsOnly: true }), true);
});
test("excluded words are case-insensitive, title or description", () => {
  const s = { excludeWords: ["dell"] };
  assert.equal(matchesSearch(o(1, "Laptop DELL Latitude"), s), false);
  assert.equal(matchesSearch(o(1, "Laptop", { description: "jak dell" }), s), false);
  assert.equal(matchesSearch(o(1, "Laptop HP"), s), true);
});
test("price bounds; unknown price passes", () => {
  const s = { priceFrom: 500, priceTo: 1500 };
  assert.equal(matchesSearch(o(1, "a", { priceValue: 400 }), s), false);
  assert.equal(matchesSearch(o(1, "a", { priceValue: 1600 }), s), false);
  assert.equal(matchesSearch(o(1, "a", { priceValue: 900 }), s), true);
  assert.equal(matchesSearch(o(1, "a", { priceValue: null }), s), true);
});
test("free-stuff excludes catch pets and baby items", () => {
  const s = { excludeWords: FREE_STUFF_EXCLUDES };
  assert.equal(matchesSearch(o(1, "Oddam kotka"), s), false);
  assert.equal(matchesSearch(o(1, "Łóżeczko dziecięce"), s), false);
  assert.equal(matchesSearch(o(1, "Oddam szafę"), s), true);
});
test("selectNew drops seen and old, sorts newest first, dedupes", () => {
  const list = [
    o(1, "a", { createdAt: "2026-11-15T08:00:00Z" }),
    o(2, "b", { createdAt: "2026-11-15T12:00:00Z" }),
    o(3, "c", { createdAt: "2026-11-01T12:00:00Z" }),
    o(2, "b", { createdAt: "2026-11-15T12:00:00Z" }),
    o(4, "d", { createdAt: "2026-11-15T09:00:00Z" }),
  ];
  const r = selectNew(list, [4], {}, { since: "2026-11-10T00:00:00Z" });
  assert.deepEqual(r.map((x) => x.id), [2, 1]);
});

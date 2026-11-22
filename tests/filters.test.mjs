import test from "node:test";
import assert from "node:assert/strict";
import { categoryFilters, filterParams, pruneFilters, filterName, valueName, filterValueText, filtersSummary } from "../cloudflare/lib/filters.js";

const keys = (id) => categoryFilters(id).map((f) => f.key);

test("flats for rent (15) have flat filters, not condition", () => {
  const k = keys(15);
  for (const x of ["filter_enum_rooms", "filter_float_m", "filter_enum_furniture", "filter_enum_pets", "owner_type"]) assert.ok(k.includes(x), x);
  assert.ok(!k.includes("filter_enum_state"));
  assert.ok(!k.includes("filter_float_price") && !k.includes("sort_by"));
  const rooms = categoryFilters(15).find((f) => f.key === "filter_enum_rooms");
  assert.equal(rooms.kind, "enum");
  assert.ok(rooms.values.some(([v]) => v === "two"));
  assert.equal(categoryFilters(15).find((f) => f.key === "filter_float_m").kind, "range");
});

test("BMW (183) has models and car filters; laptops (1199) have condition", () => {
  const bmw = categoryFilters(183);
  assert.ok(bmw.find((f) => f.key === "filter_enum_model").values.some(([v]) => v === "x5"));
  for (const x of ["filter_enum_petrol", "filter_enum_car_body", "filter_enum_drive", "filter_float_year", "filter_float_milage"]) assert.ok(keys(183).includes(x), x);
  assert.ok(keys(1199).includes("filter_enum_state"));
  assert.deepEqual(categoryFilters(0), []);
});

test("URL params: enum, range, bool, owner_type", () => {
  assert.deepEqual(filterParams({ filter_enum_rooms: ["two", "three"], filter_float_m: { from: 40, to: null } }), [
    ["filter_enum_rooms[0]", "two"], ["filter_enum_rooms[1]", "three"], ["filter_float_m:from", "40"],
  ]);
  assert.deepEqual(filterParams({ owner_type: ["private"] }), [["owner_type", "private"]]);
  assert.deepEqual(filterParams({ owner_type: ["private", "business"] }), []);
  assert.deepEqual(filterParams({ filter_bool_bio: true }), [["filter_bool_bio", "1"]]);
  assert.deepEqual(filterParams(undefined), []);
});

test("switching category keeps only what the new one supports", () => {
  const f = { filter_enum_rooms: ["two"], owner_type: ["private"], filter_enum_model: ["x5"] };
  assert.deepEqual(pruneFilters(f, 183), { owner_type: ["private"], filter_enum_model: ["x5"] });
  assert.deepEqual(pruneFilters(f, 15), { filter_enum_rooms: ["two"], owner_type: ["private"] });
  assert.deepEqual(pruneFilters({ filter_enum_model: ["x5", "a4"] }, 183), { filter_enum_model: ["x5"] });
});

test("names translated with emoji; unknown falls back to Polish", () => {
  assert.equal(filterName({ label: "Liczba pokoi" }, "en"), "🛏 Rooms");
  assert.equal(filterName({ label: "Liczba pokoi" }, "ru"), "🛏 Комнаты");
  assert.equal(filterName({ label: "Liczba pokoi" }, "pl"), "🛏 Liczba pokoi");
  assert.equal(filterName({ label: "Coś dziwnego" }, "de"), "🔧 Coś dziwnego");
  assert.equal(valueName("Tak", "uk"), "Так");
  assert.equal(valueName("Xyz", "en"), "Xyz");
});

test("value text and summary", () => {
  const m = categoryFilters(15).find((f) => f.key === "filter_float_m");
  assert.equal(filterValueText(m, { from: 40, to: 70 }, "en"), "40–70 m²");
  assert.equal(filterValueText(m, { from: null, to: 70 }, "en"), "≤ 70 m²");
  const s = { categoryId: 15, filters: { filter_enum_rooms: ["two", "three"], filter_float_m: { from: 40, to: null } } };
  const lines = filtersSummary(s, "en");
  assert.ok(lines.includes("🛏 Rooms: 2 rooms, 3 rooms"), lines.join("|"));
  assert.ok(lines.includes("📐 Area: ≥ 40 m²"), lines.join("|"));
});

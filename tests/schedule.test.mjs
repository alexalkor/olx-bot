import test from "node:test";
import assert from "node:assert/strict";
import { isDue } from "../cloudflare/lib/schedule.js";

const at = (iso) => new Date(iso);
test("off never due", () => assert.equal(isDue({ delivery: "off" }, at("2026-11-15T10:07:00Z")), false));
test("hourly: 54 min no, 56 min yes, never-run yes", () => {
  const now = at("2026-11-15T10:07:00Z");
  assert.equal(isDue({ delivery: "1h", lastRunAt: "2026-11-15T09:13:00Z" }, now), false);
  assert.equal(isDue({ delivery: "1h", lastRunAt: "2026-11-15T09:11:00Z" }, now), true);
  assert.equal(isDue({ delivery: "1h", lastRunAt: null }, now), true);
});
test("3h", () => {
  const now = at("2026-11-15T10:07:00Z");
  assert.equal(isDue({ delivery: "3h", lastRunAt: "2026-11-15T08:07:00Z" }, now), false);
  assert.equal(isDue({ delivery: "3h", lastRunAt: "2026-11-15T07:07:00Z" }, now), true);
});
test("daily at 09:00 Warsaw (winter = UTC+1)", () => {
  assert.equal(isDue({ delivery: "daily", lastRunAt: null }, at("2026-11-15T07:59:00Z")), false);
  assert.equal(isDue({ delivery: "daily", lastRunAt: null }, at("2026-11-15T08:07:00Z")), true);
  assert.equal(isDue({ delivery: "daily", lastRunAt: "2026-11-15T08:07:00Z" }, at("2026-11-15T15:07:00Z")), false);
  assert.equal(isDue({ delivery: "daily", lastRunAt: "2026-11-14T08:07:00Z" }, at("2026-11-15T08:07:00Z")), true);
});
test("daily across DST start (summer = UTC+2)", () => {
  assert.equal(isDue({ delivery: "daily", lastRunAt: null }, at("2026-03-29T07:07:00Z")), true);
  assert.equal(isDue({ delivery: "daily", lastRunAt: null }, at("2026-03-29T06:07:00Z")), false);
});

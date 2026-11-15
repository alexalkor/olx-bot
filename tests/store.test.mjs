import test from "node:test";
import assert from "node:assert/strict";
import { fakeKV } from "./helpers/fake-kv.mjs";
import * as st from "../cloudflare/lib/store.js";

test("max 10 searches", async () => {
  const kv = fakeKV();
  for (let i = 0; i < 10; i++) await st.addSearch(kv, 1, st.newSearch());
  await assert.rejects(st.addSearch(kv, 1, st.newSearch()), /limit/);
  assert.equal((await st.getSearches(kv, 1)).length, 10);
});
test("seen keeps newest 200, deduped", async () => {
  const kv = fakeKV();
  await st.addSeen(kv, 1, "a", Array.from({ length: 150 }, (_, i) => i));
  await st.addSeen(kv, 1, "a", Array.from({ length: 100 }, (_, i) => 1000 + i).concat([5]));
  const seen = await st.getSeen(kv, 1, "a");
  assert.equal(seen.length, 200);
  assert.equal(seen[0], 1000);
  assert.equal(seen.filter((x) => x === 5).length, 1);
});
test("subs index follows delivery", async () => {
  const kv = fakeKV();
  const s = await st.addSearch(kv, 7, st.newSearch());
  assert.deepEqual(await st.getSubs(kv), []);
  await st.updateSearch(kv, 7, s.id, (x) => ({ ...x, delivery: "1h" }));
  assert.deepEqual(await st.getSubs(kv), [`7:${s.id}`]);
  await st.updateSearch(kv, 7, s.id, (x) => ({ ...x, delivery: "off" }));
  assert.deepEqual(await st.getSubs(kv), []);
});
test("delete cleans search, seen and subs", async () => {
  const kv = fakeKV();
  const s = await st.addSearch(kv, 7, st.newSearch({ delivery: "daily" }));
  await st.addSeen(kv, 7, s.id, [1, 2]);
  await st.deleteSearch(kv, 7, s.id);
  assert.deepEqual(await st.getSearches(kv, 7), []);
  assert.deepEqual(await st.getSubs(kv), []);
  assert.deepEqual(await st.getSeen(kv, 7, s.id), []);
});

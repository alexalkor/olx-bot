import test from "node:test";
import assert from "node:assert/strict";
import { fakeKV } from "./helpers/fake-kv.mjs";
import { fakeNet } from "./helpers/fake-net.mjs";
import { runCron, MAX_OLX_PER_RUN } from "../cloudflare/lib/cron.js";
import * as st from "../cloudflare/lib/store.js";

function setup(opts) {
  const kv = fakeKV({ "lang:42": "en", "cmds:v3.0": "1" });
  const net = fakeNet(opts);
  let now = new Date("2026-11-16T01:07:00Z");
  const env = { OFFERS_KV: kv, BOT_TOKEN: "x", ADMIN_CHAT_ID: "999" };
  const deps = { fetchImpl: net.fetchImpl, now: () => now };
  return { kv, net, env, deps, advance: (min) => { now = new Date(now.getTime() + min * 60000); }, run: () => runCron(env, deps) };
}
const offersSent = (net) => net.tg.filter((c) => c.method === "sendPhoto" || (c.method === "sendMessage" && c.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url));

test("due hourly search sends header + new listings once", async () => {
  const { kv, net, run, advance } = setup();
  // subscribed before the three newest fixture items were posted
  await st.addSearch(kv, 42, st.newSearch({ id: "aaaa1111", realItemsOnly: false, delivery: "1h", subscribedAt: "2026-11-14T00:00:00Z", lastRunAt: null }));
  const r = await run();
  assert.equal(r.checked, 1);
  const header = net.tg.find((c) => c.method === "sendMessage");
  assert.match(header.body.text, /New for «New search»: 3/);
  assert.equal(offersSent(net).length, 3);
  assert.equal((await st.getSeen(kv, 42, "aaaa1111")).length, 3);
  net.tg.length = 0;
  advance(60);
  await run();
  assert.equal(offersSent(net).length, 0);
});

test("not due yet: no OLX call", async () => {
  const { kv, net, run } = setup();
  await st.addSearch(kv, 42, st.newSearch({ delivery: "1h", lastRunAt: "2026-11-16T00:40:00Z" }));
  await run();
  assert.equal(net.olx.length, 0);
});

test("three failing runs alert the admin once; success sends recovery once", async () => {
  const { kv, net, run, advance } = setup({ olxStatus: 403, olxBody: "<html>" });
  await st.addSearch(kv, 42, st.newSearch({ delivery: "1h" }));
  const adminMsgs = () => net.tg.filter((c) => c.body.chat_id === "999").map((c) => c.body.text);
  for (let i = 0; i < 5; i++) { await run(); advance(60); }
  assert.equal(adminMsgs().length, 1);
  assert.match(adminMsgs()[0], /refused the last 3/);
  net.olxStatus = 200;
  net.olxBody = (await import("./helpers/fake-net.mjs")).fixture;
  await run(); advance(60); await run();
  assert.equal(adminMsgs().length, 2);
  assert.match(adminMsgs()[1], /answers again/);
});

test("caps OLX calls per run", async () => {
  const { kv, net, run } = setup();
  for (let c = 0; c < 5; c++)
    for (let i = 0; i < 10; i++) await st.addSearch(kv, 100 + c, st.newSearch({ delivery: "1h" }));
  const r = await run();
  assert.equal(r.checked, MAX_OLX_PER_RUN);
  assert.equal(net.olx.length, MAX_OLX_PER_RUN);
});

test("batch over 10 sends 10 + a 'more' note", async () => {
  const { fixture } = await import("./helpers/fake-net.mjs");
  const many = { data: Array.from({ length: 14 }, (_, i) => ({ ...fixture.data[3], id: 5000 + i, created_time: `2026-11-15T1${i % 10}:00:00+01:00` })) };
  const { kv, net, run } = setup({ olxBody: many });
  await st.addSearch(kv, 42, st.newSearch({ delivery: "1h", realItemsOnly: false, subscribedAt: "2026-11-14T00:00:00Z" }));
  await run();
  assert.equal(offersSent(net).length, 10);
  assert.match(net.tg.at(-1).body.text, /and 4 more/);
});

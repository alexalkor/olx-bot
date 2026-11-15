import test from "node:test";
import assert from "node:assert/strict";
import { fakeKV } from "./helpers/fake-kv.mjs";
import { fakeNet } from "./helpers/fake-net.mjs";
import worker from "../cloudflare/olx-free-stuff-worker.js";

function env() {
  return { OFFERS_KV: fakeKV({ "lang:42": "en" }), BOT_TOKEN: "x", WEBHOOK_SECRET: "s3", ADMIN_CHAT_ID: "999" };
}
function ctx() {
  const p = [];
  return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) };
}

test("health, auth and webhook wiring", async () => {
  const net = fakeNet();
  const orig = globalThis.fetch;
  globalThis.fetch = net.fetchImpl;
  try {
    const e = env(); const c = ctx();
    const h = await (await worker.fetch(new Request("https://w/health"), e, c)).json();
    assert.match(h.version, /^v3/);
    assert.equal((await worker.fetch(new Request("https://w/admin/run-cron"), e, c)).status, 401);
    assert.equal((await worker.fetch(new Request("https://w/webhook", { method: "POST", body: "{}" }), e, c)).status, 401);
    assert.equal((await worker.fetch(new Request("https://w/offers"), e, c)).status, 404);
    const r = await worker.fetch(new Request("https://w/webhook", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s3" },
      body: JSON.stringify({ message: { chat: { id: 42 }, text: "/new" } }),
    }), e, c);
    assert.equal(r.status, 200);
    await c.done();
    assert.ok(net.tg.some((x) => /New search/.test(x.body.text || "")));
    const cron = await (await worker.fetch(new Request("https://w/admin/run-cron", { headers: { "X-Secret": "s3" } }), e, c)).json();
    assert.equal(cron.ok, true);
  } finally {
    globalThis.fetch = orig;
  }
});

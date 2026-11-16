import test from "node:test";
import assert from "node:assert/strict";
import { fakeKV } from "./helpers/fake-kv.mjs";
import { fakeNet, msg, cb } from "./helpers/fake-net.mjs";
import { handleUpdate, parsePrice } from "../cloudflare/lib/bot.js";
import * as st from "../cloudflare/lib/store.js";

const NOW = new Date("2026-11-16T01:00:00Z");
function setup(opts) {
  const kv = fakeKV({ "lang:42": "en" });
  const net = fakeNet(opts);
  const env = { OFFERS_KV: kv, BOT_TOKEN: "x" };
  const deps = { fetchImpl: net.fetchImpl, now: () => NOW };
  return { kv, net, env, deps, run: (u) => handleUpdate(u, env, deps) };
}
const texts = (net) => net.tg.map((c) => c.body.text || c.body.caption || "");

test("parsePrice", () => {
  assert.deepEqual(parsePrice("500"), { from: 500, to: null });
  assert.deepEqual(parsePrice("100-500"), { from: 100, to: 500 });
  assert.deepEqual(parsePrice("-1500"), { from: null, to: 1500 });
  assert.deepEqual(parsePrice("1 500 zł"), { from: 1500, to: null });
  assert.deepEqual(parsePrice("500 - 1 500"), { from: 500, to: 1500 });
  assert.deepEqual(parsePrice("900-100"), { from: 100, to: 900 });
  assert.deepEqual(parsePrice("-"), { from: null, to: null });
  assert.equal(parsePrice("abc"), null);
});

test("first /start asks for language; later /start shows menu", async () => {
  const { run, net, kv } = setup();
  await kv.delete("lang:42");
  await run(msg("/start"));
  assert.match(texts(net).at(-1), /Choose your language/);
  await run(cb("l:pl"));
  assert.equal(await kv.get("lang:42"), "pl");
  await run(msg("/start"));
  assert.match(texts(net).at(-1), /Wyszukiwanie OLX/);
});

test("/new creates a search; keywords prompt then answer sets the query", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  assert.ok(s);
  assert.match(texts(net).at(-1), /New search/);
  await run(cb(`s:${s.id}:kw`));
  assert.match(texts(net).at(-1), /Send the keywords/);
  await run(msg("thinkpad t480"));
  assert.equal((await st.getSearch(kv, 42, s.id)).query, "thinkpad t480");
  assert.equal(await st.getDraft(kv, 42), null);
  assert.match(texts(net).at(-1), /thinkpad t480/);
});

test("bad price keeps waiting; good price saves", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await run(cb(`s:${s.id}:price`));
  await run(msg("cheap"));
  assert.match(texts(net).at(-1), /didn't get that/);
  await run(msg("-1500"));
  assert.equal((await st.getSearch(kv, 42, s.id)).priceTo, 1500);
});

test("plain text without a pending prompt shows the main menu", async () => {
  const { run, net } = setup();
  await run(msg("hello"));
  assert.match(texts(net).at(-1), /OLX search/);
});

test("show now: newest first, 5 per page with 'more', records seen", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await st.updateSearch(kv, 42, s.id, (x) => ({ ...x, realItemsOnly: false }));
  net.tg.length = 0;
  await run(cb(`s:${s.id}:show`));
  // fixture: 7 items, 1 older than 30 days (Zasilacz Jan 2026, Dell May 2026 also old)
  const sent = net.tg.filter((c) => c.method === "sendPhoto" || (c.method === "sendMessage" && c.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url));
  assert.ok(sent.length <= 5 && sent.length > 0);
  assert.match(net.tg.find((c) => c.method === "sendMessage").body.text, /Found/);
  const firstCaption = sent[0].body.caption || sent[0].body.text;
  assert.match(firstCaption, /Regał z lustrem/); // newest created
  const seen = await st.getSeen(kv, 42, s.id);
  assert.equal(seen.length, sent.length);
});

test("show now with OLX refusing: one friendly message, nothing marked seen", async () => {
  const { run, net, kv } = setup({ olxStatus: 403, olxBody: "<html>" });
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  net.tg.length = 0;
  await run(cb(`s:${s.id}:show`));
  assert.equal(net.tg.filter((c) => c.method === "sendMessage").length, 1);
  assert.match(texts(net).at(-1), /OLX didn't answer/);
  assert.deepEqual(await st.getSeen(kv, 42, s.id), []);
});

test("photo refused by Telegram falls back to a text message with the link", async () => {
  const { run, net, kv } = setup({ photoFails: true });
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await run(cb(`s:${s.id}:show`));
  const fallbacks = net.tg.filter((c) => c.method === "sendMessage" && c.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url);
  assert.ok(fallbacks.length > 0);
});

test("ready-made free search, delivery subscribe sets subs index", async () => {
  const { run, kv } = setup();
  await run(cb("m:free"));
  const [s] = await st.getSearches(kv, 42);
  assert.equal(s.freeOnly, true);
  assert.equal(s.categoryId, 1151);
  await run(cb(`s:${s.id}:dv:1h`));
  const after = await st.getSearch(kv, 42, s.id);
  assert.equal(after.delivery, "1h");
  assert.equal(after.subscribedAt, NOW.toISOString());
  assert.deepEqual(await st.getSubs(kv), [`42:${s.id}`]);
});

test("districts toggle and city lookup", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await run(cb(`s:${s.id}:di:353`));
  assert.deepEqual((await st.getSearch(kv, 42, s.id)).location.districtNames, ["Mokotów"]);
  await run(cb(`s:${s.id}:city`));
  await run(msg("Nowhere"));
  assert.match(texts(net).at(-1), /couldn't find/);
  await run(msg("Kraków"));
  const loc = (await st.getSearch(kv, 42, s.id)).location;
  assert.equal(loc.cityId, 8959);
  assert.deepEqual(loc.districtIds, []);
});

test("category picker walks OLX's tree to any depth", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await run(cb(`s:${s.id}:cat`));
  let kb = net.tg.at(-1).body.reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(kb.some((x) => x.startsWith("Elektronika")) && kb.some((x) => x.startsWith("Dom i Ogród")));
  assert.ok(!kb.some((x) => x.startsWith("Komputery")));
  await run(cb(`s:${s.id}:cp:99`));
  await run(cb(`s:${s.id}:cp:443`));
  kb = net.tg.at(-1).body.reply_markup.inline_keyboard.flat();
  assert.ok(kb.some((b) => b.text.startsWith("Laptopy")));
  assert.match(net.tg.at(-1).body.text, /Elektronika › Komputery/);
  const back = kb.find((b) => /Back/.test(b.text));
  assert.equal(back.callback_data, `s:${s.id}:cp:99`);
  await run(cb(`s:${s.id}:cp:1199`));
  await run(cb(`s:${s.id}:cp:3108`)); // leaf: picked straight away
  const after = await st.getSearch(kv, 42, s.id);
  assert.equal(after.categoryId, 3108);
  assert.equal(after.categoryName, "Elektronika › Komputery › Laptopy › Lenovo");
  await run(cb(`s:${s.id}:cs:443`));
  assert.equal((await st.getSearch(kv, 42, s.id)).categoryName, "Elektronika › Komputery");
});

test("delete asks, then removes", async () => {
  const { run, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await run(cb(`s:${s.id}:del`));
  assert.equal((await st.getSearches(kv, 42)).length, 1);
  await run(cb(`s:${s.id}:delok`));
  assert.equal((await st.getSearches(kv, 42)).length, 0);
});

test("old bot buttons still answer", async () => {
  const { run, net } = setup();
  await run(cb("menu:offers"));
  assert.match(texts(net).at(-1), /OLX search/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { fakeKV } from "./helpers/fake-kv.mjs";
import { fakeNet, msg, cb } from "./helpers/fake-net.mjs";
import { handleUpdate, parsePrice } from "../cloudflare/lib/bot.js";
import * as st from "../cloudflare/lib/store.js";
import { categoryFilters } from "../cloudflare/lib/filters.js";

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

const kbOf = (net) => net.tg.at(-1).body.reply_markup.inline_keyboard.flat();
const idxOf = (cat, key) => categoryFilters(cat).findIndex((x) => x.key === key);

test("search screen has 8 buttons; More holds free/real/excluded/rename/delete", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  const main = kbOf(net).map((b) => b.callback_data);
  assert.equal(main.length, 8);
  assert.ok(main.includes(`s:${s.id}:flt`) && !main.includes(`s:${s.id}:loc`));
  assert.equal((await st.getSearch(kv, 42, s.id)).location.label, "Warszawa"); // default
  await run(cb(`s:${s.id}:flt`)); // no category yet: location + hint
  assert.match(net.tg.at(-1).body.text, /Pick a category/);
  assert.ok(kbOf(net).some((b) => b.callback_data === `s:${s.id}:loc`));
  await run(cb(`s:${s.id}:xtra`));
  const data = kbOf(net).map((b) => b.callback_data);
  for (const a of ["free", "real", "excl", "ren", "del", "open"]) assert.ok(data.includes(`s:${s.id}:${a}`), a);
  await run(cb(`s:${s.id}:free`));
  assert.equal((await st.getSearch(kv, 42, s.id)).freeOnly, true);
  assert.ok(kbOf(net).some((b) => b.callback_data === `s:${s.id}:del`)); // stays on More
});

test("category tap on a leaf shows siblings + filters/up/clear, not the same screen", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await run(cb(`s:${s.id}:cs:3108`));
  await run(cb(`s:${s.id}:cat`));
  const kb = kbOf(net);
  assert.ok(kb.some((b) => b.text.startsWith("✅ Lenovo")));
  assert.ok(!kb.some((b) => b.callback_data === `s:${s.id}:flt`)); // filters are their own button now
  for (const a of ["up", "cx"]) assert.ok(kb.some((b) => b.callback_data === `s:${s.id}:${a}`), a);
  assert.match(net.tg.at(-1).body.text, /Laptopy › Lenovo/);
  await run(cb(`s:${s.id}:up`));
  assert.equal((await st.getSearch(kv, 42, s.id)).categoryId, 1199);
  await run(cb(`s:${s.id}:cx`));
  assert.equal((await st.getSearch(kv, 42, s.id)).categoryId, null);
  assert.ok(kbOf(net).some((b) => b.text.startsWith("Elektronika"))); // back to the top level
});

test("enum filter: tick a value, it is saved, shown and sent to OLX", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await run(cb(`s:${s.id}:cs:1199`));
  await run(cb(`s:${s.id}:flt`));
  const i = idxOf(1199, "filter_enum_state");
  assert.ok(kbOf(net).some((b) => b.callback_data === `s:${s.id}:fk:${i}` && /Condition: any/.test(b.text)));
  await run(cb(`s:${s.id}:fk:${i}`));
  const v = categoryFilters(1199)[i].values.findIndex(([x]) => x === "new");
  await run(cb(`s:${s.id}:fv:${i}.${v}`));
  assert.deepEqual((await st.getSearch(kv, 42, s.id)).filters, { filter_enum_state: ["new"] });
  assert.ok(kbOf(net).some((b) => b.text === "✅ New"));
  await run(cb(`s:${s.id}:fv:${i}.${v}`)); // untick
  assert.deepEqual((await st.getSearch(kv, 42, s.id)).filters, {});
  await run(cb(`s:${s.id}:fv:${i}.${v}`));
  await run(cb(`s:${s.id}:open`));
  assert.match(net.tg.at(-1).body.text, /Condition: New/);
  await run(cb(`s:${s.id}:show`));
  assert.match(decodeURIComponent(net.olx.at(-1)), /filter_enum_state\[0\]=new/);
});

test("range filter: bad text re-asks, 40-70 saves, - clears; switching category prunes", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await st.updateSearch(kv, 42, s.id, (x) => ({ ...x, categoryId: 15, categoryName: "Wynajem", filters: { filter_enum_rooms: ["two"] } }));
  const i = idxOf(15, "filter_float_m");
  await run(cb(`s:${s.id}:fk:${i}`));
  assert.match(texts(net).at(-1), /Area: send a range in m²/);
  await run(msg("big"));
  assert.match(texts(net).at(-1), /didn't get that/);
  await run(msg("40-70"));
  assert.deepEqual((await st.getSearch(kv, 42, s.id)).filters.filter_float_m, { from: 40, to: 70 });
  await run(cb(`s:${s.id}:fk:${i}`));
  await run(msg("-"));
  assert.equal((await st.getSearch(kv, 42, s.id)).filters.filter_float_m, undefined);
  await run(cb(`s:${s.id}:cs:1199`));
  assert.deepEqual((await st.getSearch(kv, 42, s.id)).filters, {});
});

test("long value lists page by 20 and callback data fits 64 bytes", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await st.updateSearch(kv, 42, s.id, (x) => ({ ...x, categoryId: 183, categoryName: "BMW" }));
  const i = idxOf(183, "filter_enum_model");
  await run(cb(`s:${s.id}:fk:${i}`));
  let kb = kbOf(net);
  assert.ok(kb.some((b) => b.text === "▶️"));
  assert.equal(kb.filter((b) => /:fv:/.test(b.callback_data)).length, 20);
  await run(cb(`s:${s.id}:fk:${i}:2`));
  kb = kbOf(net);
  assert.ok(kb.some((b) => b.text === "◀️"));
  await run(cb(`s:${s.id}:flt`));
  for (const b of kbOf(net)) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
});

test("filters screen: rooms, then location, then parking; location Back returns to filters", async () => {
  const { run, net, kv } = setup();
  await run(msg("/new"));
  const [s] = await st.getSearches(kv, 42);
  await st.updateSearch(kv, 42, s.id, (x) => ({ ...x, categoryId: 15, categoryName: "Wynajem" }));
  await run(cb(`s:${s.id}:flt`));
  const texts3 = kbOf(net).slice(0, 3).map((b) => b.text);
  assert.match(texts3[0], /Rooms/);
  assert.match(texts3[1], /Location: Warszawa/);
  assert.match(texts3[2], /Parking/);
  await run(cb(`s:${s.id}:loc`));
  assert.equal(kbOf(net).at(-1).callback_data, `s:${s.id}:flt`);
});

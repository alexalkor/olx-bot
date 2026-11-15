import test from "node:test";
import assert from "node:assert/strict";
import { I18N } from "../cloudflare/lib/i18n.js";
import { offerCaption, searchKeyboard, deliveryKeyboard } from "../cloudflare/lib/format.js";
import { newSearch } from "../cloudflare/lib/store.js";

test("every key exists in all languages with same type", () => {
  for (const [lang, table] of Object.entries(I18N)) {
    for (const [k, v] of Object.entries(I18N.en)) {
      assert.ok(k in table, `${lang} missing ${k}`);
      assert.equal(typeof table[k], typeof v, `${lang}.${k} type`);
    }
  }
});
test("caption escapes HTML and stays under 1024", () => {
  const o = { title: "<b>x</b>" + "a".repeat(300), createdAt: "2026-11-15T10:00:00Z", priceLabel: "1 500 zł", city: "Warszawa" };
  const c = offerCaption(o, "en", new Date("2026-11-15T11:00:00Z"));
  assert.ok(!c.includes("<b>x</b>"));
  assert.ok(c.length <= 1024);
  assert.match(c, /11:00 · 60 min ago|1 h ago/);
});
test("callback data fits 64 bytes", () => {
  const s = newSearch({ delivery: "daily" });
  for (const kb of [searchKeyboard(s, "be"), deliveryKeyboard(s, "de")])
    for (const row of kb.inline_keyboard) for (const b of row)
      if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
});

import { readFileSync } from "node:fs";
export const fixture = JSON.parse(readFileSync(new URL("../fixtures/olx-offers.json", import.meta.url)));

// Fake fetch: records Telegram calls, serves OLX from the fixture.
export function fakeNet({ olxStatus = 200, olxBody = fixture, photoFails = false } = {}) {
  const tg = [];
  const olx = [];
  let nextId = 100;
  const net = {
    tg, olx,
    olxStatus, olxBody,
    async fetchImpl(url, init = {}) {
      url = String(url);
      if (url.startsWith("https://api.telegram.org/")) {
        const method = url.split("/").pop();
        const body = init.body ? JSON.parse(init.body) : {};
        tg.push({ method, body });
        if (method === "sendPhoto" && photoFails) return Response.json({ ok: false, description: "Bad Request: wrong file" });
        return Response.json({ ok: true, result: { message_id: nextId++ } });
      }
      if (url.includes("olx.pl/api/v1/offers/?")) {
        olx.push(url);
        const b = net.olxBody;
        return new Response(typeof b === "string" ? b : JSON.stringify(b), { status: net.olxStatus });
      }
      if (url.includes("/offers/metadata/search/")) {
        const cat = new URL(url).searchParams.get("category_id");
        const all = [
          { id: 99, label: "Elektronika", url: "/elektronika", count: 1000 },
          { id: 443, label: "Komputery", url: "/elektronika/komputery", count: 500 },
          { id: 1838, label: "Telefony", url: "/elektronika/telefony", count: 400 },
          { id: 1199, label: "Laptopy", url: "/elektronika/komputery/laptopy", count: 300 },
          { id: 3108, label: "Lenovo", url: "/elektronika/komputery/laptopy/lenovo", count: 50 },
          { id: 628, label: "Dom i Ogród", url: "/dom-ogrod", count: 900 },
        ];
        const node = all.find((x) => String(x.id) === cat);
        const list = node ? all.filter((x) => x.url.startsWith(node.url) || node.url.startsWith(x.url + "/")) : all;
        return Response.json({ data: { facets: { category_without_exclusions: list } } });
      }
      if (url.includes("/friendly-links/query-params/")) {
        const slug = url.split("/query-params/")[1].replace(/\/$/, "");
        const ids = { "oddam-za-darmo": 1151, elektronika: 99, "elektronika,komputery,laptopy": 99, "elektronika,telefony": 1000, "elektronika,komputery": 1001 };
        return Response.json({ data: { category_id: ids[slug] ?? (slug.includes(",") ? Number(slug.length) : 7) } });
      }
      if (url.includes("/districts/")) return Response.json({ data: [{ id: 353, name: "Mokotów" }, { id: 359, name: "Wola" }] });
      if (url.includes("location-autocomplete")) {
        if (url.includes("Nowhere")) return Response.json({ data: [] });
        return Response.json({ data: [{ city: { id: 8959, name: "Kraków" }, region: { id: 4 } }] });
      }
      return new Response("not found", { status: 404 });
    },
  };
  return net;
}

export const msg = (text, chatId = 42) => ({ message: { chat: { id: chatId }, text } });
export const cb = (data, chatId = 42) => ({ callback_query: { id: "q", data, message: { chat: { id: chatId }, message_id: 5 } } });

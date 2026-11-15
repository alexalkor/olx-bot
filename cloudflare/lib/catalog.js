// Category menu and location data. OLX's feed has no category list, but it
// translates web addresses (slugs like "elektronika,telefony") into category
// numbers, so the menu is defined by slug and resolved on first use, then
// cached in KV for a week. A child slug OLX doesn't recognise resolves to its
// parent's number; such children are dropped automatically.
import { resolveSlug, fetchDistricts } from "./olx.js";

export const WARSAW_CITY_ID = 17871;
export const FREE_CATEGORY_ID = 1151; // "Oddam za darmo" (probe: friendly-link)
const WEEK = 7 * 86400;

export const CATEGORY_TREE = [
  { slug: "oddam-za-darmo", name: "Oddam za darmo" },
  { slug: "elektronika", name: "Elektronika", children: [
    ["telefony", "Telefony"], ["komputery", "Komputery"], ["komputery,laptopy", "Laptopy"],
    ["tablety", "Tablety"], ["tv-video", "TV i wideo"], ["sprzet-audio", "Audio"],
    ["fotografia", "Fotografia"], ["gry-konsole", "Gry i konsole"], ["sprzet-agd", "AGD"],
    ["smartwatche-i-opaski", "Smartwatche"],
  ] },
  { slug: "dom-ogrod", name: "Dom i ogród", children: [
    ["meble", "Meble"], ["wyposazenie-wnetrz", "Wyposażenie wnętrz"], ["ogrod", "Ogród"],
    ["narzedzia", "Narzędzia"], ["budowa-remont", "Budowa i remont"], ["kuchnia-jadalnia", "Kuchnia"],
    ["oswietlenie", "Oświetlenie"], ["ogrzewanie", "Ogrzewanie"],
  ] },
  { slug: "moda", name: "Moda", children: [
    ["ubrania-damskie", "Ubrania damskie"], ["ubrania-meskie", "Ubrania męskie"],
    ["obuwie-damskie", "Buty damskie"], ["obuwie-meskie", "Buty męskie"],
    ["torebki", "Torebki"], ["zegarki", "Zegarki"], ["bizuteria", "Biżuteria"],
  ] },
  { slug: "sport-hobby", name: "Sport i hobby", children: [
    ["rowery", "Rowery"], ["silownia-fitness", "Siłownia i fitness"], ["sporty-zimowe", "Sporty zimowe"],
    ["turystyka", "Turystyka"], ["hulajnogi", "Hulajnogi"],
  ] },
  { slug: "muzyka-edukacja", name: "Muzyka i edukacja", children: [
    ["ksiazki", "Książki"], ["instrumenty", "Instrumenty"], ["plyty-cd", "Płyty"],
  ] },
  { slug: "dla-dzieci", name: "Dla dzieci", children: [
    ["zabawki", "Zabawki"], ["wozki-dzieciece", "Wózki"], ["meble-dla-dzieci", "Meble dziecięce"],
    ["odziez-dziecieca", "Ubranka"],
  ] },
  { slug: "motoryzacja", name: "Motoryzacja", children: [
    ["samochody", "Samochody"], ["motocykle-skutery", "Motocykle i skutery"], ["czesci-samochodowe", "Części"],
  ] },
  { slug: "nieruchomosci", name: "Nieruchomości", children: [
    ["mieszkania,wynajem", "Mieszkania — wynajem"], ["mieszkania,sprzedaz", "Mieszkania — sprzedaż"],
    ["stancje-pokoje", "Pokoje"],
  ] },
  { slug: "zdrowie-i-uroda", name: "Zdrowie i uroda" },
  { slug: "zwierzeta", name: "Zwierzęta" },
  { slug: "antyki-i-kolekcje", name: "Antyki i kolekcje" },
];

async function cached(kv, key, ttl, build) {
  const hit = await kv.get(key, { type: "json" });
  if (hit) return hit;
  const val = await build();
  if (val && (!Array.isArray(val) || val.length)) await kv.put(key, JSON.stringify(val), { expirationTtl: ttl });
  return val;
}

// -> [{ id, name, hasChildren }]
export async function getTopCategories(kv, fetchImpl = fetch) {
  return cached(kv, "cat:top:v1", WEEK, async () => {
    const ids = await Promise.all(CATEGORY_TREE.map((c) => resolveSlug(c.slug, fetchImpl)));
    return CATEGORY_TREE.map((c, i) => ({ id: ids[i], name: c.name, hasChildren: !!(c.children && c.children.length) }))
      .filter((c) => c.id);
  });
}

// -> { id, name, children: [{ id, name }] } or null
export async function getSubcategories(kv, parentId, fetchImpl = fetch) {
  const tops = await getTopCategories(kv, fetchImpl);
  const top = tops.find((c) => c.id === parentId);
  if (!top) return null;
  const def = CATEGORY_TREE.find((c) => c.name === top.name);
  const children = await cached(kv, `cat:sub:${parentId}:v1`, WEEK, async () => {
    const list = def.children || [];
    const ids = await Promise.all(list.map(([slug]) => resolveSlug(`${def.slug},${slug}`, fetchImpl)));
    const seen = new Set([parentId]);
    const out = [];
    list.forEach(([, name], i) => {
      if (ids[i] && !seen.has(ids[i])) { seen.add(ids[i]); out.push({ id: ids[i], name }); }
    });
    return out;
  });
  return { id: top.id, name: top.name, children: children || [] };
}

export async function getDistricts(kv, cityId, fetchImpl = fetch) {
  if (!cityId) return [];
  return (await cached(kv, `districts:${cityId}:v1`, WEEK, () => fetchDistricts(cityId, fetchImpl))) || [];
}

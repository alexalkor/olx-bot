// Category menu = OLX's own live category tree, any depth
// (Elektronika › Komputery › Laptopy › Lenovo). Read from OLX's search
// "facets" for one category at a time and cached in KV for a day.
import { fetchCategoryFacets, fetchDistricts } from "./olx.js";

export const WARSAW_CITY_ID = 17871;
export const FREE_CATEGORY_ID = 1151; // "Oddam za darmo" page (friendly-link)
const DAY = 86400;
const WEEK = 7 * DAY;

async function cached(kv, key, ttl, build) {
  const hit = await kv.get(key, { type: "json" });
  if (hit) return hit;
  const val = await build();
  if (val && (!Array.isArray(val) || val.length)) await kv.put(key, JSON.stringify(val), { expirationTtl: ttl });
  return val;
}

const depth = (url) => (url.replace(/^\/|\/$/g, "") ? url.replace(/^\/|\/$/g, "").split("/").length : 0);

// One level of the tree.
// categoryId 0/null = top level.
// -> { id, name, path: "Elektronika › Komputery", parentId, children: [{id, name, count}] } | null
export async function getCategoryLevel(kv, categoryId, fetchImpl = fetch) {
  const id = Number(categoryId) || 0;
  return cached(kv, `cat:level:${id}:v2`, DAY, async () => {
    const list = await fetchCategoryFacets(id, fetchImpl);
    if (!list) return null;
    const node = id ? list.find((x) => x.id === id) : { id: 0, name: "", url: "", count: 0 };
    if (!node) return null;
    const d = depth(node.url);
    const prefix = node.url ? node.url.replace(/\/$/, "") + "/" : "/";
    const children = list
      .filter((x) => depth(x.url) === d + 1 && x.url.startsWith(prefix))
      .sort((a, b) => b.count - a.count)
      .map((x) => ({ id: x.id, name: x.name, count: x.count }));
    // Ancestors are in the same list: build the breadcrumb and find the parent.
    const ancestors = list
      .filter((x) => depth(x.url) < d && node.url.startsWith(x.url.replace(/\/$/, "") + "/"))
      .sort((a, b) => depth(a.url) - depth(b.url));
    const path = [...ancestors.map((a) => a.name), node.name].filter(Boolean).join(" › ");
    const parentId = ancestors.length ? ancestors[ancestors.length - 1].id : 0;
    return { id, name: node.name, path, parentId, children };
  });
}

export async function getDistricts(kv, cityId, fetchImpl = fetch) {
  if (!cityId) return [];
  return (await cached(kv, `districts:${cityId}:v1`, WEEK, () => fetchDistricts(cityId, fetchImpl))) || [];
}

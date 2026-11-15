// Matching rules applied after OLX returns results. OLX itself can't exclude
// words, so "real items only" and the user's excluded words live here.
// Add words to these lists freely: they are matched as lowercase,
// accent-free substrings ("uszkodz" catches uszkodzony/uszkodzona/...).

// Parts, accessories-as-parts, and services. Matched against the TITLE only,
// so "laptop, bateria trzyma 5h" in a description doesn't get dropped.
export const JUNK_TITLE_STEMS = [
  "na czesci", "czesci", "czesc ", "matryc", "zasilacz", "ladowark", "obudow",
  "plyta glowna", "klawiatur", "bateri", "zawias", "wentylator", "tasma",
  "naprawa", "naprawy", "serwis", "skup", "wymiana", "odkupie", "kupie",
  "uszkodz", "zepsut", "nie dziala", "do naprawy", "pekniet", "zbit",
  "usluga", "uslugi",
];
// Clear "this item is broken" phrases: matched against title AND description.
export const JUNK_ANYWHERE_STEMS = [
  "na czesci", "uszkodzon", "nie dziala", "do naprawy", "nie wlacza sie", "zepsut",
];
// The old free-stuff scraper's exclusions (pets, baby items, food). Used by
// the ready-made "Free stuff - Warsaw" search as its excluded words.
export const FREE_STUFF_EXCLUDES = [
  "zwierz", "pies", "psa", "kot", "kotek", "szczenia", "klatk", "akwari", "karma",
  "niemowl", "ubranka", "lozeczk", "kojec", "przewijak", "fotelik", "wozek",
  "krzeselko do karmienia", "rowerek", "dla dziecka", "dzieciec",
  "jedzeni", "zywnosc", "spozywcz",
];

export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function hasAny(text, stems) {
  const t = " " + norm(text) + " ";
  return stems.some((s) => s && t.includes(norm(s)));
}

export function matchesSearch(offer, search) {
  const dIds = (search.location && search.location.districtIds) || [];
  if (dIds.length > 1 && offer.districtId != null && !dIds.includes(offer.districtId)) return false;
  const title = offer.title || "";
  const both = title + " " + (offer.description || "");
  if (search.realItemsOnly) {
    if (hasAny(title, JUNK_TITLE_STEMS)) return false;
    if (hasAny(both, JUNK_ANYWHERE_STEMS)) return false;
  }
  if (search.excludeWords && search.excludeWords.length && hasAny(both, search.excludeWords)) return false;
  if (search.freeOnly) {
    if (offer.isFree === false && offer.priceValue) return false;
  } else if (offer.priceValue != null) {
    if (search.priceFrom != null && offer.priceValue < search.priceFrom) return false;
    if (search.priceTo != null && offer.priceValue > search.priceTo) return false;
  }
  return true;
}

export function selectNew(offers, seenIds, search, { since } = {}) {
  const seen = new Set((seenIds || []).map(Number));
  const sinceMs = since ? Date.parse(since) : null;
  const out = [];
  const ids = new Set();
  for (const o of offers) {
    if (seen.has(Number(o.id)) || ids.has(o.id)) continue;
    if (sinceMs && Date.parse(o.createdAt) < sinceMs) continue;
    if (!matchesSearch(o, search)) continue;
    ids.add(o.id);
    out.push(o);
  }
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

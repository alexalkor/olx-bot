// OLX categories and Warsaw districts shown in the menus.
// PROVISIONAL: ids to be confirmed from the olx-test probe output.
export const WARSAW_CITY_ID = 17871;
export const CATEGORIES = [];
export const WARSAW_DISTRICTS = [];
export const FREE_CATEGORY_ID = null;

export function findCategory(id) {
  for (const c of CATEGORIES) {
    if (c.id === id) return { ...c, parent: null };
    for (const ch of c.children || []) if (ch.id === id) return { ...ch, parent: c };
  }
  return null;
}

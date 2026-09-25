// /map/list is a bookmark some readers and docs still use. The venue list is a
// map surface, not a city pack, so the path redirects to an explicit map intent.

export const MAP_LIST_PATH = "/map/list";

/** Shareable map URL that opens List view on arrival. */
export const MAP_LIST_MAP_HREF = "/map?list=1";

const MAP_LIST_SEARCH_PARAM = "list";

export function mapListOpenFromSearch(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return false;
  return new URLSearchParams(raw).get(MAP_LIST_SEARCH_PARAM) === "1";
}

// /map/list is a bookmark some readers and docs still use. The venue list is a
// map surface, not a city pack, so the path redirects to an explicit map intent.

export const MAP_LIST_PATH = "/map/list";

/** Arrival-only map intent: `/map?list=1` opens List view on first render. */
export const MAP_LIST_SEARCH_PARAM = "list";

export function mapListOpenFromSearch(search: string): boolean {
  return new URLSearchParams(search).get(MAP_LIST_SEARCH_PARAM) === "1";
}

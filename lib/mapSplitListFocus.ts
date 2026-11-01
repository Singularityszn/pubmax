// The few things the map shell needs from the list beside the map, kept in a
// module with no imports so the eager map chunk can carry them without pulling
// in the list itself (components/map/MapSplitList.tsx loads on demand).

/** The column's DOM id, so the Layers "List view" action can hand focus to it. */
export const MAP_SPLIT_LIST_ID = "map-split-list";

/**
 * Hand keyboard focus to the column's current row (the one in the tab order),
 * else to the column itself. The Layers "List view" action calls this from
 * 1024px, where the column IS the venue list, and takes no argument so it
 * can stand in for List view's open callback. Answers whether anything took
 * focus.
 */
export function focusMapSplitList(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document;
  const root = doc.getElementById(MAP_SPLIT_LIST_ID);
  if (!root) return false;
  const row = root.querySelector<HTMLElement>('[data-split-row][tabindex="0"]');
  const target = row ?? root;
  target.focus();
  return doc.activeElement === target;
}

/**
 * Whether the floating List view (components/map/MapVenueList.tsx) is open.
 * From 1024px the list beside the map is the venue list, so a request for List
 * view (a `?list=1` arrival) opens nothing over the map there; the request is
 * kept, and a window narrowed below 1024px opens it.
 */
export function floatingMapListOpen(requested: boolean, splitListWidth: boolean): boolean {
  return requested && !splitListWidth;
}

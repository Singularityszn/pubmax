export const MIN_ROUTE_CONTENT_PX = 48;
const BOTTOM_SHEET_SELECTOR = ".mobileSharedSheet.open";

/** Give up waiting for the sheet after this; a stuck sheet must not strand the camera. */
const SHEET_SETTLE_TIMEOUT_MS = 900;

/** Frames the sheet edge must hold still before its geometry is trusted. */
const SHEET_SETTLE_STABLE_FRAMES = 4;

/**
 * Less cover than this is a sheet that has not grown yet, not a band. The
 * near-me sheet mounts at full height of nothing and springs open, so its first
 * frame reports an edge at the bottom of the screen.
 */
const SHEET_UNGROWN_COVER_PX = 64;

/**
 * Top edge of an open bottom sheet, in map-container pixels, or null when no
 * sheet covers the map. Measured because a contextual sheet is content-height:
 * its snap cap is a maximum, not the height it settles at, so no constant can
 * stand in for it.
 *
 * Exported because the venue-select camera answers the same question this
 * module already answers for near-me: how much map is left above the sheet.
 * One selector, one measurement, so the two moves cannot drift apart.
 */
export function measureBottomSheetTop(containerTop: number, selector = BOTTOM_SHEET_SELECTOR, ancestor?: string): number | null {
  if (typeof document === "undefined") return null;
  const match = document.querySelector(selector);
  const sheet = ancestor ? match?.closest(ancestor) : match;
  if (!sheet) return null;
  const rect = sheet.getBoundingClientRect();
  if (rect.height <= 0) return null;
  return rect.top - containerTop;
}

/**
 * Call back with the sheet's resting top edge, once it has one.
 *
 * The camera aims ONCE, from here. An earlier version aimed immediately and
 * then re-aimed when the sheet settled, which looked like the camera missing
 * and correcting itself on every single open: the first reading is taken while
 * the sheet is still a sliver at the bottom of the screen, so the correction
 * was the norm and it was worth about 180px of pan. Under reduced motion it was
 * worse still, because both moves were instant jumps.
 *
 * Waiting costs about a third of a second before the camera starts, and nothing
 * is withheld in that time: the sheet and its list are what the reader is
 * watching. Watching the edge needs no knowledge of the sheet's own spring,
 * which is why it is done this way.
 */
export type BottomSheetSettleOptions = {
  /** Keep watching briefly when the sheet portal has not mounted yet. */
  waitForSheet?: boolean;
  waitForMotion?: boolean;
  surfaceSelector?: string;
  surfaceAncestor?: string;
};

export function whenBottomSheetSettles(
  containerTop: number,
  done: (coverTop: number | null) => void,
  { waitForSheet = false, waitForMotion = true, surfaceSelector = BOTTOM_SHEET_SELECTOR, surfaceAncestor }: BottomSheetSettleOptions = {},
): () => void {
  let cancelled = false;
  const finish = (coverTop: number | null) => {
    if (cancelled) return;
    cancelled = true;
    done(coverTop);
  };
  const measure = (): number | null => {
    const top = measureBottomSheetTop(containerTop, surfaceSelector, surfaceAncestor);
    if (top === null) return null;
    // Still growing. Not a band yet, and not "no sheet" either.
    return top;
  };
  if (typeof requestAnimationFrame === "undefined" || typeof document === "undefined") {
    finish(measure());
    return () => {
      cancelled = true;
    };
  }
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const grown = (top: number | null): boolean =>
    top !== null && viewportHeight - (containerTop + top) >= SHEET_UNGROWN_COVER_PX;
  // No sheet at all (desktop, or a near-me answer with no sheet host): there is
  // nothing to wait for, so do not spend the timeout finding that out. A venue
  // selection opts into waiting because its portal can mount one commit after
  // the canvas effect that requested the camera.
  const surface = () => {
    const match = document.querySelector<HTMLElement>(surfaceSelector);
    return surfaceAncestor ? match?.closest<HTMLElement>(surfaceAncestor) ?? null : match;
  };
  if (!surface() && !waitForSheet) {
    cancelled = true;
    done(null);
    return () => {
      cancelled = true;
    };
  }
  const startedAt = performance.now();
  const position = () => { if (!surfaceAncestor) return ""; const rect = surface()?.getBoundingClientRect(); return rect ? [rect.x, rect.y, rect.width, rect.height].join(":") : ""; };
  let previous = measure();
  let previousPosition = position();
  let stableFrames = 0;
  const step = () => {
    if (cancelled) return;
    const current = measure();
    const currentPosition = position();
    stableFrames = current === previous && currentPosition === previousPosition ? stableFrames + 1 : 0;
    previous = current;
    previousPosition = currentPosition;
    const element = surface();
    const changing = surfaceAncestor && element ? getComputedStyle(element).willChange : "";
    const idle = !surfaceAncestor || !element?.closest('[data-sheet-exiting="true"]') && (!changing || changing === "auto") && (!element?.dataset.sheetMotion || element.dataset.sheetMotion === "idle");
    const layout = element?.getBoundingClientRect();
    const settled = waitForMotion
      ? (grown(current) || (Boolean(surfaceAncestor) && !waitForSheet && !element)) && stableFrames >= SHEET_SETTLE_STABLE_FRAMES && idle
      : Boolean(element && !element.closest('[data-sheet-exiting="true"]') && layout?.width && layout.height);
    if (settled || performance.now() - startedAt > SHEET_SETTLE_TIMEOUT_MS) {
      // A sheet that never grew is treated as no cover rather than as a band
      // pinned to the bottom of the screen.
      finish(grown(current) ? current : null);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => {
    cancelled = true;
  };
}

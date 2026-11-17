"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  mapSurfaceOpenTransition,
  readEntriesAboveRoot,
  readMapSurfaceHistory,
  stampMapSurfaceHistory,
} from "@/lib/mapSurfaceHistory";
import {
  browseSelectionUrl,
  cleanMapUrl,
  refreshSelectionUrl,
  searchHasSelection,
  selectionResolution,
} from "@/lib/mapSelectionHistory";
import {
  ROOT_SURFACE_STACK,
  backActionLabel,
  currentSurface,
  type SurfaceEntry,
  type SurfaceStack,
} from "@/lib/surfaceStack";
import { mapSurfaceSearch } from "@/lib/mapSurfaceState";
import { MOBILE_SHEET_DISMISS_EVENT, type MapOverlay, type MapViewportSnapshot } from "@/lib/mobileShell";
import type { createMapCameraOwnership } from "@/lib/mapCameraProvenance";
import { announceAcceptedArrivalUrlChange, canonicalizeAcceptedArrivalSelection } from "@/lib/mapAcceptance";

export type MapSurfaceId = MapOverlay | "venue-list";

export type MapSurfaceState = {
  venueTab: string;
  venueId: string;
  areaTargetKey: string;
  areaTarget: unknown;
  layersTab: string;
  /** The landmark whose story is open, so Back can put the story back. */
  landmarkId: string;
  /** A "Choose a pub" picker opened for a `contribute=price` request. */
  pricePicker?: boolean;
  returnCamera?: { center: [number, number]; zoom: number } | null;
};

export const EMPTY_MAP_SURFACE_STATE: MapSurfaceState = {
  venueTab: "",
  venueId: "",
  areaTargetKey: "",
  areaTarget: null,
  layersTab: "",
  landmarkId: "",
};

type MapSurfaceAreaTarget =
  | { kind: "area"; area: { slug: string } }
  | { kind: "place"; name: string };

export function useMapSurfaceState({
  venueTab,
  venueId,
  areaTarget,
  layersTab,
  landmarkId,
  pricePicker,
  cameraOwnership,
  viewport,
}: {
  venueTab: string;
  venueId: string;
  areaTarget: MapSurfaceAreaTarget | null;
  layersTab: string;
  landmarkId: string;
  pricePicker: boolean;
  cameraOwnership: Pick<ReturnType<typeof createMapCameraOwnership>, "capture">;
  viewport: MapViewportSnapshot;
}): MapSurfaceState {
  return useMemo(() => ({
    venueTab,
    venueId,
    areaTargetKey: areaTarget
      ? areaTarget.kind === "area"
        ? `area:${areaTarget.area.slug}`
        : `place:${areaTarget.name}`
      : "",
    areaTarget,
    layersTab,
    landmarkId,
    returnCamera: cameraOwnership.capture(viewport)
      ? { center: viewport.center, zoom: viewport.zoom }
      : null,
    ...(pricePicker ? { pricePicker: true } : {}),
  }), [areaTarget, cameraOwnership, landmarkId, layersTab, pricePicker, venueId, venueTab, viewport]);
}

function sameState(a: MapSurfaceState | undefined, b: MapSurfaceState): boolean {
  return Boolean(
    a &&
      a.venueTab === b.venueTab &&
      a.venueId === b.venueId &&
      a.areaTargetKey === b.areaTargetKey &&
      a.layersTab === b.layersTab &&
      (a.landmarkId ?? "") === (b.landmarkId ?? "") &&
      Boolean(a.pricePicker) === Boolean(b.pricePicker),
  );
}

/** The one owned param a landmark arrival carries (`/map?landmark=<id>`). */
const LANDMARK_PARAM = "landmark";

function selectedVenueId(stack: SurfaceStack<MapSurfaceState>): string {
  const current = currentSurface(stack);
  return current?.id === "venue" ? current.state?.venueId ?? "" : "";
}

function currentBrowserUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isSurfaceOpen(
  previous: SurfaceStack<MapSurfaceState>,
  next: SurfaceStack<MapSurfaceState>,
): boolean {
  const entry = currentSurface(next);
  if (!entry) return false;
  const transition = mapSurfaceOpenTransition(previous, entry);
  return transition.kind === "push" &&
    transition.stack.length === next.length &&
    transition.stack.every((held, index) => held.id === next[index]?.id);
}

function urlForStack(
  stack: SurfaceStack<MapSurfaceState>,
  selectionHint: string,
): string {
  const { pathname, hash } = window.location;
  const shown = currentSurface(stack);
  const params = new URLSearchParams(mapSurfaceSearch(window.location.search, shown?.id ?? "none"));
  if (shown?.id === "landmark" && shown.state?.landmarkId) params.set(LANDMARK_PARAM, shown.state.landmarkId);
  else params.delete(LANDMARK_PARAM);
  const search = params.toString() ? `?${params}` : "";
  const venueId = selectedVenueId(stack);
  const liveVenueId = new URLSearchParams(search).get("sel");
  return venueId
    ? liveVenueId === venueId
      ? refreshSelectionUrl(pathname, search, venueId, hash, selectionHint)
      : browseSelectionUrl(pathname, search, venueId, hash, selectionHint)
    : cleanMapUrl(pathname, search, hash);
}

/**
 * One Map navigation authority.
 *
 * Every surface open enters this hook synchronously. Each browser entry carries
 * the complete logical trail and, for a venue, the selection sentinel in that
 * same state object. Back and Forward restore the landed snapshot directly.
 * No second listener derives depth or negotiates a pending traversal.
 */
export function useMapSurfaceNavigation({
  arrivalSearch,
  surfaceId,
  surfaceTitle,
  surfaceState,
  selectionHint,
  onRestore,
  onReturnToMap,
  mappedRouteActive = false,
  mappedRoutePending = false,
  selectedVenueRequestToken = 0,
  onVenueClose,
  onHome,
  onSurfaceClose,
  landedEntry = 0,
}: {
  arrivalSearch: string;
  surfaceId: MapSurfaceId;
  surfaceTitle: string;
  surfaceState: MapSurfaceState;
  selectionHint: string;
  onRestore: (entry: SurfaceEntry<MapSurfaceState> | null) => void;
  onReturnToMap?: (camera: NonNullable<MapSurfaceState["returnCamera"]>) => void;
  mappedRouteActive?: boolean;
  mappedRoutePending?: boolean;
  selectedVenueRequestToken?: number;
  onVenueClose?: (requestToken: number) => void;
  onHome: () => void;
  onSurfaceClose: () => void;
  /** Changes when the map lets a pub go for a walking-route link it landed. */
  landedEntry?: number;
}) {
  const mappedWalk = mappedRouteActive || mappedRoutePending;
  const [stack, setStack] = useState<SurfaceStack<MapSurfaceState>>(
    ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>,
  );
  const stackRef = useRef(stack);
  const rootStateRef = useRef<MapSurfaceState | undefined>(undefined);
  const initialisedRef = useRef(false);
  const ownedPathRef = useRef<string | null>(null);
  const pendingOpensRef = useRef<SurfaceEntry<MapSurfaceState>[]>([]);
  const onRestoreRef = useRef(onRestore);
  const onReturnToMapRef = useRef(mappedWalk ? undefined : onReturnToMap);
  const venueCloseRef = useRef({ mappedWalk, selectedVenueRequestToken, onVenueClose });
  const onHomeRef = useRef(onHome);
  const onSurfaceCloseRef = useRef(onSurfaceClose);
  const pendingHomeRef = useRef<SurfaceStack<MapSurfaceState> | null>(null);
  const selectionHintRef = useRef(selectionHint);
  const publishStack = useCallback((next: SurfaceStack<MapSurfaceState>) => {
    const { mappedWalk, selectedVenueRequestToken, onVenueClose } = venueCloseRef.current;
    if (mappedWalk && stackRef.current.some((entry) => entry.id === "venue")
      && !next.some((entry) => entry.id === "venue")) {
      onVenueClose?.(selectedVenueRequestToken);
    }
    stackRef.current = next;
    setStack(next);
  }, []);
  const publishInitialStack = useCallback((next: SurfaceStack<MapSurfaceState>) => {
    stackRef.current = next;
    queueMicrotask(() => setStack(next));
  }, []);

  useLayoutEffect(() => {
    onRestoreRef.current = onRestore;
    onReturnToMapRef.current = mappedWalk ? undefined : onReturnToMap;
    venueCloseRef.current = { mappedWalk, selectedVenueRequestToken, onVenueClose };
    onHomeRef.current = onHome;
    onSurfaceCloseRef.current = onSurfaceClose;
    selectionHintRef.current = selectionHint;
  }, [onHome, onRestore, onReturnToMap, mappedWalk, selectedVenueRequestToken, onVenueClose, onSurfaceClose, selectionHint]);

  const commitOpen = useCallback(
    (entry: SurfaceEntry<MapSurfaceState>) => {
      if (typeof window === "undefined") return;
      if (stackRef.current.length === 0) rootStateRef.current = entry.state;
      const transition = mapSurfaceOpenTransition(stackRef.current, entry);
      const above = readEntriesAboveRoot(window.history.state) ?? stackRef.current.length;
      publishStack(transition.stack);
      const state = stampMapSurfaceHistory(
        window.history.state,
        transition.stack,
        selectedVenueId(transition.stack),
        transition.kind === "push" ? above + 1 : above,
      );
      const url = urlForStack(transition.stack, selectionHintRef.current);
      if (transition.kind === "push") {
        window.history.pushState(state, "", url);
      } else {
        window.history.replaceState(state, "", url);
      }
    },
    [publishStack],
  );

  const open = useCallback(
    (entry: SurfaceEntry<MapSurfaceState>) => {
      if (typeof window === "undefined") return;
      if (!initialisedRef.current) {
        pendingOpensRef.current.push(entry);
        return;
      }
      commitOpen(entry);
    },
    [commitOpen],
  );

  useLayoutEffect(() => {
    if (initialisedRef.current || typeof window === "undefined") return;
    initialisedRef.current = true;
    ownedPathRef.current = window.location.pathname;

    const flushPendingOpens = () => {
      const pending = pendingOpensRef.current.splice(0);
      for (const entry of pending) commitOpen(entry);
    };

    const restored = readMapSurfaceHistory<MapSurfaceState>(window.history.state);
    if (restored !== null) {
      publishInitialStack(restored);
      flushPendingOpens();
      return;
    }

    const root = ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>;
    const shown = surfaceId === "none"
      ? null
      : { id: surfaceId, title: surfaceTitle, state: surfaceState };
    const arrivalUrl = currentBrowserUrl();

    if (shown?.id === "venue" && searchHasSelection(arrivalSearch)) {
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, root, ""),
        "",
        urlForStack(root, ""),
      );
      const selected = [shown] as SurfaceStack<MapSurfaceState>;
      window.history.pushState(
        stampMapSurfaceHistory(window.history.state, selected, shown.state.venueId),
        "",
        arrivalUrl,
      );
      publishInitialStack(selected);
      flushPendingOpens();
      return;
    }

    // A story arrival (`?landmark=`) is the same shape as a selection arrival:
    // the map is the root entry, the story sits over it, and Back from the
    // story lands on the map without the story rather than on the page before.
    if (
      shown?.id === "landmark" &&
      new URLSearchParams(arrivalSearch).has(LANDMARK_PARAM)
    ) {
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, root, ""),
        "",
        urlForStack(root, ""),
      );
      const story = [shown] as SurfaceStack<MapSurfaceState>;
      window.history.pushState(
        stampMapSurfaceHistory(window.history.state, story, ""),
        "",
        arrivalUrl,
      );
      publishInitialStack(story);
      flushPendingOpens();
      return;
    }

    // A planner arrival (`?plan=1`) is the same shape again: the planner entry
    // keeps the arrival address, and the map root under it does not reopen it.
    if (shown?.id === "planner") {
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, root, ""),
        "",
        urlForStack(root, ""),
      );
      const planner = [shown] as SurfaceStack<MapSurfaceState>;
      window.history.pushState(stampMapSurfaceHistory(window.history.state, planner, ""), "", arrivalUrl);
      publishInitialStack(planner);
      flushPendingOpens();
      return;
    }

    window.history.replaceState(
      stampMapSurfaceHistory(window.history.state, root, ""),
      "",
      currentBrowserUrl(),
    );
    if (shown) open(shown);
    flushPendingOpens();
  }, [arrivalSearch, commitOpen, open, publishInitialStack, surfaceId, surfaceState, surfaceTitle]);

  // A walking-route link followed while the map stays mounted opens a fresh
  // entry with no Map trail; the trail held until then belongs to the page the
  // reader left. Once the map lets that trail's pub go, the landed entry is its
  // root, with no traversal and no Home. A landed trail is never overwritten.
  const landedEntryRef = useRef(landedEntry);
  useLayoutEffect(() => {
    if (landedEntryRef.current === landedEntry || typeof window === "undefined") return;
    landedEntryRef.current = landedEntry;
    if (!initialisedRef.current || readMapSurfaceHistory(window.history.state) !== null) return;
    const root = ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>;
    window.history.replaceState(
      stampMapSurfaceHistory(window.history.state, root, ""),
      "",
      currentBrowserUrl(),
    );
    publishInitialStack(root);
  }, [landedEntry, publishInitialStack]);

  useLayoutEffect(() => {
    if (!initialisedRef.current || typeof window === "undefined") return;
    const shown = surfaceId === "none"
      ? null
      : { id: surfaceId, title: surfaceTitle, state: surfaceState };
    const current = currentSurface(stackRef.current);
    // Browser history is authoritative. A transient empty render while a
    // landed snapshot restores may never be interpreted as a second Home
    // traversal. All deliberate exits call back() or home() directly.
    if (!shown) return;
    // Next's router can render a Back or Forward before this owner hears
    // `popstate`. Until the landed trail is published, a render still shows
    // the previous entry and must not be written over the one just landed.
    const held = readMapSurfaceHistory<MapSurfaceState>(window.history.state);
    if (held !== null && JSON.stringify(held) !== JSON.stringify(stackRef.current)) return;
    if (
      current?.id === shown.id &&
      current.title === shown.title &&
      sameState(current.state, shown.state)
    ) {
      return;
    }
    open(shown);
  }, [open, surfaceId, surfaceState, surfaceTitle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (event: PopStateEvent) => {
      const landed = readMapSurfaceHistory<MapSurfaceState>(event.state);
      const next = landed ?? (ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>);
      const closingHome = pendingHomeRef.current !== null;
      const previous = pendingHomeRef.current ?? stackRef.current;
      pendingHomeRef.current = null;
      if (landed !== null && !selectedVenueId(next)) {
        const url = urlForStack(next, "");
        if (currentBrowserUrl() !== url) window.history.replaceState(window.history.state, "", url);
      }
      if (
        window.location.pathname === ownedPathRef.current &&
        landed !== null &&
        (
          closingHome ||
          (previous.length > next.length &&
            next.every((entry, index) => entry.id === previous[index]?.id)) ||
          isSurfaceOpen(next, previous) ||
          isSurfaceOpen(previous, next)
        )
      ) {
        onSurfaceCloseRef.current();
      }
      const journeyRoot = next[0] ?? previous[0];
      if (journeyRoot) rootStateRef.current = journeyRoot.state;
      publishStack(next);
      onRestoreRef.current(currentSurface(next));
      if (next.length === 0 && rootStateRef.current?.returnCamera) {
        onReturnToMapRef.current?.(rootStateRef.current.returnCamera);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [publishStack]);

  const complete = useCallback((id: MapSurfaceId) => {
    if (typeof window === "undefined") return;
    const held = stackRef.current;
    if (currentSurface(held)?.id !== id) return;
    const next = id === "choose-area" ? ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState> : held.slice(0, -1);
    publishStack(next);
    window.history.replaceState(
      stampMapSurfaceHistory(window.history.state, next, selectedVenueId(next),
        readEntriesAboveRoot(window.history.state) ?? held.length),
      "",
      urlForStack(next, selectionHintRef.current),
    );
  }, [publishStack]);

  const back = useCallback(() => {
    if (!stackRef.current.length || typeof window === "undefined") return;
    window.history.back();
  }, []);

  const resolveSelection = useCallback(
    (requestedVenueId: string, canonicalVenueId: string) => {
      if (
        typeof window === "undefined" ||
        !requestedVenueId ||
        !canonicalVenueId
      ) {
        return;
      }
      const held = stackRef.current;
      const current = currentSurface(held);
      const { pathname, search, hash } = window.location;
      const resolution = selectionResolution({
        requestedVenueId,
        canonicalVenueId,
        currentVenueId: current?.id === "venue" ? current.state?.venueId ?? null : null,
        liveSelectedVenueId: new URLSearchParams(search).get("sel"),
      });
      if (resolution.kind === "none") return;
      if (resolution.kind === "canonicalise") {
        const canonicalUrl = canonicalizeAcceptedArrivalSelection({
          pathname,
          search,
          hash,
          requestedVenueId,
          canonicalVenueId: resolution.venueId,
        });
        if (!canonicalUrl) return;
        const next = current?.id === "venue"
          ? [...held.slice(0, -1), {
              ...current,
              state: { ...current.state, venueId: resolution.venueId },
            }] as SurfaceStack<MapSurfaceState>
          : held;
        if (next !== held) publishStack(next);
        window.history.replaceState(
          stampMapSurfaceHistory(window.history.state, next, resolution.venueId,
            readEntriesAboveRoot(window.history.state) ?? next.length),
          "",
          canonicalUrl,
        );
        announceAcceptedArrivalUrlChange();
        return;
      }
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, held, selectedVenueId(held),
          readEntriesAboveRoot(window.history.state) ?? held.length),
        "",
        cleanMapUrl(pathname, search, hash),
      );
    },
    [publishStack],
  );

  const rejectSelection = useCallback(
    (venueId: string) => {
      if (typeof window === "undefined" || !venueId) return;
      const held = stackRef.current;
      const current = currentSurface(held);
      if (current?.id === "venue" && current.state?.venueId === venueId) {
        back();
        return;
      }
      const { pathname, search, hash } = window.location;
      if (new URLSearchParams(search).get("sel") !== venueId) return;
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, held, selectedVenueId(held),
          readEntriesAboveRoot(window.history.state) ?? held.length),
        "",
        cleanMapUrl(pathname, search, hash),
      );
    },
    [back],
  );

  const home = useCallback(() => {
    const held = stackRef.current;
    if (!held.length) return;
    pendingHomeRef.current = held;
    publishStack(ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>);
    onHomeRef.current();
    if (typeof window === "undefined") return;
    const above = readEntriesAboveRoot(window.history.state) ?? held.length;
    if (above > 0) window.history.go(-above);
  }, [publishStack]);

  useEffect(() => {
    const onDismiss = () => {
      const root = ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>;
      const above = readEntriesAboveRoot(window.history.state) ?? stackRef.current.length;
      publishStack(root);
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, root, "", above),
        "",
        urlForStack(root, ""),
      );
      onHomeRef.current();
    };
    window.addEventListener(MOBILE_SHEET_DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(MOBILE_SHEET_DISMISS_EVENT, onDismiss);
  }, [publishStack]);

  /** Close `id` through Back when it is the top entry, otherwise with `close`. */
  const leave = useCallback((id: MapSurfaceId, close: () => void) => {
    if (currentSurface(stackRef.current)?.id === id) back();
    else close();
  }, [back]);

  return useMemo(
    () => ({
      backLabel: backActionLabel(stack),
      complete,
      back,
      home,
      leave,
      open,
      rejectSelection,
      resolveSelection,
      holdsSurface: (id: MapSurfaceId) => stack.some((entry) => entry.id === id),
    }),
    [back, complete, home, leave, open, rejectSelection, resolveSelection, stack],
  );
}

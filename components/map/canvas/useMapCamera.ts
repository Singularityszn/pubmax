import type { MapRouteStop } from "@/lib/curatedWalk";
import { MIN_ROUTE_CONTENT_PX, whenBottomSheetSettles } from "./bottomSheetGeometry";
import { projectedRouteCamera } from "./projectedRouteCamera";
import { releaseOpeningFrame } from "./openingFrame";
export { measureBottomSheetTop, whenBottomSheetSettles } from "./bottomSheetGeometry";
import { fairPintRouteInsets } from "@/components/map/fairpint/fairPintRouteInsets";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as maplibregl from "maplibre-gl";
import type { Venue } from "@/lib/venues";
import { LONG_JUMP_CURVE, easeOutCubic } from "./easing";
import { createCameraIntentCoordinator, nextCameraRequestToken, type CameraIntentKind, type CameraIntentOwner } from "@/lib/cameraIntent";
import { mapArrivalBearingPlan } from "@/lib/mapArrivalBearing";
import { cameraIntentBlocked, type GestureCameraState } from "@/lib/mapGestureGuard";
import type { MapCameraFocus } from "@/lib/mapCameraFocus";
import { SHEET_SNAP_ORDER, mobileSelectCameraOffset, sheetTopReserveY, sheetTranslateY } from "@/lib/sheetSnap";
import { mapVisibleBand, nearMeCameraFrame, nearestVenueKm } from "@/lib/nearMeMapFrame";

type MapView = { center: [number, number]; zoom: number; pitch: number; bearing: number };

export function latestMapCameraRequestToken({
  closeVenueRequestToken = 0,
  routeRequestToken,
  nearbyRequestToken,
  searchRecoveryToken,
  selectedVenueId,
  selectedVenueRequestToken,
  focusPoint,
}: {
  closeVenueRequestToken?: number;
  routeRequestToken?: number;
  nearbyRequestToken: number;
  searchRecoveryToken?: number;
  selectedVenueId: string;
  selectedVenueRequestToken: number;
  focusPoint?: MapCameraFocus | null;
}) {
  return Math.max(
    closeVenueRequestToken,
    routeRequestToken ?? 0,
    nearbyRequestToken,
    searchRecoveryToken ?? 0,
    selectedVenueId ? selectedVenueRequestToken : 0,
    focusPoint?.source === "area" ? focusPoint.token : 0,
  );
}

export function palCameraDefaults({ nearbyRequestToken = 0 }: { nearbyRequestToken?: number }) {
  return { nearbyRequestToken };
}

export function whenWalkPanelSettles(done: () => void, waitForMount = false): () => void {
  return whenBottomSheetSettles(0, () => done(), { waitForSheet: waitForMount, waitForMotion: !waitForMount, surfaceSelector: WALK_PANEL_SELECTOR, surfaceAncestor: ".mapDrawer.left.open" });
}

// Chrome the near-me camera must stay clear of. The top values are only a
// FALLBACK: the phone chrome stack is being reworked, and a hardcoded height
// would drift the reader silently under a changed chip row. Measure it.
const PHONE_TOP_INSET = 190;
const PHONE_BOTTOM_INSET = 190;
const DESKTOP_TOP_INSET = 150;
const DESKTOP_BOTTOM_INSET = 110;

const PHONE_ROUTE_PADDING = { top: 160, right: 28, bottom: 200, left: 28 };
const WALK_ROUTE_PADDING = { ...PHONE_ROUTE_PADDING, right: 88, bottom: 280 };
// A stop's 44px target is centred on its numbered disc. It keeps a 2px gap
// from the chrome, and the road it ends may run up to that gap.
const STOP_TARGET_RADIUS_PX = 22;
const STOP_TARGET_CLEARANCE_PX = STOP_TARGET_RADIUS_PX + 2;

/** Above a phone but at most 500px tall: the map's height is the scarce room. */
function isShortLandscape(container: HTMLElement, isPhone: boolean) {
  return !isPhone && container.clientHeight <= 500;
}

function desktopStatusSize(style: CSSStyleDeclaration | null) {
  return {
    gap: Number.parseFloat(style?.getPropertyValue("--city-status-desktop-gap") ?? "") || 82,
    height: Number.parseFloat(style?.getPropertyValue("--city-status-desktop-height") ?? "") || 58,
  };
}

export function useRouteCameraFraming({
  mapReady, routeKey, selectedVenueId, requestToken = 0, routePending = false, fitRoute,
  closeRequestToken = 0, gestureCameraRef,
}: {
  mapReady: boolean;
  routeKey: string;
  selectedVenueId: string;
  requestToken?: number;
  routePending?: boolean;
  fitRoute: ReturnType<typeof useMapCamera>["fitRoute"];
  closeRequestToken?: number;
  gestureCameraRef?: MutableRefObject<GestureCameraState>;
}) {
  const consumedRequest = useRef(0);
  const consumedClose = useRef(0);
  const selection = useRef<{ id: string; movementSerial: number | null }>({ id: "", movementSerial: null });
  useEffect(() => {
    const movementSerial = gestureCameraRef?.current.movementSerial ?? 0;
    const previous = selection.current;
    if (selectedVenueId !== previous.id) {
      selection.current = { id: selectedVenueId,
        movementSerial: selectedVenueId ? movementSerial : previous.movementSerial };
    }
    if (!mapReady || routePending) return;
    const userOwned = consumedRequest.current !== requestToken;
    consumedRequest.current = requestToken;
    if (!selectedVenueId && !routeKey.includes(">")) {
      selection.current = { id: "", movementSerial: null };
      consumedClose.current = closeRequestToken;
      if (userOwned) fitRoute("user", requestToken);
      return;
    }
    const closed = consumedClose.current !== closeRequestToken;
    if (!selectedVenueId && previous.movementSerial !== null) {
      if (userOwned && requestToken > closeRequestToken) {
        selection.current = { id: "", movementSerial: null };
        fitRoute("user", requestToken);
      } else if (closed) {
        consumedClose.current = closeRequestToken;
        selection.current = { id: "", movementSerial: null };
        if (routeKey.includes(">") && previous.movementSerial === movementSerial) fitRoute("user", closeRequestToken);
      }
      return;
    }
    if (!selectedVenueId && closed) {
      consumedClose.current = closeRequestToken;
      if (!userOwned) return;
    }
    if (selectedVenueId && !userOwned) return;
    fitRoute(userOwned ? "user" : "automatic", requestToken);
  }, [routeKey, mapReady, fitRoute, selectedVenueId, requestToken, routePending, closeRequestToken, gestureCameraRef]);
}

export function useNearbyCameraFraming({
  mapReady, userLocation, routeLength, nearbyMapVenues, fitNearby, framingOwedRef, requestToken,
}: {
  mapReady: boolean;
  userLocation: { lat: number; lng: number } | null | undefined;
  routeLength: number;
  nearbyMapVenues: Venue[];
  fitNearby: ReturnType<typeof useMapCamera>["fitNearby"];
  framingOwedRef: MutableRefObject<boolean>;
  requestToken: number;
}) {
  const didFitRef = useRef("");
  const consumedRequest = useRef(0);
  const key = `${userLocation?.lat.toFixed(5)},${userLocation?.lng.toFixed(5)}:${requestToken}`;
  useEffect(() => {
    if (!mapReady || !userLocation || nearbyMapVenues.length === 0) return;
    const userOwned = consumedRequest.current !== requestToken;
    if (routeLength >= 2 && !userOwned) return;
    if (didFitRef.current === key) return;
    didFitRef.current = key;
    const owner = userOwned ? "user" : "automatic";
    consumedRequest.current = requestToken;
    fitNearby(userLocation, nearbyMapVenues, owner, requestToken);
  }, [mapReady, userLocation, routeLength, nearbyMapVenues, fitNearby, key, requestToken]);
  useEffect(() => {
    framingOwedRef.current = Boolean(userLocation) && routeLength < 2 && nearbyMapVenues.length > 0 && didFitRef.current !== key;
  }, [mapReady, userLocation, routeLength, nearbyMapVenues, framingOwedRef, key]);
}

const WALK_PANEL_SELECTOR = ".curatedWalkPanel";

function walkPanelElement(): HTMLElement | null {
  return document.querySelector(WALK_PANEL_SELECTOR)?.closest<HTMLElement>(".mapDrawer.left.open") ?? null;
}

function walkSurfacePadding(rect: DOMRect): Required<maplibregl.PaddingOptions> | null {
  const panel = walkPanelElement();
  if (!panel || panel.closest('[data-sheet-exiting="true"]')) return null;
  const cover = panel.getBoundingClientRect();
  let coverTop = cover.top;
  let coverLeft = cover.left;
  let coverRight = cover.right;
  if (!panel.classList.contains("sheet-dragging") && typeof DOMMatrixReadOnly !== "undefined") {
    const transform = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
    // Walk entrances lay out their resting size before the transform travels.
    if (panel.classList.contains("mobileSharedSheet")) coverTop -= transform.m42;
    if (panel.dataset.springAxis === "horizontal") {
      coverLeft -= transform.m41;
      coverRight -= transform.m41;
    }
  }
  if (panel.dataset.springAxis === "vertical" && !panel.classList.contains("sheet-dragging") && typeof DOMMatrixReadOnly !== "undefined") {
    const snap = SHEET_SNAP_ORDER.find((value) => panel.classList.contains(`sheet-${value}`));
    if (snap) {
      const translateY = new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42;
      // The bounded waiter can expire before a busy frame starts the entrance.
      coverTop = Math.min(coverTop, cover.top - translateY + sheetTranslateY(snap, window.innerHeight, sheetTopReserveY(panel)));
    }
  }
  const chrome = [".mobileMapChrome", ".mapToolbar"].map((selector) =>
    document.querySelector(selector)?.getBoundingClientRect()).find((bounds) => bounds && bounds.width > 0 && bounds.height > 0);
  const padding = { top: Math.max(32, (chrome?.bottom ?? rect.top) - rect.top + 16), right: 32, bottom: 48, left: 32 };
  if (cover.width >= rect.width * 0.75) padding.bottom = Math.max(48, rect.bottom - coverTop + 32);
  else if (coverLeft < rect.left + rect.width / 2) padding.left = Math.max(32, coverRight - rect.left + 28);
  else padding.right = Math.max(32, rect.right - coverLeft + 28);
  return padding;
}

function limitRoutePadding(padding: Required<maplibregl.PaddingOptions>, width: number, height: number) {
  const vertical = Math.min(1, Math.max(0, (height - MIN_ROUTE_CONTENT_PX) / (padding.top + padding.bottom)));
  const horizontal = Math.min(1, Math.max(0, (width - MIN_ROUTE_CONTENT_PX) / (padding.left + padding.right)));
  return { top: Math.floor(padding.top * vertical), right: Math.floor(padding.right * horizontal),
    bottom: Math.floor(padding.bottom * vertical), left: Math.floor(padding.left * horizontal) };
}

export function walkSurfaceOffset(): [number, number] | undefined {
  const rect = document.querySelector(".maplibreMap")?.getBoundingClientRect();
  const padding = rect && walkSurfacePadding(rect);
  if (!rect || !padding) return;
  const bounded = limitRoutePadding(padding, rect.width, rect.height);
  return [(bounded.left - bounded.right) / 2, (bounded.top - bounded.bottom) / 2];
}

function routeFitPadding(
  map: maplibregl.Map,
  isPhone: boolean,
  isWalk: boolean,
): Required<maplibregl.PaddingOptions> {
  const container = map.getContainer();
  const walkPadding = isWalk ? walkSurfacePadding(container.getBoundingClientRect()) : null;
  const phonePadding = isWalk ? WALK_ROUTE_PADDING : PHONE_ROUTE_PADDING;
  const containerTop = container.getBoundingClientRect().top;
  const shortLandscape = isShortLandscape(container, isPhone);
  const statusBounds = isPhone ? null : document.querySelector(".cityStatusStack")?.getBoundingClientRect();
  const toolbar = isPhone ? null : document.querySelector(".mapToolbar");
  const toolbarBounds = toolbar?.getBoundingClientRect();
  const chromeStyle = toolbar ? getComputedStyle(toolbar) : null;
  const { gap: statusGap, height: statusHeight } = desktopStatusSize(chromeStyle);
  // Reserve the banner below the actual toolbar, including its lower tablet
  // position, before transport data arrives. Clear taller visible content too.
  const reservedBottom = toolbarBounds?.height
    ? toolbarBounds.bottom - containerTop + (shortLandscape ? STOP_TARGET_CLEARANCE_PX : statusGap + statusHeight + 16)
    : 300;
  const desktopTop = Math.max(reservedBottom, statusBounds?.height ? statusBounds.bottom - containerTop + 16 : 0);
  const routeChip = shortLandscape ? document.querySelector(".mappedRouteChip")?.getBoundingClientRect() : null;
  const desktopBottom = shortLandscape
    ? Math.max(72, routeChip?.height ? container.getBoundingClientRect().bottom - routeChip.top + STOP_TARGET_CLEARANCE_PX : 88)
    : 180;
  const recoveryBounds = isPhone
    ? document.querySelector(".mapRecenterBtn")?.getBoundingClientRect()
    : null;
  const utilityBounds = isPhone
    ? document.querySelector(".mobileMapUtilityCorner")?.getBoundingClientRect()
    : null;
  const attributionBounds = isPhone
    ? container.querySelector(".maplibregl-ctrl-attrib")?.getBoundingClientRect()
    : null;
  const palInsets = Array.from(document.querySelectorAll(".palSummon, .palVoiceBar"))
    .reduce((inset, element) => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height || getComputedStyle(element).visibility === "hidden") return inset;
      if (shortLandscape && element.matches(".palSummon")) {
        return { ...inset, right: Math.max(inset.right, container.getBoundingClientRect().right - bounds.left + 24) };
      }
      // Tilt projects the lower stops beyond the flat bounds. Reserve the
      // full disc diameter as well as the Pal's measured berth.
      return { ...inset, bottom: Math.max(inset.bottom, container.getBoundingClientRect().bottom - bounds.top + 48) };
    }, { bottom: 0, right: 0 });
  const phoneBottomBounds = isWalk && isPhone ? Array.from(document.querySelectorAll(".palSummon, .mobilePlanActivation, .mobileTabBar"))
    .map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0) : [];
  const padding = walkPadding ?? (isPhone
    ? { ...phonePadding,
        // Names extend beyond their discs. Keep them above the credit control.
        bottom: Math.max(phonePadding.bottom, palInsets.bottom, ...phoneBottomBounds.map((rect) => container.getBoundingClientRect().bottom - rect.top + 16), attributionBounds?.height
          ? container.getBoundingClientRect().bottom - attributionBounds.top + 8 : 0),
        // Keep the full numbered disc clear of Near me and transport controls.
        right: Math.max(phonePadding.right, utilityBounds?.width
          ? container.getBoundingClientRect().right - utilityBounds.left + 24 : 0),
        top: Math.max(phonePadding.top,
        measureTopChromeBottom(containerTop, phonePadding.top),
        recoveryBounds?.height ? recoveryBounds.bottom - containerTop + 16 : 0) }
    : { top: desktopTop, right: Math.max(72, palInsets.right),
        bottom: Math.max(desktopBottom, palInsets.bottom), left: 72 });
  const padded = fairPintRouteInsets(container, isPhone, padding);
  return limitRoutePadding(padded, container.clientWidth, container.clientHeight);
}

/**
 * What covers the top of the map on a phone: the floating chrome stack, and the
 * price coverage strip docked under it. A sheet hides the strip without taking
 * its box (components/map/mapBannerStaging.css), so a camera aimed while a
 * sheet is open still keeps clear of the strip the sheet's close brings back.
 */
const TOP_LANE_SELECTORS = [".mobileMapChrome", ".cityPubsOnlyNote"] as const;

/** Breathing room between the lowest chrome and the reader's own band. */
const TOP_CHROME_GAP_PX = 12;

/**
 * Bottom edge of the map's top lane, in map-container pixels.
 *
 * Measured for the same reason the sheet is: it is a stack whose rows come and
 * go (a query chip, a rail, a search row, the coverage strip), so its height is
 * a fact about the moment rather than a constant. Falls back to the inset above
 * when it cannot be read.
 */
function measureTopChromeBottom(containerTop: number, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const selector of TOP_LANE_SELECTORS) {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    if (rect && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
  }
  return Number.isFinite(bottom) ? bottom - containerTop + TOP_CHROME_GAP_PX : fallback;
}

/** The phone venue select offset, aimed between the top lane and the sheet. */
export function phoneSelectCameraOffset(height: number, containerTop: number, sheetTopPx: number | null) {
  return mobileSelectCameraOffset(height, "half", sheetTopPx, measureTopChromeBottom(containerTop, 0));
}

// Long enough to read as travel between two places, short enough that the
// answer does not feel withheld. Matches the pub-select fly-to.
const NEAR_ME_CAMERA_DURATION_MS = 700;



type CameraRefs = {
  latestRequestToken?: number;
  mapRef: MutableRefObject<maplibregl.Map | null>;
  reducedRef: MutableRefObject<boolean>;
  /** The city's designed view: the attitude a whole-city fit returns to. */
  cityViewRef: MutableRefObject<MapView>;
  cityBoundsRef: MutableRefObject<[[number, number], [number, number]]>;
  routeRef: MutableRefObject<MapRouteStop[]>;
  routeLineRef: MutableRefObject<GeoJSON.FeatureCollection>;
  venuesRef: MutableRefObject<Venue[]>;
  queryVenuesRef?: MutableRefObject<Venue[]>;
  /** Live gesture ownership. See lib/mapGestureGuard.ts for the rule. */
  gestureCameraRef: MutableRefObject<GestureCameraState>;
};

// Camera helpers read live refs and keep stable callback identities. Recreating
// them for each route or venue array would repeat the arrival and refit effects.
export function useMapCamera(refs: CameraRefs) {
  const {
    mapRef,
    reducedRef,
    cityViewRef,
    cityBoundsRef,
    routeRef,
    routeLineRef,
    venuesRef,
    queryVenuesRef,
    gestureCameraRef,
  } = refs;
  const routeFrameRef = useRef<{ key: string; gestureEndedAt: number | null } | null>(null);
  const pendingOwnerRef = useRef<CameraIntentOwner | null>(null);
  const routeWaitRef = useRef<(() => void) | null>(null);
  const userRequestRef = useRef(0);
  const palFrameRef = useRef<{ key: string; gestureEndedAt: number | null } | null>(null);
  const coordinator = useMemo(() => createCameraIntentCoordinator({
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    onRun: (kind, sequence) => {
      performance.mark(`pubmax:camera-intent:${kind}`);
      window.dispatchEvent(new CustomEvent("pubmax:camera-intent", {
        detail: { kind, sequence },
      }));
    },
  }), []);

  useEffect(() => {
    const requestToken = refs.latestRequestToken ?? 0;
    if (requestToken <= userRequestRef.current) return;
    userRequestRef.current = requestToken;
    routeWaitRef.current?.();
    coordinator.dispose();
    pendingOwnerRef.current = null;
  }, [coordinator, refs.latestRequestToken]);

  const claimCamera = useCallback((owner: CameraIntentOwner, requestToken = 0) => {
    if (requestToken && requestToken < userRequestRef.current) return false;
    if (owner !== "user" && pendingOwnerRef.current === "user") return false;
    if (owner === "user") {
      routeWaitRef.current?.();
      userRequestRef.current = requestToken || nextCameraRequestToken();
      palFrameRef.current = null;
      coordinator.dispose();
      pendingOwnerRef.current = null;
    }
    return true;
  }, [coordinator]);

  // Check ownership before the shared coordinator, which otherwise lets any
  // later callback replace a pending move regardless of the original action.
  const scheduleCamera = useCallback((owner: CameraIntentOwner, kind: CameraIntentKind, key: string, move: (map: maplibregl.Map) => void, requestToken = 0) => {
    if (!claimCamera(owner, requestToken)) return;
    const requestVersion = userRequestRef.current;
    const allowed = () => {
      if (requestToken && requestToken < userRequestRef.current) return false;
      if (owner === "user" && requestVersion !== userRequestRef.current) return false;
      const gesture = gestureCameraRef.current;
      const frame = palFrameRef.current;
      if (frame && (gesture.active || frame.gestureEndedAt !== gesture.endedAt)) palFrameRef.current = null;
      if (cameraIntentBlocked(kind, gesture, performance.now())) return false;
      if (owner === "pal") return palFrameRef.current?.key === key;
      if (owner === "automatic" && palFrameRef.current) return false;
      if (owner === "user") palFrameRef.current = null;
      return true;
    };
    // Asked twice on purpose. The first check keeps a move that is already
    // refused from occupying the lane; the second is the one that matters,
    // because the lane defers by a frame and a reader can put a finger down
    // inside it. `map.stop()` is behind the guard too: an intent that must
    // stand down may not interrupt the reader's own momentum either.
    if (!allowed()) return;
    // The automatic opening turn preserves the route's camera ownership.
    if (kind !== "route" && kind !== "route-recovery" && kind !== "arrival") routeFrameRef.current = null;
    const run = () => {
      pendingOwnerRef.current = null;
      const map = mapRef.current;
      if (!map) return;
      if (!allowed()) return;
      map.stop();
      // The opening keeps a phone's free-map frame: the arrival turn, and the
      // opening-location answer, which re-aims at the city's own centre when no
      // location is shared. Every other move aims at the canvas middle.
      if (kind !== "arrival" && kind !== "opening-location") releaseOpeningFrame(map);
      move(map);
    };
    if (coordinator.schedule(kind, key, run)) pendingOwnerRef.current = owner;
  }, [claimCamera, coordinator, gestureCameraRef, mapRef]);

  useEffect(() => () => { routeWaitRef.current?.(); coordinator.dispose(); }, [coordinator]);

  // Near-me framing waits for the bottom sheet before it joins the lane (see
  // whenBottomSheetSettles), so a move is owed during that wait as well.
  const sheetWaitsRef = useRef(0);
  const cameraLanePending = useCallback(
    () => coordinator.pending() || sheetWaitsRef.current > 0,
    [coordinator],
  );

  // Explicit camera move for venue, route, and city navigation.
  const cinematic = useCallback((options: maplibregl.EaseToOptions, kind: CameraIntentKind, owner: CameraIntentOwner, requestToken = owner === "user" ? nextCameraRequestToken() : 0) => {
    const duration = reducedRef.current ? 0 : (options.duration ?? 1000);
    const center = Array.isArray(options.center)
      ? options.center.join(",")
      : options.center && "lng" in options.center
        ? `${options.center.lng},${options.center.lat}`
        : "current";
    scheduleCamera(owner, kind, `${kind}:${center}:${options.zoom ?? "current"}:${options.pitch ?? "current"}`, (map) => map.easeTo({ ...options, duration }), requestToken);
  }, [reducedRef, scheduleCamera]);

  // The map's opening turn. ONE eased move, once, and the camera is still
  // afterwards; lib/mapArrivalBearing.ts holds the rule and every case where
  // there is no move to make. It goes through the same lane as everything
  // else, and it is a REACTIVE intent, so a reader who already has the map
  // keeps the attitude they chose (lib/mapGestureGuard.ts).
  const easeArrivalBearing = useCallback((deepLinkedVenue: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const plan = mapArrivalBearingPlan({
      currentBearing: map.getBearing(),
      reducedMotion: reducedRef.current,
      deepLinkedVenue,
    });
    if (!plan) return;
    scheduleCamera("automatic", "arrival", `arrival:${plan.bearing}`, (target) => target.easeTo({
      bearing: plan.bearing,
      duration: plan.duration,
      easing: easeOutCubic,
    }));
  }, [mapRef, reducedRef, scheduleCamera]);

  const fitRoute = useCallback((owner: CameraIntentOwner = "automatic", requestToken = owner === "user" ? nextCameraRequestToken() : 0, waitForPanel = false) => {
    if (!claimCamera(owner, requestToken)) return;
    const current = routeRef.current;
    if (current.length < 2) {
      routeFrameRef.current = null;
      return;
    }
    const stopCoordinates = () => current.map((venue): [number, number] => [venue.longitude, venue.latitude]);
    const lineCoordinates = () => {
      const coordinates: [number, number][] = [];
      const extendLine = (line: GeoJSON.Position[]) => {
        for (const [lng, lat] of line) {
          if (typeof lng === "number" && typeof lat === "number"
            && Number.isFinite(lng) && Number.isFinite(lat)) coordinates.push([lng, lat]);
        }
      };
      for (const feature of routeLineRef.current.features) {
        const geometry = feature.geometry;
        if (geometry.type === "LineString") extendLine(geometry.coordinates);
        else if (geometry.type === "MultiLineString") geometry.coordinates.forEach(extendLine);
      }
      return coordinates;
    };
    const routeBounds = (stops = stopCoordinates(), line = lineCoordinates()) => {
      const bounds = new maplibregl.LngLatBounds();
      [...stops, ...line].forEach((coordinate) => bounds.extend(coordinate));
      return bounds;
    };
    const boundsKey = routeBounds().toArray().flat().join(",");
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const kind = owner === "user" ? "route-recovery" : "route";
    const request = owner === "user" ? requestToken : 0;
    const routeKey = current.map((venue) => venue.id).join(">");
    const container = mapRef.current?.getContainer();
    const viewportKey = `${container?.clientWidth}:${container?.clientHeight}`;
    const scheduleFit = () => scheduleCamera(owner, kind, `${kind}:${request}:${routeKey}:${boundsKey}:${viewportKey}`, (map) => {
      routeFrameRef.current = { key: routeKey, gestureEndedAt: gestureCameraRef.current.endedAt };
      // A road response can arrive after scheduling but before this frame.
      // Read its geometry when the owned camera move actually runs.
      const isWalk = routeLineRef.current.features.some((feature) => feature.properties?.source === "curated");
      const stops = stopCoordinates();
      const line = lineCoordinates();
      const bounds = routeBounds(stops, line);
      const padding = routeFitPadding(map, isPhone, isWalk);
      // MapLibre's legacy fit offset assumes a flat plane, so tilt can hide stops behind this sheet.
      const flatten = isWalk || Boolean(document.querySelector("#fair-pint-lock-form, .fairPintResultFallback"));
      // Keep the current rotation when fitting the route.
      const bearing = map.getBearing();
      map.fitBounds(bounds, {
        padding,
        ...(flatten ? { pitch: 0 } : {}),
        maxZoom: 18,
        duration: reducedRef.current ? 0 : 800,
        bearing,
        // Only the short landscape padding reserves each stop's full target,
        // so only there may the stops fill the padded room exactly.
        ...(isShortLandscape(map.getContainer(), isPhone) ? projectedRouteCamera(map, bounds, stops, line, {
          padding, lineAllowance: STOP_TARGET_RADIUS_PX, bearing, pitch: flatten ? 0 : map.getPitch(), maxZoom: 18,
        }) : {}),
      });
    }, requestToken);
    if (routeLineRef.current.features.some((feature) => feature.properties?.source === "curated")
      && (waitForPanel || document.querySelector('.mobileSheetPortal[data-sheet-exiting="true"] .curatedWalkPanel'))) {
      routeWaitRef.current?.();
      const requestVersion = userRequestRef.current;
      sheetWaitsRef.current += 1;
      if (owner === "user") pendingOwnerRef.current = owner;
      let waiting = true;
      const release = () => {
        if (!waiting) return;
        waiting = false;
        sheetWaitsRef.current -= 1;
        if (routeWaitRef.current === cancelWait) routeWaitRef.current = null;
        if (requestVersion === userRequestRef.current && pendingOwnerRef.current === owner) pendingOwnerRef.current = null;
      };
      const cancel = whenWalkPanelSettles(() => {
        release();
        if (requestVersion === userRequestRef.current) scheduleFit();
      }, waitForPanel);
      function cancelWait() { cancel(); release(); }
      if (waiting) routeWaitRef.current = cancelWait;
      return cancelWait;
    } else scheduleFit();
  }, [claimCamera, gestureCameraRef, mapRef, reducedRef, routeRef, routeLineRef, scheduleCamera]);

  const fitOwnedRoute = useCallback(() => {
    const frame = routeFrameRef.current;
    const gesture = gestureCameraRef.current;
    if (!frame || gesture.active || frame.gestureEndedAt !== gesture.endedAt
      || frame.key !== routeRef.current.map((venue) => venue.id).join(">")) return;
    fitRoute("automatic");
  }, [fitRoute, gestureCameraRef, routeRef]);

  // Fit the active city's bounds (not a city switcher — CitySwitcher owns that).
  const fitCityBounds = useCallback(() => {
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const view = cityViewRef.current;
    // M3: fit-London / city-switch is a "long jump" — fitBounds animates via
    // flyTo by default (linear defaults to false), so `curve` shapes its arc.
    scheduleCamera("user", "city", `city:${cityBoundsRef.current.flat().join(",")}`, (map) => map.fitBounds(cityBoundsRef.current, {
      padding: isPhone
        ? { top: 184, right: 24, bottom: 190, left: 24 }
        : 90,
      maxZoom: 11,
      duration: reducedRef.current ? 0 : 800,
      curve: reducedRef.current ? undefined : LONG_JUMP_CURVE,
      pitch: view.pitch,
      bearing: view.bearing,
    }));
  }, [cityBoundsRef, cityViewRef, reducedRef, scheduleCamera]);

  // Borough browse arrival: frame the filtered venue set once (query owns the
  // camera). Skip if the user already tapped a pin — don't fight selectedVenue
  // fly-to. Padding mirrors fitRoute; maxZoom ~13 keeps outer boroughs readable.
  const fitQueryVenues = useCallback((kind: "query" | "search-recovery" = "query", requestToken = kind === "search-recovery" ? nextCameraRequestToken() : 0) => {
    const owner = kind === "search-recovery" ? "user" : "automatic";
    if (!claimCamera(owner, requestToken)) return;
    const current = (queryVenuesRef ?? venuesRef).current;
    if (current.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera(owner, kind, `${kind}:${requestToken}:${current.map((venue) => venue.id).join(">")}`, (map) => map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 13,
      duration: reducedRef.current ? 0 : 800,
      // Same flattening trap as fitRoute: keep the current rotation.
      bearing: map.getBearing(),
    }), requestToken);
  }, [claimCamera, queryVenuesRef, reducedRef, scheduleCamera, venuesRef]);

  // A voice answer's picks (lib/palMapCommands.ts). The person asked for these
  // pubs in this call, so the map frames them, but the answer lands seconds
  // after the ask: `pal` is a reactive intent, and a reader still reading the
  // map keeps it (lib/mapGestureGuard.ts). A move the person asked for by name
  // or number (`asked`) is `pal-ask`: only a finger on the glass holds it.
  const fitPalPicks = useCallback((sequence: number, points: readonly { lng: number; lat: number }[], asked = false) => {
    if (!claimCamera("pal")) return;
    palFrameRef.current = null;
    const kind = asked ? "pal-ask" : "pal";
    if (!points.length || cameraIntentBlocked(kind, gestureCameraRef.current, performance.now())) return;
    const key = `pal:${sequence}`;
    palFrameRef.current = { key, gestureEndedAt: gestureCameraRef.current.endedAt };
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((point) => bounds.extend([point.lng, point.lat]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera("pal", kind, key, (map) => map.fitBounds(bounds, {
      padding: routeFitPadding(map, isPhone, false),
      maxZoom: 16,
      duration: reducedRef.current ? 0 : 800,
      bearing: map.getBearing(),
    }));
  }, [claimCamera, gestureCameraRef, reducedRef, scheduleCamera]);

  // Near me puts the READER on the map, not a cloud of pubs. A fitBounds over
  // nearby venues centres the cloud, which drops the reader wherever the
  // geometry leaves them — on a phone, under the near-me sheet. `nearMeCameraFrame`
  // keeps the centre on the reader and lets only zoom and screen offset move.
  const fitNearby = useCallback(
    (location: { lat: number; lng: number }, nearbyVenues: Venue[], owner: CameraIntentOwner = "automatic", requestToken = owner === "user" ? nextCameraRequestToken() : 0) => {
      if (!claimCamera(owner, requestToken)) return;
      const map = mapRef.current;
      if (!map) return;
      const isPhone = window.matchMedia("(max-width: 640px)").matches;
      const container = map.getContainer().getBoundingClientRect();
      const viewport = { width: container.width, height: container.height };
      const reach = nearestVenueKm(location, nearbyVenues);
      const venueKey = nearbyVenues.map((venue) => venue.id).join(">");
      const locationKey = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
      // One move, aimed at the band the reader actually ends up with. See
      // whenBottomSheetSettles for why this waits rather than aiming twice.
      sheetWaitsRef.current += 1;
      const requestVersion = userRequestRef.current;
      if (owner === "user") pendingOwnerRef.current = owner;
      whenBottomSheetSettles(container.top, (coverTop) => {
        sheetWaitsRef.current -= 1;
        if (requestVersion !== userRequestRef.current) return;
        const band = mapVisibleBand({
          height: viewport.height,
          topInset: isPhone
            ? measureTopChromeBottom(container.top, PHONE_TOP_INSET)
            : DESKTOP_TOP_INSET,
          coverTop,
          bottomInset: isPhone ? PHONE_BOTTOM_INSET : DESKTOP_BOTTOM_INSET,
        });
        const frame = nearMeCameraFrame({ location, nearestVenueKm: reach, viewport, band });
        scheduleCamera(owner, "nearby", `nearby:${locationKey}:${band.bottom}:${venueKey}`, (target) => target.easeTo({
          center: frame.center,
          zoom: frame.zoom,
          offset: frame.offset,
          // The move has one job: carry the reader's eye from the city to their
          // own street. Ease-out starts fast, so the arrival reads as an answer
          // rather than a slow pan. Reduced motion takes the same frame in one
          // instant jump, which is why there is only ever one move to take.
          duration: reducedRef.current ? 0 : NEAR_ME_CAMERA_DURATION_MS,
          easing: easeOutCubic,
          pitch: isPhone ? 28 : 34,
          // Keep the current rotation (a fit would zero it otherwise).
          bearing: target.getBearing(),
        }), requestToken);
      });
    },
    [claimCamera, mapRef, reducedRef, scheduleCamera],
  );

  return {
    cinematic,
    cameraLanePending,
    easeArrivalBearing,
    fitRoute,
    fitOwnedRoute,
    fitCityBounds,
    fitQueryVenues,
    fitNearby,
    fitPalPicks,
  };
}

import {
  isNightAreaRouteReady,
  NIGHT_AREAS,
  nearestRouteReadyNightArea,
  tryGetNightArea,
  type NightArea,
} from "@/lib/nightAreas";
import { rememberedPatchId, type NightPatchId, type RememberedArea } from "@/lib/nightPatches";
import { nightAreaForPlanIntakePatch } from "@/lib/planIntake";
import type { NearMeLocationFailure } from "@/lib/nearMeLocation";

/**
 * ONE TAP TO A ROUTE. Most people who open /plan leave without typing, so the
 * empty page offers one tap that plans tonight in a crawl-ready area: the one
 * this device last chose when it maps to one, otherwise the one the reader is
 * standing in, asked for only when they tap. The tap submits a plain sentence
 * through the same path as typing, so it can never plan something a typed
 * description could not, and an area the app calls not crawl-ready is never
 * offered.
 */

/** How far from a crawl-ready area's centre still reads as "near me". */
const ONE_TAP_NEAR_KM = 3;

const LONDON = "london";

function distanceKm(area: NightArea, lat: number, lng: number): number {
  // The same flat-earth estimate nearestRouteReadyNightArea sorts by.
  return Math.hypot((area.centre.lat - lat) * 111, (area.centre.lng - lng) * 70);
}

/** The crawl-ready area this device last chose, or null when it chose none or a borough. */
export function rememberedOneTapArea(remembered: RememberedArea | null, now = new Date()): NightArea | null {
  const patchId = rememberedPatchId(remembered);
  if (!patchId) return null;
  // readRememberedArea only ever answers a patch id resolveNightPatch knows.
  const area = tryGetNightArea(nightAreaForPlanIntakePatch(patchId as NightPatchId));
  return area && area.cityId === LONDON && isNightAreaRouteReady(area, now) ? area : null;
}

/** The crawl-ready area the reader is standing in, or null when none is near. */
export function locatedOneTapArea(lat: number, lng: number, now = new Date()): NightArea | null {
  const area = nearestRouteReadyNightArea(LONDON, [lng, lat], now);
  return area && distanceKm(area, lat, lng) <= ONE_TAP_NEAR_KM ? area : null;
}

/** The sentence the tap submits, read back by the same parser as typed text. */
export function oneTapQuery(area: NightArea): string {
  return `${area.name} tonight`;
}

/** The label on the tap: the remembered area by name, otherwise near me. */
export function oneTapLabel(area: NightArea | null): string {
  return area ? `Tonight in ${area.name}` : "Tonight near me";
}

function readyAreaList(now: Date): string {
  const names = NIGHT_AREAS
    .filter((area) => area.cityId === LONDON && isNightAreaRouteReady(area, now))
    .map((area) => area.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** What the page says when the tap cannot plan, and how to go on by typing. */
export function oneTapMessage(
  reason: NearMeLocationFailure | "out-of-range",
  now = new Date(),
): string {
  const areas = readyAreaList(now);
  const tryTyping = areas ? ` Type one of ${areas}.` : " Type an area instead.";
  switch (reason) {
    case "out-of-range":
      return `No crawl-ready area near you yet.${tryTyping}`;
    case "denied":
      return `Location access was denied.${tryTyping}`;
    case "timeout":
      return `We could not get your location in time.${tryTyping}`;
    case "unsupported":
      return `This browser cannot share your location.${tryTyping}`;
    default:
      return `We could not find your location.${tryTyping}`;
  }
}

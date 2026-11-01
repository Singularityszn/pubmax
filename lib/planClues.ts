import { landmarks, type Landmark } from "@/lib/landmarks";
import { isValidLngLat, type LngLat, type WalkLeg } from "@/lib/walkRoute";

export type PlanClueDefinition = {
  landmarkId: string;
  question: string;
  fact: string;
  source: { label: string; url: string };
  reviewedAt: string;
};

// Only facts already held by the curated landmark records belong here.
// The linked primary pages were read on the review date. A failed page stays out.
export const PLAN_CLUE_CATALOGUE: readonly PlanClueDefinition[] = [
  {
    landmarkId: "big-ben",
    question: "A famous nickname belongs to a great bell inside a clock tower. What is the nickname?",
    fact: "Big Ben is the nickname of the Great Bell inside the Elizabeth Tower.",
    source: { label: "UK Parliament", url: "https://www.parliament.uk/about/living-heritage/building/palace/big-ben/facts-figures/" },
    reviewedAt: "2026-10-31",
  },
  {
    landmarkId: "westminster-abbey",
    question: "Which nearby church hosted William the Conqueror's coronation in 1066?",
    fact: "William the Conqueror was crowned at Westminster Abbey in 1066.",
    source: { label: "Westminster Abbey", url: "https://www.westminster-abbey.org/history/history-of-westminster-abbey" },
    reviewedAt: "2026-10-31",
  },
  {
    landmarkId: "tower-bridge",
    question: "Which nearby river crossing opened in 1894 and lifts its roadway for river traffic?",
    fact: "Tower Bridge opened in 1894. Its bascules lift to let river traffic through.",
    source: { label: "Tower Bridge", url: "https://www.towerbridge.org.uk/stories/history" },
    reviewedAt: "2026-10-31",
  },
  {
    landmarkId: "tower-of-london",
    question: "Which nearby fortress was founded by William the Conqueror after 1066?",
    fact: "William the Conqueror founded the Tower of London after 1066.",
    source: { label: "Historic Royal Palaces", url: "https://www.hrp.org.uk/tower-of-london/history-and-stories/the-story-of-the-tower-of-london/" },
    reviewedAt: "2026-10-31",
  },
  {
    landmarkId: "monument",
    question: "Which nearby column commemorates the Great Fire of London in 1666?",
    fact: "The Monument commemorates the Great Fire of London of 1666.",
    source: { label: "OneCity", url: "https://onecitylondon.com/directory/the-monument/" },
    reviewedAt: "2026-10-31",
  },
  {
    landmarkId: "buckingham-palace",
    question: "Which nearby palace became Queen Victoria's royal London residence in 1837?",
    fact: "Queen Victoria made Buckingham Palace her royal London residence in 1837.",
    source: { label: "Royal Collection Trust", url: "https://www.rct.uk/visit/buckingham-palace" },
    reviewedAt: "2026-10-31",
  },
];

/** A geometric proximity limit, never a detour distance or an access promise. */
const PLAN_CLUE_MAX_PATH_DISTANCE_METRES = 80;
const MAX_PLAN_CLUES = 3;

export type PlanClue = PlanClueDefinition & {
  id: string;
  answer: string;
  fromVenueId: string;
  toVenueId: string;
  fromIndex: number;
  toIndex: number;
};

export type PlanClueScope = {
  planId: string;
  memberId: string;
  accountId: string | null;
  revision: string | number;
};

/** React uses this key to discard page-only progress at every ownership boundary. */
export function planClueScopeKey(scope: PlanClueScope, stopIds: readonly string[]): string {
  return JSON.stringify([scope.planId, scope.memberId, scope.accountId, scope.revision, stopIds]);
}

function safeSource(source: PlanClueDefinition["source"]): boolean {
  if (!source.label.trim()) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

// Local projection is adequate for short London walking segments. It measures
// proximity only. It cannot establish a safe crossing, entrance or visibility.
function distanceToSegmentMetres(point: LngLat, from: LngLat, to: LngLat): number {
  const latitude = point[1] * Math.PI / 180;
  const xScale = 111_320 * Math.cos(latitude);
  const yScale = 111_320;
  const ax = (from[0] - point[0]) * xScale;
  const ay = (from[1] - point[1]) * yScale;
  const bx = (to[0] - point[0]) * xScale;
  const by = (to[1] - point[1]) * yScale;
  const dx = bx - ax;
  const dy = by - ay;
  const square = dx * dx + dy * dy;
  const fraction = square === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / square));
  return Math.hypot(ax + fraction * dx, ay + fraction * dy);
}

function nearPath(point: LngLat, coordinates: readonly LngLat[]): boolean {
  return coordinates.slice(1).some((to, index) => {
    const from = coordinates[index];
    return from !== undefined && distanceToSegmentMetres(point, from, to) <= PLAN_CLUE_MAX_PATH_DISTANCE_METRES;
  });
}

/** Only explicitly reviewed landmarks beside genuine routed legs can become clues. */
export function selectPlanClues(
  stopIds: readonly string[],
  legs: readonly WalkLeg[],
  availableLandmarks: readonly Landmark[] = landmarks,
  catalogue: readonly PlanClueDefinition[] = PLAN_CLUE_CATALOGUE,
): PlanClue[] {
  const selected: PlanClue[] = [];
  const used = new Set<string>();
  for (const leg of [...legs].sort((a, b) => a.fromIndex - b.fromIndex)) {
    const fromVenueId = stopIds[leg.fromIndex];
    const toVenueId = stopIds[leg.toIndex];
    if (leg.source !== "ors" || leg.toIndex !== leg.fromIndex + 1 || !fromVenueId || !toVenueId) continue;
    if (leg.coordinates.length < 2 || !leg.coordinates.every(isValidLngLat)) continue;
    for (const definition of catalogue) {
      if (used.has(definition.landmarkId) || !safeSource(definition.source)) continue;
      const landmark = availableLandmarks.find((entry) => entry.id === definition.landmarkId);
      if (!landmark || !isValidLngLat(landmark.coordinates) || !landmark.history.trim()) continue;
      if (!nearPath(landmark.coordinates, leg.coordinates)) continue;
      selected.push({ ...definition, id: `${leg.fromIndex}:${definition.landmarkId}`, answer: landmark.name,
        fromVenueId, toVenueId, fromIndex: leg.fromIndex, toIndex: leg.toIndex });
      used.add(landmark.id);
      if (selected.length >= MAX_PLAN_CLUES) return selected;
      // One optional clue per leg leaves the walk as the main activity.
      break;
    }
  }
  return selected;
}

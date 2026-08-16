import { evaluateOpenState, type WeeklyOpeningHours } from "@/lib/busyness";
import { haversineKm } from "@/lib/haversine";
import {
  walkMinutesFromKm,
  WALKABLE_RADIUS_KM,
  WIDENED_RADIUS_KM,
  type NearMeScope,
} from "@/lib/nearMeAnswer";
import { provenanceLabel } from "@/lib/tonight";
import { venueKindLabel } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

export const NEAR_MODES = ["pint", "desk"] as const;
export type NearMode = (typeof NEAR_MODES)[number];

export const NEAR_MODE_STORAGE_KEY = "pubmax:near-mode:v1";
export const NEAR_MODE_QUERY = "mode";

/** Desk-mode kinds. A pub joins only when OSM states wifi. */
export const DESK_MODE_KINDS = [
  "cafe",
  "coworking",
  "library",
  "hotel_lounge",
] as const satisfies readonly VenueKind[];

export const DESK_MAX_ANSWERS = 5;

/**
 * The walkable ring a desk card is bucketed into before anything else is
 * compared. 0.4 km is about a five minute walk at the pint lane's pace.
 *
 * Distance is the FIRST rank key, the same anonymous locality basis pint mode
 * answers from. Amenity richness USED TO be ordered ahead of it, which put a
 * wifi-tagged cafe a kilometre away above an untagged one sixty metres from
 * the reader, and most London cafes carry no `internet_access` tag at all. The
 * bucket is what makes the later keys decide anything: raw metres would settle
 * every pair before amenity or open-now was ever read.
 */
export const DESK_DISTANCE_RING_KM = 0.4;

/** Which walkable ring a distance sits in. Lower is nearer. */
export function deskDistanceRing(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return 0;
  return Math.floor(km / DESK_DISTANCE_RING_KM);
}

export type WifiState = "yes" | "no" | "unknown";
export type LaptopState = "allowed" | "unknown";

export type DeskPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: VenueKind;
  wifi: WifiState;
  laptop: LaptopState;
  openingHours: WeeklyOpeningHours | null;
  hoursRaw?: string | null;
  address?: string;
};

export type DeskCard = {
  id: string;
  name: string;
  kind: VenueKind;
  kindLabel: string;
  address: string;
  distanceKm?: number;
  walkMinutes?: number;
  wifi: WifiState;
  laptop: LaptopState;
  openNow: boolean | "unknown";
  wifiCaption: string;
  laptopCaption: string;
  hoursCaption: string;
  seatDataLine: string;
  checkedCaption: string;
  source: "osm";
};

export type DeskAnswer = {
  hero: DeskCard | null;
  cards: DeskCard[];
  scope: NearMeScope;
  radiusKm: number;
};

export type RankDeskOptions = {
  now?: Date;
  observedAt?: string | null;
  walkableRadiusKm?: number;
  widenedRadiusKm?: number;
  maxAnswers?: number;
};

const DAY_TOKEN = /^(Mo|Tu|We|Th|Fr|Sa|Su)$/;
const DAY_INDEX: Record<string, number> = {
  Su: 0,
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6,
};

export function parseNearModeParam(raw: string | null | undefined): NearMode | null {
  if (raw === "pint" || raw === "desk") return raw;
  return null;
}

export function resolveNearMode(
  param: string | null | undefined,
  remembered: string | null | undefined,
): NearMode {
  return parseNearModeParam(param)
    ?? parseNearModeParam(remembered)
    ?? "pint";
}

/**
 * Whether tapping `next` is a SWITCH. Tapping the live pill, or an arrow key
 * that lands back on it, moves nobody, so it may not spend a URL write or
 * count as a `near_mode_switched`.
 */
export function shouldSwitchNearMode(current: NearMode, next: NearMode): boolean {
  return current !== next;
}

/**
 * The query a desk answer writes when it lands on an area.
 *
 * It carries `mode=desk` itself rather than trusting the search string it was
 * handed. The mode switch commits its own navigation asynchronously, so a
 * patch write composed from the live URL could land first and publish a link
 * that opens in pint mode.
 */
export function deskPatchQuery(search: string, patchId: string): string {
  const params = new URLSearchParams(search);
  params.set(NEAR_MODE_QUERY, "desk");
  params.set("patch", patchId);
  return params.toString();
}

export function wifiFromOsm(value: string | null | undefined): WifiState {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (token === "yes" || token === "wlan" || token === "wired" || token === "terminal") {
    return "yes";
  }
  if (token === "no") return "no";
  return "unknown";
}

export function laptopFromOsm(
  laptop: string | null | undefined,
  laptopFriendly: string | null | undefined,
): LaptopState {
  const values = [laptop, laptopFriendly]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());
  return values.includes("yes") ? "allowed" : "unknown";
}

export function isDeskEligible(input: { kind: VenueKind; wifi: WifiState }): boolean {
  if ((DESK_MODE_KINDS as readonly VenueKind[]).includes(input.kind)) return true;
  return input.kind === "pub" && input.wifi === "yes";
}

export function deskWifiCaption(wifi: WifiState): string {
  return `Wifi: ${wifi}`;
}

export function deskLaptopCaption(laptop: LaptopState): string {
  return laptop === "allowed" ? "Laptops: allowed" : "Laptops: not known";
}

export function deskHoursCaption(raw: string | null | undefined): string {
  const hours = typeof raw === "string" ? raw.trim() : "";
  return hours ? `Hours: ${hours}` : "Hours: unknown";
}

export function deskSeatDataLine(): string {
  return "No seat data yet";
}

export function deskEmptyLine(): string {
  return "No desks logged near here yet - add a spot";
}

export function deskLoadFailedLine(): string {
  return "Could not check desks near here.";
}

/** Why a desk answer is about an area rather than about the reader. */
export type DeskPatchReason = "denied" | "unavailable";

/**
 * The one line that says why an area answered instead of the reader's own
 * position, or nothing when nothing is owed.
 *
 * A reason with no area names nothing, and a chosen area with no reason owes
 * no explanation: the drinker picked it. Both are `null` rather than a
 * sentence, because a stale "Location's off" over a located answer is a claim
 * about the device that stopped being true.
 */
export function deskPatchReasonLine(
  areaLabel: string | null | undefined,
  reason: DeskPatchReason | null,
): string | null {
  const label = typeof areaLabel === "string" ? areaLabel.trim() : "";
  if (!label || !reason) return null;
  return reason === "denied"
    ? `Location's off, so here's ${label}.`
    : `No location on this device, so here's ${label}.`;
}

export function deskCheckedCaption(observedAt: string | null | undefined): string {
  return provenanceLabel(observedAt);
}

/**
 * The heading over an answer that HAS a hero. An empty locality is the other
 * lane and prints `deskEmptyLine()`, so `"none"` is not a scope this sentence
 * is ever asked about.
 */
export function deskAnswerHeadline(input: {
  scope: Exclude<NearMeScope, "none">;
  patchLabel?: string | null;
}): string {
  const place = input.patchLabel ?? null;
  if (place) return `Somewhere to sit around ${place}`;
  return input.scope === "widened"
    ? "Nearest desks a bit further out"
    : "Somewhere to sit near you";
}

export function deskKindLabel(kind: VenueKind): string {
  return kind === "pub" ? "Pub with wifi" : venueKindLabel(kind);
}

function expandDayToken(token: string): number[] {
  const range = token.split("-");
  if (range.length === 2 && DAY_TOKEN.test(range[0]) && DAY_TOKEN.test(range[1])) {
    const start = DAY_INDEX[range[0]];
    const end = DAY_INDEX[range[1]];
    if (start === undefined || end === undefined) return [];
    const days: number[] = [];
    let day = start;
    for (let i = 0; i < 7; i += 1) {
      days.push(day);
      if (day === end) break;
      day = (day + 1) % 7;
    }
    return days;
  }
  if (DAY_TOKEN.test(token)) {
    const day = DAY_INDEX[token];
    return day === undefined ? [] : [day];
  }
  return [];
}

function parseDayList(raw: string): number[] {
  const days = new Set<number>();
  for (const token of raw.split(/\s*,\s*/)) {
    for (const day of expandDayToken(token.trim())) days.add(day);
  }
  return [...days];
}

function parseTimeWindows(raw: string): { opens: string; closes: string }[] {
  const windows: { opens: string; closes: string }[] = [];
  for (const part of raw.split(/\s*,\s*/)) {
    const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}|24:00)$/.exec(part.trim());
    if (!match) return [];
    windows.push({
      opens: match[1].padStart(5, "0"),
      closes: match[2] === "24:00" ? "24:00" : match[2].padStart(5, "0"),
    });
  }
  return windows;
}

function splitHourRules(input: string): string[] {
  const rules: string[] = [];
  for (const semi of input.split(/\s*;\s*/)) {
    const chunk = semi.trim();
    if (!chunk) continue;
    let buffer = "";
    for (const piece of chunk.split(/\s*,\s*/)) {
      if (!buffer) {
        buffer = piece;
        continue;
      }
      const bufferHasTime = /\d{1,2}:\d{2}/.test(buffer);
      const pieceHasDay = /^(Mo|Tu|We|Th|Fr|Sa|Su|PH|24\/7)\b/.test(piece);
      if (bufferHasTime && pieceHasDay) {
        rules.push(buffer);
        buffer = piece;
      } else {
        buffer += `, ${piece}`;
      }
    }
    if (buffer) rules.push(buffer);
  }
  return rules;
}

function applyWindows(
  hours: WeeklyOpeningHours,
  days: number[],
  windows: { opens: string; closes: string }[],
): void {
  for (const day of days) {
    hours[day] = [...(hours[day] ?? []), ...windows];
  }
}

/**
 * A conservative OSM opening_hours reader. Common day ranges and clock
 * windows become weekly hours. Anything else stays unknown rather than a
 * guessed door.
 *
 * A day no rule mentions is CLOSED in OSM, not unknown, so a parsed string
 * fills its silent days with an empty window list. Leaving them absent made
 * `evaluateOpenState` answer "unknown" for a weekday-only cafe on a Sunday,
 * which ranked it above a venue that had stated `Su off`.
 */
export function parseOsmOpeningHours(
  raw: string | null | undefined,
): WeeklyOpeningHours | null {
  if (typeof raw !== "string") return null;
  const source = raw.trim();
  if (!source) return null;
  if (/^24\/7$/i.test(source)) {
    const hours: WeeklyOpeningHours = {};
    for (let day = 0; day < 7; day += 1) {
      hours[day] = [{ opens: "00:00", closes: "24:00" }];
    }
    return hours;
  }

  const hours: WeeklyOpeningHours = {};
  let parsed = false;
  for (const rule of splitHourRules(source)) {
    if (/^24\/7$/i.test(rule)) {
      for (let day = 0; day < 7; day += 1) {
        hours[day] = [{ opens: "00:00", closes: "24:00" }];
      }
      parsed = true;
      continue;
    }
    const off = /^(.*?)\s+off$/i.exec(rule);
    if (off) {
      const days = parseDayList(off[1]);
      if (days.length === 0) return null;
      for (const day of days) hours[day] = [];
      parsed = true;
      continue;
    }
    const match = /^(.*?)\s+(\d{1,2}:\d{2}\s*-\s*(?:\d{1,2}:\d{2}|24:00)(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*(?:\d{1,2}:\d{2}|24:00))*)$/.exec(rule);
    if (!match) return null;
    const days = parseDayList(match[1]);
    const windows = parseTimeWindows(match[2]);
    if (days.length === 0 || windows.length === 0) return null;
    applyWindows(hours, days, windows);
    parsed = true;
  }
  if (!parsed) return null;
  for (let day = 0; day < 7; day += 1) {
    if (!hours[day]) hours[day] = [];
  }
  return hours;
}

function amenityScore(wifi: WifiState, laptop: LaptopState): number {
  return (wifi === "unknown" ? 0 : 2) + (laptop === "allowed" ? 1 : 0);
}

function openRank(state: boolean | "unknown"): number {
  if (state === true) return 0;
  if (state === "unknown") return 1;
  return 2;
}

function toCard(
  point: DeskPoint,
  km: number | undefined,
  now: Date,
  observedAt: string | null | undefined,
): DeskCard {
  const openNow = evaluateOpenState({
    now,
    timeZone: "Europe/London",
    openingHours: point.openingHours ?? undefined,
  });
  return {
    id: point.id,
    name: point.name,
    kind: point.kind,
    kindLabel: deskKindLabel(point.kind),
    address: point.address ?? "",
    ...(typeof km === "number"
      ? { distanceKm: km, walkMinutes: walkMinutesFromKm(km) }
      : {}),
    wifi: point.wifi,
    laptop: point.laptop,
    openNow,
    wifiCaption: deskWifiCaption(point.wifi),
    laptopCaption: deskLaptopCaption(point.laptop),
    hoursCaption: deskHoursCaption(point.hoursRaw),
    seatDataLine: deskSeatDataLine(),
    checkedCaption: deskCheckedCaption(observedAt),
    source: "osm",
  };
}

function byDeskRank(a: { card: DeskCard; km: number }, b: { card: DeskCard; km: number }): number {
  const ring = deskDistanceRing(a.km) - deskDistanceRing(b.km);
  if (ring !== 0) return ring;
  const amenity = amenityScore(b.card.wifi, b.card.laptop) - amenityScore(a.card.wifi, a.card.laptop);
  if (amenity !== 0) return amenity;
  const open = openRank(a.card.openNow) - openRank(b.card.openNow);
  if (open !== 0) return open;
  return a.km - b.km;
}

export function rankDeskNearMe(
  lat: number,
  lng: number,
  venues: DeskPoint[],
  options: RankDeskOptions = {},
): DeskAnswer {
  const now = options.now ?? new Date();
  const max = Math.max(1, Math.floor(options.maxAnswers ?? DESK_MAX_ANSWERS));
  const walkRadius = Math.max(0.1, options.walkableRadiusKm ?? WALKABLE_RADIUS_KM);
  const wideRadius = Math.max(walkRadius, options.widenedRadiusKm ?? WIDENED_RADIUS_KM);

  const measured = venues
    .filter((point) => (
      isDeskEligible(point)
      && Number.isFinite(point.lat)
      && Number.isFinite(point.lng)
    ))
    .map((point) => ({
      point,
      km: haversineKm([lng, lat], [point.lng, point.lat]),
    }))
    .sort((a, b) => a.km - b.km);

  const walkable = measured.filter((entry) => entry.km <= walkRadius);
  const pool = walkable.length > 0
    ? walkable
    : measured.filter((entry) => entry.km <= wideRadius);
  if (pool.length === 0) {
    return { hero: null, cards: [], scope: "none", radiusKm: wideRadius };
  }

  const ranked = pool
    .map((entry) => ({
      km: entry.km,
      card: toCard(entry.point, entry.km, now, options.observedAt),
    }))
    .sort(byDeskRank)
    .slice(0, max)
    .map((entry) => entry.card);

  return {
    hero: ranked[0] ?? null,
    cards: ranked,
    scope: walkable.length > 0 ? "walkable" : "widened",
    radiusKm: walkable.length > 0 ? walkRadius : wideRadius,
  };
}

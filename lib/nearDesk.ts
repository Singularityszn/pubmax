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
 * ONE clock for a desk card. The rank key (`openNow`) and the human hours line
 * are two readings of the same door, so they may not read two zones: a viewer
 * whose device sat west of London used to be told `Open until 22:00` about a
 * venue the same card had already ranked as shut. Every desk in the pack is in
 * London, so London is what both answer from unless a caller names one zone
 * for both.
 */
export const DESK_TIME_ZONE = "Europe/London";

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
  distanceKm?: number;
  walkMinutes?: number;
  wifi: WifiState;
  laptop: LaptopState;
  openNow: boolean | "unknown";
  amenityLines: string[];
  hoursCaption: string;
  hoursRaw: string | null;
  checkedCaption: string;
  source: "osm";
};

export type DeskAnswer = {
  hero: DeskCard | null;
  cards: DeskCard[];
  scope: NearMeScope;
  radiusKm: number;
  collapsedChains: string[];
};

export type RankDeskOptions = {
  now?: Date;
  timeZone?: string;
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

export function deskAmenityLines(wifi: WifiState, laptop: LaptopState): string[] {
  const lines: string[] = [];
  if (wifi !== "unknown") lines.push(deskWifiCaption(wifi));
  if (laptop === "allowed") lines.push(deskLaptopCaption(laptop));
  return lines.length > 0 ? lines : ["No amenity data yet"];
}

const WEEKDAY_TOKENS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function deskLocalClock(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value.toLowerCase() ?? "mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const weekday = WEEKDAY_TOKENS.findIndex((day) => weekdayName.startsWith(day));
  return { weekday: weekday < 0 ? 1 : weekday, minutes: hour * 60 + minute };
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatClockMinutes(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * The sentence for a window the reader is inside right now. `24:00` is not a
 * clock anybody reads, and the pack holds both shapes of it: a `24/7` row parses
 * to `00:00-24:00` every day, and seventy more rows close on midnight.
 */
function openWindowCaption(opens: number, adjustedClose: number): string {
  if (opens === 0 && adjustedClose === 24 * 60) return "Open all day";
  if (adjustedClose % (24 * 60) === 0) return "Open until midnight";
  return `Open until ${formatClockMinutes(adjustedClose)}`;
}

/**
 * One line for the desk card: open until, opens later today, closed today,
 * or hours unknown. Same clock as the card's own `openNow` rank key. Raw OSM
 * syntax stays off this line.
 */
export function deskHoursCaption(
  hours: WeeklyOpeningHours | null | undefined,
  now: Date = new Date(),
  timeZone: string = DESK_TIME_ZONE,
): string {
  if (!hours) return "Hours unknown";
  const zone = timeZone || DESK_TIME_ZONE;
  const clock = deskLocalClock(now, zone);
  const windows = hours[clock.weekday];
  if (!windows || windows.length === 0) return "Closed today";

  const open = evaluateOpenState({ now, timeZone: zone, openingHours: hours });
  if (open === true) {
    for (const window of windows) {
      const opens = clockMinutes(window.opens);
      const closes = clockMinutes(window.closes);
      if (opens === null || closes === null) continue;
      const adjustedClose = closes <= opens ? closes + 24 * 60 : closes;
      const adjustedNow = clock.minutes < opens && adjustedClose >= 24 * 60
        ? clock.minutes + 24 * 60
        : clock.minutes;
      if (adjustedNow >= opens && adjustedNow < adjustedClose) {
        return openWindowCaption(opens, adjustedClose);
      }
    }
  }

  const laterOpen = windows
    .map((window) => clockMinutes(window.opens))
    .filter((opens): opens is number => opens !== null && opens > clock.minutes)
    .sort((a, b) => a - b)[0];
  return laterOpen === undefined ? "Closed today" : `Opens ${formatClockMinutes(laterOpen)}`;
}

const CHAIN_SUFFIX_TOKENS = new Set([
  "express",
  "coffee",
  "bakery",
  "cafe",
  "shop",
  "store",
  "bar",
  "kiosk",
  "branch",
  "reserve",
  "street",
  "st",
  "road",
  "rd",
  "lane",
  "ln",
  "avenue",
  "ave",
  "square",
  "sq",
  "place",
  "pl",
  "court",
  "ct",
  "terrace",
  "ter",
  "walk",
  "row",
  "hill",
  "gate",
  "mews",
  "yard",
  "wharf",
  "quay",
  "park",
  "green",
  "circus",
]);

const CHAIN_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["caffe nero", "caffe nero"],
  ["cafe nero", "caffe nero"],
  ["nero", "caffe nero"],
  ["pret a manger", "pret"],
  ["pret", "pret"],
  ["costa", "costa"],
  ["starbucks", "starbucks"],
  ["gails", "gails"],
  ["black sheep", "black sheep"],
  ["wework", "wework"],
];

/**
 * One deterministic key per chain. Accents and punctuation fall away, then
 * branch and street tokens, then a closed alias table. Independents keep
 * their own folded name, so two different cafes never share a key.
 */
export function deskChainKey(name: string): string {
  const folded = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "");
  const words = folded.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  while (
    words.length > 1
    && (CHAIN_SUFFIX_TOKENS.has(words[words.length - 1] ?? "")
      || /^\d+$/.test(words[words.length - 1] ?? ""))
  ) {
    words.pop();
  }
  const key = words.join(" ");
  for (const [prefix, alias] of CHAIN_ALIASES) {
    if (key === prefix || key.startsWith(`${prefix} `)) return alias;
  }
  return key;
}

export function deskSeatDataLine(): string {
  return "No seat data yet";
}

export const DESK_COLLAPSED_CHAINS_ATTRIBUTE = "data-desk-collapsed-chains";

/**
 * The development-only attribute naming which chains a diverse answer put
 * aside. Nothing ships to a reader: production answers no attribute at all,
 * and neither does an answer that collapsed nothing.
 */
export function deskCollapsedChainsAttributes(
  collapsedChains: readonly string[] | null | undefined,
  env: string | undefined = process.env.NODE_ENV,
): Record<string, string> {
  if (env !== "development") return {};
  if (!collapsedChains || collapsedChains.length === 0) return {};
  return { [DESK_COLLAPSED_CHAINS_ATTRIBUTE]: collapsedChains.join(",") };
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
    hours[day] = [...windows];
  }
}

/**
 * A conservative OSM opening_hours reader. Common day ranges and clock
 * windows become weekly hours. Anything else stays unknown rather than a
 * guessed door.
 *
 * Later rules OVERRIDE earlier ones for the same day. OSM writes
 * `Mo-Su 08:00-22:00; Su 10:00-18:00` to narrow Sunday, not to union both
 * windows. A day no rule mentions is CLOSED, not unknown.
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
  timeZone?: string,
): DeskCard {
  const zone = timeZone || DESK_TIME_ZONE;
  const openNow = evaluateOpenState({
    now,
    timeZone: zone,
    openingHours: point.openingHours ?? undefined,
  });
  return {
    id: point.id,
    name: point.name,
    kind: point.kind,
    kindLabel: deskKindLabel(point.kind),
    ...(typeof km === "number"
      ? { distanceKm: km, walkMinutes: walkMinutesFromKm(km) }
      : {}),
    wifi: point.wifi,
    laptop: point.laptop,
    openNow,
    amenityLines: deskAmenityLines(point.wifi, point.laptop),
    hoursCaption: deskHoursCaption(point.openingHours, now, zone),
    hoursRaw: point.hoursRaw ?? null,
    checkedCaption: deskCheckedCaption(observedAt),
    source: "osm",
  };
}

function pickDiverseDeskCards(
  ranked: { card: DeskCard; km: number }[],
  max: number,
): { cards: DeskCard[]; collapsedChains: string[] } {
  const first: { card: DeskCard; km: number }[] = [];
  const extras: { card: DeskCard; km: number }[] = [];
  const seen = new Set<string>();
  const extraKeys = new Set<string>();
  for (const entry of ranked) {
    const key = deskChainKey(entry.card.name);
    if (!seen.has(key)) {
      seen.add(key);
      first.push(entry);
    } else {
      extraKeys.add(key);
      extras.push(entry);
    }
  }
  const picked = first.slice(0, max);
  if (picked.length < max) {
    for (const entry of extras) {
      picked.push(entry);
      if (picked.length >= max) break;
    }
  }
  const shown = new Set(picked.map((entry) => entry.card.id));
  const collapsedChains = [...extraKeys]
    .filter((key) => ranked.some((entry) => (
      deskChainKey(entry.card.name) === key && !shown.has(entry.card.id)
    )))
    .sort();
  return {
    cards: picked.map((entry) => entry.card),
    collapsedChains,
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
    return { hero: null, cards: [], scope: "none", radiusKm: wideRadius, collapsedChains: [] };
  }

  const ranked = pool
    .map((entry) => ({
      km: entry.km,
      card: toCard(entry.point, entry.km, now, options.observedAt, options.timeZone),
    }))
    .sort(byDeskRank);
  const { cards, collapsedChains } = pickDiverseDeskCards(ranked, max);

  return {
    hero: cards[0] ?? null,
    cards,
    scope: walkable.length > 0 ? "walkable" : "widened",
    radiusKm: walkable.length > 0 ? walkRadius : wideRadius,
    collapsedChains,
  };
}

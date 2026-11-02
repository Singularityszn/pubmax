// Pal hops (wild idea 08): the pure half. Which painted pins the robin visits,
// in what order, how a hop moves, where it lands and what it says.
//
// Nothing here touches the map, the DOM or the network, so the order of the
// hops, the landing spot and the bubble's words are tested on their own
// (__tests__/wildPalHop.test.ts). PalHop.tsx feeds it the map's own answers:
// the painted-pin probe (components/map/canvas/paintedPinProbe.ts) for where
// each pin is drawn, and the city's slim pack for what each one costs.

import { compassPriceLabel } from "@/lib/pintCompass";
import type { NightArea } from "@/lib/nightAreas";
import type { SlimVenue } from "@/lib/venuesSlim";

/** A pin the map is painting now, in viewport pixels (the probe's own shape). */
export type PalHopPoint = {
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
  lng: number;
  lat: number;
};

/** A pub in view with the pint price its slim row lists, where it is drawn now. */
export type PalHopStop = {
  id: string;
  name: string;
  /** Where the map draws the pub right now, in viewport pixels. */
  x: number;
  y: number;
  lng: number;
  lat: number;
  priceGbp: number;
  priceSource: string | null;
  priceObservedAt: string | null;
  /**
   * True when the map's own card shows a figure people logged since the
   * listing (a community price): the figure is theirs, so no publisher is
   * claimed for it. `priceSource` and `priceObservedAt` still describe the
   * LISTED figure it replaced, so neither is shown beside it.
   */
  peopleLogged?: boolean;
};

/**
 * The painted mark the robin perches on for a stop: the pub's own price pill,
 * or, while the pub is gathered into a cluster, that cluster's disc (which
 * reads "from" its cheapest price). `reach` is how far the mark extends above
 * its point, so the robin stands on top of it rather than over the figure.
 */
export type PalHopAnchor = { lng: number; lat: number; x: number; y: number; reach: number };

/** One landing: the pub and the mark the robin stands on. */
type PalHopLeg = { stop: PalHopStop; anchor: PalHopAnchor };

/** The robin's route: dearer pints first, the cheapest last. */
export type PalHopRoute = {
  legs: PalHopLeg[];
  winner: PalHopLeg;
};

/** At most this many hops, the last one onto the cheapest. */
export const PAL_HOP_MAX_HOPS = 4;
/** Two landings closer than this read as one, so the second is skipped. */
const MIN_HOP_GAP_PX = 40;
/** A pub drawn this close to a cluster's centre is taken to be inside it. */
const CLUSTER_REACH_PX = 48;
const PILL_REACH_PX = 15;
const CLUSTER_DISC_REACH_PX = 26;
const DOT_REACH_PX = 6;

/**
 * A slim row is a pint price the robin may speak about when its figure has
 * pint semantics (a pub, or a legacy OpenStreetMap bar, the same test as
 * `hasPintPriceSemantics` in lib/venues.ts, restated so this leaf does not
 * pull the venue library in), carries a figure, and is not a named non-pub
 * anchor (a set lunch or a dish), whose figure is not a pint.
 */
export function slimRowPintPrice(row: SlimVenue): number | null {
  const pintSemantics =
    row.kind === undefined || row.kind === "pub" || (row.kind === "bar" && row.legacyOsmBar === true);
  if (!pintSemantics) return null;
  if (row.anchorLabel) return null;
  const price = row.cheapestPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

/** The part of the screen the map shows, clear of its top bar. */
export type ScreenRegion = { left: number; top: number; right: number; bottom: number };

/**
 * The priced pubs the reader can see: every slim row with a pint price whose
 * drawn position (`project`, the camera probe's own projection) falls inside
 * the map's region. A pub gathered into a cluster still counts, as it does
 * for the map's own "Cheapest in this view" card (lib/mapPeek.ts).
 */
export function stopsInView(
  rows: Iterable<SlimVenue>,
  project: (lngLat: [number, number]) => ScreenPoint | null,
  region: ScreenRegion,
): PalHopStop[] {
  const stops: PalHopStop[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const priceGbp = slimRowPintPrice(row);
    if (priceGbp === null || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
    const at = project([row.lng, row.lat]);
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    if (at.x < region.left || at.x > region.right || at.y < region.top || at.y > region.bottom) continue;
    seen.add(row.id);
    stops.push({
      id: row.id,
      name: row.name,
      x: at.x,
      y: at.y,
      lng: row.lng,
      lat: row.lat,
      priceGbp,
      priceSource: row.priceSource?.trim() || null,
      priceObservedAt: row.priceObservedAt ?? null,
    });
  }
  return stops;
}

/**
 * The mark a stop is painted as: its own pin when the map paints one (same
 * id), else the nearest cluster disc it is gathered into, else its own spot.
 */
export function palHopAnchor(stop: PalHopStop, marks: readonly PalHopPoint[]): PalHopAnchor {
  const own = marks.find((mark) => mark.kind === "pin" && mark.id === stop.id);
  if (own) return { lng: own.lng, lat: own.lat, x: own.x, y: own.y, reach: PILL_REACH_PX };
  let best: PalHopPoint | null = null;
  let bestDistance = CLUSTER_REACH_PX;
  for (const mark of marks) {
    if (mark.kind !== "cluster") continue;
    const distance = Math.hypot(mark.x - stop.x, mark.y - stop.y);
    if (distance <= bestDistance) {
      best = mark;
      bestDistance = distance;
    }
  }
  if (best) return { lng: best.lng, lat: best.lat, x: best.x, y: best.y, reach: CLUSTER_DISC_REACH_PX };
  return { lng: stop.lng, lat: stop.lat, x: stop.x, y: stop.y, reach: DOT_REACH_PX };
}

function cheaperFirst(a: PalHopStop, b: PalHopStop): number {
  return a.priceGbp - b.priceGbp || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * The route. The winner is the cheapest priced pub in view (a tie goes to the
 * name, then the id), or `winnerId` when the map's own bottom card has
 * already named it, so the robin and the card never disagree. Before it the
 * robin visits up to three DEARER pints, preferring pubs the map paints as
 * their own pins, spread across the price range and visited dearest first, so
 * every hop lands on a dearer pint than the winner and the walk reads as
 * prices falling. A pub at the winner's own price is never a stop, and no two
 * landings share a mark.
 */
export function palHopRoute(
  stops: readonly PalHopStop[],
  marks: readonly PalHopPoint[],
  options: { winnerId?: string | null; maxHops?: number } = {},
): PalHopRoute | null {
  if (stops.length === 0) return null;
  const maxHops = options.maxHops ?? PAL_HOP_MAX_HOPS;
  const sorted = [...stops].sort(cheaperFirst);
  const named = options.winnerId ? sorted.find((stop) => stop.id === options.winnerId) : undefined;
  const winnerStop = named ?? sorted[0]!;
  const winner = { stop: winnerStop, anchor: palHopAnchor(winnerStop, marks) };
  const dearer = sorted
    .filter((stop) => stop.priceGbp > winnerStop.priceGbp)
    .map((stop) => ({ stop, anchor: palHopAnchor(stop, marks) }))
    .reverse();
  const pinned = dearer.filter((leg) => leg.anchor.reach === PILL_REACH_PX);
  const pool = pinned.length >= 2 ? pinned : dearer;
  const wanted = Math.max(0, Math.min(maxHops - 1, pool.length));
  const picked: PalHopLeg[] = [];
  const clear = (leg: PalHopLeg) =>
    [...picked, winner].every(
      (other) => Math.hypot(other.anchor.x - leg.anchor.x, other.anchor.y - leg.anchor.y) >= MIN_HOP_GAP_PX,
    );
  if (wanted > 0) {
    // Spread the picks across the dearer list (dearest, middle, nearly
    // cheapest) so the walk reads as prices falling, not a cluster of twins.
    const step = pool.length / wanted;
    for (let index = 0; index < wanted; index += 1) {
      const start = Math.floor(index * step);
      const end = Math.floor((index + 1) * step);
      const candidate = pool.slice(start, Math.max(start + 1, end)).find(clear);
      if (candidate) picked.push(candidate);
    }
  }
  return { legs: [...picked, winner], winner };
}

// --- one hop ----------------------------------------------------------------

/** The crouch before take-off. */
const PAL_HOP_CROUCH_MS = 110;
/** The squash on landing and the spring back. */
const PAL_HOP_LAND_MS = 200;
/** The pause on each pin before the next hop. */
export const PAL_HOP_PAUSE_MS = 220;

/** Flight time grows with the distance, inside a lively band. */
export function palHopFlightMs(distancePx: number): number {
  return Math.round(Math.min(640, Math.max(380, 300 + distancePx * 0.9)));
}

/** How high the arc rises for a hop this long. */
export function palHopArcPx(distancePx: number): number {
  return Math.min(120, Math.max(34, distancePx * 0.38));
}

/** One frame of a hop: where along the path, how high, and the body's squash. */
export type PalHopPose = {
  /** 0 at take-off, 1 on the landing spot. */
  along: number;
  /** 0 on the ground, 1 at the top of the arc. */
  lift: number;
  scaleX: number;
  scaleY: number;
  done: boolean;
};

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * The pose `elapsedMs` into a hop whose flight takes `flightMs`. The robin
 * crouches (squash), stretches as it leaves the ground, flattens on landing
 * and springs back with one small overshoot. The arc is a sine, so the top of
 * the hop is in the middle of the flight.
 */
export function palHopPose(elapsedMs: number, flightMs: number): PalHopPose {
  const t = Math.max(0, elapsedMs);
  if (t < PAL_HOP_CROUCH_MS) {
    const k = t / PAL_HOP_CROUCH_MS;
    return { along: 0, lift: 0, scaleX: 1 + 0.16 * k, scaleY: 1 - 0.18 * k, done: false };
  }
  const flight = t - PAL_HOP_CROUCH_MS;
  if (flight < flightMs) {
    const k = flight / flightMs;
    // Stretched tall through the air, rounder near the top.
    const stretch = Math.sin(Math.PI * Math.min(1, k * 1.6)) * 0.12;
    return {
      along: easeInOut(k),
      lift: Math.sin(Math.PI * k),
      scaleX: 1 - stretch * 0.8,
      scaleY: 1 + stretch,
      done: false,
    };
  }
  const land = flight - flightMs;
  if (land < PAL_HOP_LAND_MS) {
    const k = land / PAL_HOP_LAND_MS;
    // A squash that springs back through a small overshoot.
    const squash = Math.cos(k * Math.PI * 1.5) * (1 - k) * 0.2;
    return { along: 1, lift: 0, scaleX: 1 + squash, scaleY: 1 - squash, done: false };
  }
  return { along: 1, lift: 0, scaleX: 1, scaleY: 1, done: true };
}

/** The whole hop, crouch to settle. */
export function palHopTotalMs(flightMs: number): number {
  return PAL_HOP_CROUCH_MS + flightMs + PAL_HOP_LAND_MS;
}

// --- where it stands --------------------------------------------------------

export type ScreenPoint = { x: number; y: number };
export type ScreenBox = { width: number; height: number };

/** The robin, drawn this many CSS pixels across. */
export const PAL_HOP_ROBIN_PX = 52;
/** The top of the screen is the bar's; the robin stays under it. */
const SAFE_TOP_PX = 72;
const EDGE_PX = 10;

/**
 * Where the robin stands beside a mark: perched on top of the price pill (or
 * the cluster disc, whose `reach` is larger), a little left of centre so the
 * figure stays readable, never over it. Near the top of the screen it stands
 * under the mark instead. The answer is the robin's FEET (the bottom centre
 * of its body).
 */
export function palHopPerch(
  pin: ScreenPoint,
  viewport: ScreenBox,
  reach: number = PILL_REACH_PX,
): ScreenPoint & { below: boolean } {
  const half = PAL_HOP_ROBIN_PX / 2;
  const x = Math.min(viewport.width - EDGE_PX - half, Math.max(EDGE_PX + half, pin.x - 8));
  const above = pin.y - reach;
  if (above - PAL_HOP_ROBIN_PX >= SAFE_TOP_PX) return { x, y: above, below: false };
  return { x, y: pin.y + reach + PAL_HOP_ROBIN_PX, below: true };
}

/** A footprint the robin leaves on the ground between two landings. */
export type PalHopFootprint = ScreenPoint & { angle: number; side: -1 | 1 };

/**
 * Little paired steps along a hop's ground line: `count` prints at even
 * spacing, alternating left and right foot, each turned to the direction of
 * travel. A very short hop leaves none.
 */
export function palHopFootprints(from: ScreenPoint, to: ScreenPoint, count = 4): PalHopFootprint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 40 || count < 1) return [];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const nx = -dy / length;
  const ny = dx / length;
  const prints: PalHopFootprint[] = [];
  for (let index = 1; index <= count; index += 1) {
    const k = index / (count + 1);
    const side: -1 | 1 = index % 2 === 0 ? 1 : -1;
    prints.push({
      x: from.x + dx * k + nx * 4 * side,
      y: from.y + dy * k + ny * 4 * side,
      angle,
      side,
    });
  }
  return prints;
}

/**
 * Where the speech bubble goes: above the robin when there is room under the
 * top bar, otherwise below its pin; always inside the screen. `tailX` is
 * where along the bubble's width the tail points back at the robin.
 */
export function palHopBubblePlacement(
  feet: ScreenPoint,
  bubble: ScreenBox,
  viewport: ScreenBox,
): { left: number; top: number; tailX: number; above: boolean } {
  const margin = 12;
  const gap = 12;
  const robinTop = feet.y - PAL_HOP_ROBIN_PX;
  const maxLeft = Math.max(margin, viewport.width - margin - bubble.width);
  const left = Math.min(maxLeft, Math.max(margin, feet.x - bubble.width / 2));
  const tailX = Math.min(bubble.width - 22, Math.max(22, feet.x - left));
  const aboveTop = robinTop - gap - bubble.height;
  if (aboveTop >= SAFE_TOP_PX) return { left, top: aboveTop, tailX, above: true };
  const belowTop = Math.min(viewport.height - margin - bubble.height, feet.y + gap);
  return { left, top: Math.max(margin, belowTop), tailX, above: false };
}

// --- what it says -----------------------------------------------------------

/** The robin's bubble once it has landed on the cheapest pin. */
export type PalHopAnswer = {
  kicker: string;
  /** "A pint of Camden Hells", or "A pint" when the record names no beer. */
  drink: string;
  pub: string;
  /** Who listed the figure and when, in the house's own words. */
  provenance: string;
};

/** The drink line. The beer is named only when its record names it. */
export function palHopDrinkLine(beer: string | null | undefined): string {
  const name = beer?.trim();
  return name ? `A pint of ${name}` : "A pint";
}

/**
 * The line under a figure people logged. The robin reads that figure off the
 * map's bottom card, which carries no day for it, and the slim row's read day
 * belongs to the listed figure it replaced. So the line says the day is not
 * known here rather than borrow the listing's.
 */
const PAL_HOP_PEOPLE_LOGGED_LINE = "People-logged price · Date not known";

export function palHopAnswer(winner: PalHopStop, beer: string | null): PalHopAnswer {
  return {
    kicker: "Cheapest pint on screen",
    drink: palHopDrinkLine(beer),
    pub: winner.name,
    provenance: winner.peopleLogged
      ? PAL_HOP_PEOPLE_LOGGED_LINE
      : compassPriceLabel({
          priceSource: winner.priceSource ?? undefined,
          priceObservedAt: winner.priceObservedAt ?? undefined,
        }),
  };
}

/** Why there is nothing to hop to, said plainly. */
export type PalHopEmptyReason = "unpriced" | "lens" | "unread";

export function palHopEmptyLine(reason: PalHopEmptyReason): string {
  if (reason === "lens") return "I only hunt pints. The map is showing another drink right now.";
  if (reason === "unread") return "I could not read the prices on screen just now.";
  return "No listed pint price on screen here.";
}

/**
 * The nearest London (or city) patch with prices behind it, for the one offer
 * the robin makes when it finds nothing: an area whose own gate does not
 * name price coverage as missing, and that is not paused. Distance is a flat
 * approximation, which is plenty to rank patches a few miles apart.
 */
export function nearestPricedArea(
  areas: readonly {
    slug: NightArea["slug"] | string;
    name: string;
    centre: NightArea["centre"];
    coverageStatus: NightArea["coverageStatus"];
    missingEvidence: readonly string[];
  }[],
  center: { lng: number; lat: number },
): { slug: string; name: string } | null {
  let best: { slug: string; name: string; d: number } | null = null;
  const cos = Math.cos((center.lat * Math.PI) / 180);
  for (const area of areas) {
    if (area.coverageStatus === "paused") continue;
    if (area.missingEvidence.includes("price_coverage")) continue;
    const dx = (area.centre.lng - center.lng) * cos;
    const dy = area.centre.lat - center.lat;
    const d = dx * dx + dy * dy;
    if (!best || d < best.d) best = { slug: area.slug, name: area.name, d };
  }
  return best ? { slug: best.slug, name: best.name } : null;
}

/**
 * Generous geographic bounds around what the camera shows, for the slim pack
 * read; `stopsInView` then keeps only the rows drawn inside the screen. At
 * 512px tiles a CSS pixel spans 360 / (512 * 2^zoom) degrees of longitude, and
 * a tilted camera sees further, so the box widens with the pitch.
 */
export function palHopViewBounds(
  camera: { center: [number, number]; zoom: number; pitch?: number },
  viewport: ScreenBox,
): { west: number; south: number; east: number; north: number } {
  const [lng, lat] = camera.center;
  const degreesPerPx = 360 / (512 * 2 ** camera.zoom);
  const stretch = 1.5 + Math.min(60, Math.max(0, camera.pitch ?? 0)) / 20;
  const half = (Math.max(viewport.width, viewport.height) / 2) * degreesPerPx * stretch;
  const halfLat = half * Math.cos((lat * Math.PI) / 180);
  return { west: lng - half, east: lng + half, south: lat - halfLat, north: lat + halfLat };
}

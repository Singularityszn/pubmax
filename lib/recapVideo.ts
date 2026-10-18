// The recap video's script: what each beat of the 15 to 20 second crawl recap
// shows, built ONLY from what the public recap already shows. The Plan name,
// each Stop's Venue name, its pint price exactly as the crew logged it, the
// time of the stop, the Route between the Stops, and the Friends the crew
// published. Nothing is invented: a Stop with no logged price shows none, a
// Stop with no time shows none, and the Friends beat exists only when a
// published `person` moment names someone.
//
// The PUBMAXX Promise rides here too: the video celebrates the night and the
// people, so it never counts drinks. No pint count, no total, no "rounds".
//
// Pure leaf: no I/O, no Date.now. `components/recap/RecapVideo.tsx` draws it.

import type { NightMoment } from "@/lib/nightMemory";
import type { RecapView } from "@/lib/recapView";

export const RECAP_VIDEO_FPS = 30;
export const RECAP_VIDEO_WIDTH = 1080;
export const RECAP_VIDEO_HEIGHT = 1920;

const INTRO_SECONDS = 2.5;
const ROUTE_SECONDS = 3;
const FRIENDS_SECONDS = 2.5;
const OUTRO_SECONDS = 2;
const STOP_SECONDS_MAX = 2.5;
const STOP_SECONDS_MIN = 1.2;
/**
 * The length the Stop beats are fitted to. A night of more than eight Stops
 * runs past it, because each Stop keeps STOP_SECONDS_MIN to be read.
 */
const TOTAL_SECONDS_MAX = 20;
const FRIENDS_MAX = 6;
const FRIEND_NAME_MAX = 40;

export type RecapVideoStop = {
  venueName: string;
  /** The logged price labels at this Stop, as the recap prints them. Empty when none was logged. */
  priceLabels: string[];
  /** "21:40", London time, or null when the moment carries no time. */
  timeLabel: string | null;
  /** Position on the route sketch, 0 to 1 in both axes, or null without coordinates. */
  point: { x: number; y: number } | null;
};

export type RecapVideoInput = {
  title: string;
  stops: RecapVideoStop[];
  friends: string[];
  /** Frame counts for each beat, so the composition and the Player agree. */
  timing: {
    introFrames: number;
    stopFrames: number;
    routeFrames: number;
    friendsFrames: number;
    outroFrames: number;
    durationInFrames: number;
  };
};

type VenueCoords = { lat: number; lng: number };

function londonTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(timestamp));
}

/**
 * Lay the Stops out in a unit square, keeping their real shape: longitude is
 * scaled by cos(latitude) so a London route is not stretched sideways, and the
 * longer side fills the square with a margin.
 */
export function routeSketchPoints(coords: ReadonlyArray<VenueCoords | null>): Array<{ x: number; y: number } | null> {
  const known = coords.filter((coord): coord is VenueCoords => coord !== null);
  if (known.length < 2) return coords.map(() => null);
  const meanLat = known.reduce((sum, coord) => sum + coord.lat, 0) / known.length;
  const scale = Math.cos((meanLat * Math.PI) / 180);
  const xs = known.map((coord) => coord.lng * scale);
  const ys = known.map((coord) => coord.lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const margin = 0.1;
  const width = (Math.max(...xs) - minX) / span;
  const height = (Math.max(...ys) - minY) / span;
  return coords.map((coord) => {
    if (!coord) return null;
    const x = (coord.lng * scale - minX) / span;
    const y = (coord.lat - minY) / span;
    return {
      // Centre the shape, then flip y: north is up on screen.
      x: margin + (1 - 2 * margin) * (x + (1 - width) / 2),
      y: margin + (1 - 2 * margin) * (1 - (y + (1 - height) / 2)),
    };
  });
}

function timingFor(stopCount: number, hasFriends: boolean): RecapVideoInput["timing"] {
  const fixed = INTRO_SECONDS + ROUTE_SECONDS + (hasFriends ? FRIENDS_SECONDS : 0) + OUTRO_SECONDS;
  const perStop =
    stopCount === 0 ? 0 : Math.max(STOP_SECONDS_MIN, Math.min(STOP_SECONDS_MAX, (TOTAL_SECONDS_MAX - fixed) / stopCount));
  const frames = (seconds: number) => Math.round(seconds * RECAP_VIDEO_FPS);
  const introFrames = frames(INTRO_SECONDS);
  const stopFrames = frames(perStop);
  const routeFrames = frames(ROUTE_SECONDS);
  const friendsFrames = hasFriends ? frames(FRIENDS_SECONDS) : 0;
  const outroFrames = frames(OUTRO_SECONDS);
  return {
    introFrames,
    stopFrames,
    routeFrames,
    friendsFrames,
    outroFrames,
    durationInFrames: introFrames + stopFrames * stopCount + routeFrames + friendsFrames + outroFrames,
  };
}

/**
 * The video script for one public recap. `published` must be the Story's
 * published moments (`selectPublishedRecapMoments`), the same set `view` was
 * composed from, so the video can show nothing the page does not. Null when
 * the night has no Stop to show.
 */
export function buildRecapVideoInput(input: {
  view: RecapView;
  published: readonly NightMoment[];
  coordsByVenueId?: ReadonlyMap<string, VenueCoords>;
}): RecapVideoInput | null {
  const { view, published } = input;
  if (view.route.length === 0) return null;

  // In the order composeRecapFromPublishedStory gives the route.
  const venueMoments = published
    .filter((moment) => moment.kind === "venue" && moment.venueId)
    .sort((left, right) => (left.occurredAt ?? left.createdAt).localeCompare(right.occurredAt ?? right.createdAt));

  const coords = view.route.map((stop) => input.coordsByVenueId?.get(stop.venueId) ?? null);
  const points = routeSketchPoints(coords);

  // Each Stop takes the next unused venue moment for its own Venue, so a pub
  // visited twice gets its two times in order and a Stop never borrows another
  // pub's time.
  const momentsByVenue = new Map<string, NightMoment[]>();
  for (const moment of venueMoments) {
    const queue = momentsByVenue.get(moment.venueId as string) ?? [];
    queue.push(moment);
    momentsByVenue.set(moment.venueId as string, queue);
  }

  const stops: RecapVideoStop[] = view.route.map((stop, index) => ({
    venueName: stop.venueName,
    priceLabels: view.pints
      .filter((pint) => pint.venueId === stop.venueId && pint.priceLabel)
      .map((pint) => pint.priceLabel as string),
    timeLabel: londonTime(momentsByVenue.get(stop.venueId)?.shift()?.occurredAt),
    point: points[index] ?? null,
  }));

  const friends = [
    ...new Set(
      published
        .filter((moment) => moment.kind === "person")
        .map((moment) => moment.caption.trim().slice(0, FRIEND_NAME_MAX))
        .filter(Boolean),
    ),
  ].slice(0, FRIENDS_MAX);

  return { title: view.title, stops, friends, timing: timingFor(stops.length, friends.length > 0) };
}

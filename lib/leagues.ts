// Private leagues: the limits, the invite code, the district map and the copy.
// A PURE LEAF. It imports no store, so the league pages can read it without
// pulling a store behind them. lib/leagues.server.ts reads; this module counts.

import type { MatesBoardRow } from "@/lib/matesBoard";
import type { Route } from "next";

/** Most members one league holds. Migration 0239 holds the same number. */
export const LEAGUE_MAX_MEMBERS = 20;
/** Most leagues one person is in, made or joined. Migration 0239 holds the same number. */
export const LEAGUE_MAX_PER_PERSON = 10;
export const LEAGUE_NAME_MAX = 40;

/** No 0, O, 1 or I, so a code read aloud is the code typed. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
const INVITE_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const LEAGUE_INVITE_PREFIX = "/social/leagues/join/";
const LEAGUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeagueId(value: unknown): value is string {
  return typeof value === "string" && LEAGUE_ID.test(value);
}

/**
 * A typed or pasted code, or null. Case, spaces and dashes do not matter, so
 * "abcd-efgh" is "ABCDEFGH".
 */
export function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  return INVITE_CODE.test(code) ? code : null;
}

/** "ABCD-EFGH", so a code is easy to read out. */
export function formatInviteCode(code: string): string {
  return code.length === INVITE_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** The path a shared invite link opens. */
export function leagueInvitePath(code: string): string {
  return `${LEAGUE_INVITE_PREFIX}${encodeURIComponent(code)}`;
}

export function safeLeagueInviteReturnTo(raw: string | null | undefined): Route | null {
  if (typeof raw !== "string" || !raw.startsWith(LEAGUE_INVITE_PREFIX)) return null;
  const code = raw.slice(LEAGUE_INVITE_PREFIX.length);
  return INVITE_CODE.test(code) ? leagueInvitePath(code) as Route : null;
}

/** A league's name with its spaces tidied, or null when it is empty or too long. */
export function parseLeagueName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= LEAGUE_NAME_MAX ? name : null;
}

// ── The district map ────────────────────────────────────────────────────────

export type LeagueDistrict = {
  /** "E1", "SW11". */
  district: string;
  /** The pubs we list in it. */
  pubs: number;
  /** The most of those pubs one member has been to. 0 when nobody has. */
  top: number;
  /** Every member on `top`. One leads it, two or more share it, none is nobody. */
  leaders: string[];
  /** How many the reader has been to. */
  you: number;
};

/** The London postal areas, in the order the map lays them out. */
const LEAGUE_MAP_AREAS = ["NW", "N", "E", "W", "WC", "EC", "SW", "SE"] as const;

export type LeagueMapArea = (typeof LEAGUE_MAP_AREAS)[number];

export function districtArea(district: string): LeagueMapArea | null {
  const area = /^[A-Z]+/.exec(district)?.[0];
  return (LEAGUE_MAP_AREAS as readonly string[]).includes(area ?? "") ? (area as LeagueMapArea) : null;
}

/**
 * Who leads each district: the member who has been to the most of the pubs we
 * list in it. A district nobody has been to has no leader. Every district we
 * list a pub in is on the map, in numeric order.
 */
export function leagueDistricts(
  districtPubs: ReadonlyMap<string, readonly string[]>,
  people: ReadonlyArray<{ handle: string; self: boolean; visited: ReadonlySet<string> }>,
): LeagueDistrict[] {
  return [...districtPubs]
    .filter(([district, ids]) => ids.length > 0 && districtArea(district) !== null)
    .sort(([a], [b]) => a.localeCompare(b, "en-GB", { numeric: true }))
    .map(([district, ids]) => {
      const counts = people.map((person) => ({
        person,
        count: ids.reduce((sum, id) => sum + (person.visited.has(id) ? 1 : 0), 0),
      }));
      const top = counts.reduce((best, { count }) => Math.max(best, count), 0);
      return {
        district,
        pubs: ids.length,
        top,
        leaders: top > 0
          ? counts.filter(({ count }) => count === top).map(({ person }) => person.handle).sort()
          : [],
        you: counts.find(({ person }) => person.self)?.count ?? 0,
      };
    });
}

/** How many districts each handle leads alone. */
export function districtsLed(districts: readonly LeagueDistrict[]): Map<string, number> {
  const led = new Map<string, number>();
  for (const { leaders } of districts) {
    if (leaders.length === 1) led.set(leaders[0]!, (led.get(leaders[0]!) ?? 0) + 1);
  }
  return led;
}

/** Member colours on the map. A ninth member reuses the first colour; the key says who. */
export const LEAGUE_HUES = 8;

// ── The answers the routes send ─────────────────────────────────────────────

export type LeagueSummary = {
  id: string;
  name: string;
  /** True when the reader made it. */
  owner: boolean;
};

export type LeagueExportRecord =
  | { kind: "owned"; name: string; createdAt: string }
  | { kind: "membership"; name: string; joinedAt: string };

export type LeagueRow = MatesBoardRow & { owner: boolean };

export type LeagueBoard = {
  league: { id: string; name: string; code: string; owner: boolean };
  /** "degraded" when somebody's records did not all load, so a total may be low. */
  status: "ready" | "degraded";
  rows: LeagueRow[];
  /** Null when the London pub list failed or any visible member's standing is degraded. */
  districts: LeagueDistrict[] | null;
};

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function parseSummary(value: unknown): LeagueSummary | null {
  const row = record(value);
  if (!row || !isLeagueId(row.id) || typeof row.name !== "string" || !row.name) return null;
  return { id: row.id, name: row.name, owner: row.owner === true };
}

export function parseLeagueList(value: unknown): LeagueSummary[] | null {
  const body = record(value);
  if (!body || !Array.isArray(body.leagues)) return null;
  const leagues = body.leagues.map(parseSummary);
  return leagues.every((league) => league !== null) ? (leagues as LeagueSummary[]) : null;
}

function parseRow(value: unknown): LeagueRow | null {
  const row = record(value);
  if (!row) return null;
  const total = count(row.total);
  const level = count(row.level);
  if (typeof row.handle !== "string" || !row.handle || total === null || level === null) return null;
  return { handle: row.handle, self: row.self === true, total, level, owner: row.owner === true };
}

function parseDistrict(value: unknown): LeagueDistrict | null {
  const row = record(value);
  if (!row || typeof row.district !== "string" || !districtArea(row.district)) return null;
  const pubs = count(row.pubs);
  const top = count(row.top);
  const you = count(row.you);
  const leaders = Array.isArray(row.leaders) && row.leaders.every((handle) => typeof handle === "string")
    ? (row.leaders as string[])
    : null;
  if (pubs === null || top === null || you === null || !leaders) return null;
  return { district: row.district, pubs, top, leaders, you };
}

export function parseLeagueBoard(value: unknown): LeagueBoard | null {
  const body = record(value);
  const league = record(body?.league);
  if (!body || !league) return null;
  if (!isLeagueId(league.id) || typeof league.name !== "string" || !normalizeInviteCode(league.code)) return null;
  if (body.status !== "ready" && body.status !== "degraded") return null;
  if (!Array.isArray(body.rows)) return null;
  const rows = body.rows.map(parseRow);
  if (rows.some((row) => row === null)) return null;
  let districts: LeagueDistrict[] | null = null;
  if (Array.isArray(body.districts)) {
    const parsed = body.districts.map(parseDistrict);
    if (parsed.some((district) => district === null)) return null;
    districts = parsed as LeagueDistrict[];
  } else if (body.districts !== null) {
    return null;
  }
  return {
    league: { id: league.id, name: league.name, code: String(league.code), owner: league.owner === true },
    status: body.status,
    rows: rows as LeagueRow[],
    districts,
  };
}

// ── Copy ────────────────────────────────────────────────────────────────────

export const LEAGUES_COPY = {
  kicker: "Leagues",
  title: "Your leagues",
  lede: "A league is you and the people you invite, ranked by points. Only members see it.",
  none: "You're not in a league yet.",
  noneBody: "Start one and send the code to your lot, or join with a code someone sent you.",
  create: "Start a league",
  nameLabel: "League name",
  joinLabel: "Invite code",
  join: "Join",
  joinTitle: "Join a league",
  joinLede: "Someone sent you a code for their league.",
  joinNote: "When you join, everyone in the league sees your points, your level and the districts you lead.",
  owner: "You run this",
  board: "Members",
  you: "You",
  ownerTag: "runs it",
  inviteTitle: "Invite",
  inviteBody: "Anyone with the code or link can join, up to 20 people.",
  copyLink: "Copy link",
  copied: "Link copied.",
  newCode: "New code",
  newCodeBody: "The old code and link stop working.",
  leave: "Leave league",
  remove: "Delete league",
  removeConfirm: "Delete this league for everyone? Points stay. The league doesn't.",
  mapTitle: "Who leads each district",
  mapLede: "Each London postcode district is coloured by the member who has been to the most of the pubs we list there.",
  mapShared: "Shared",
  mapNobody: "Nobody yet",
  mapUnavailable: "The district map didn't load. The table above still counts.",
  degraded: "Some records didn't load, so a total may be low. Try again later.",
  loading: "Reading your leagues.",
  error: "We couldn't read your leagues.",
  notOpen: "Leagues aren't open yet.",
  notOpenBody: "We're setting them up. Your points already count.",
  signIn: "Sign in to start or join a league.",
  notFound: "That league isn't one of yours.",
  badCode: "That code doesn't open a league. Check it with whoever sent it.",
  full: "That league is full. It holds 20 people.",
  limit: "You're in 10 leagues already. Leave one to join another.",
  badName: `Give it a name of up to ${LEAGUE_NAME_MAX} characters.`,
  /** The door from the mates' board. */
  door: "Your leagues",
} as const;

/** The caption under the map for one district. */
export function districtCaption(district: LeagueDistrict, self: string | null): string {
  const pubs = `${district.pubs} ${district.pubs === 1 ? "pub" : "pubs"} we list`;
  const yours = `You've been to ${district.you}.`;
  if (district.leaders.length === 0) return `${district.district}: ${LEAGUES_COPY.mapNobody.toLowerCase()}, ${pubs}. ${yours}`;
  const names = district.leaders.map((handle) => (handle === self ? "you" : `@${handle}`));
  const who = names.length === 1 ? `${names[0]} ${names[0] === "you" ? "lead" : "leads"}` : `${names.join(" and ")} share it`;
  return `${district.district}: ${who} with ${district.top} of ${pubs}. ${yours}`;
}

// Pub Pal V0.1 concierge tool policy (ADR 0014 registry, wave R-015).
//
// Pure and browser-safe: what each of the five new tools may CLAIM, the words
// it says, and the shapes it hands back. The server handlers live beside this
// in `lib/ask/conciergeTools.server.ts`; keeping the policy here is what makes
// the honesty rules unit-testable without a data file or a clock.
//
// Three laws ride with the whole set:
//   1. A tool answers from a lane that already exists. It never derives a
//      figure, never invents a venue, and never widens a trust gate.
//   2. A read that could not run is NOT an empty city. Every empty line below
//      separates "nobody has logged this" from "we could not look".
//   3. A write is a proposal (ADR 0006). `report_occupancy` writes nothing at
//      all today, because the crowd store (master plan R-011) is not built.

import type { WhatsOnRow } from "@/lib/whatsOn";
import { rowEffectiveEnd } from "@/lib/whatsOn";

// ---------------------------------------------------------------------------
// cheapest_pint_near
// ---------------------------------------------------------------------------

/**
 * How the anchor for a "cheapest pint near X" ask was found.
 *
 * There is deliberately no `viewer` member. The tool takes a listed pub or an
 * area name and nothing else: a viewer point would cross the one egress seam
 * (`lib/geo.ts`) for an answer an area name already gives.
 */
export type CheapestNearAnchor =
  | { kind: "venue"; venueId: string; name: string; area: string }
  | { kind: "area"; area: string };

export function cheapestNearHeadline(
  anchor: CheapestNearAnchor,
  scope: "walkable" | "widened" | "none",
): string {
  if (anchor.kind === "area") return `Cheapest listed pints in ${anchor.area}`;
  if (scope === "widened") return `Nearest listed pints to ${anchor.name}`;
  return `Cheapest listed pints near ${anchor.name}`;
}

/** The line when the anchor itself could not be resolved. */
export const CHEAPEST_NEAR_NO_ANCHOR =
  "Name a listed pub or a London area and I'll find the cheapest pints round it.";

/**
 * The empty line, split three ways. A read that failed may never be worded as
 * an area with no prices in it.
 */
export function cheapestNearEmptyLine(
  anchor: CheapestNearAnchor,
  read: "ready" | "unavailable",
): string {
  if (read === "unavailable") {
    return "I couldn't read the listed prices just now, so I won't guess at the cheapest.";
  }
  const place = anchor.kind === "area" ? anchor.area : anchor.name;
  return `No listed pint prices round ${place} yet.`;
}

/** One row's note: the figure is the card's, this says where and how far. */
export function cheapestNearRowNote(input: {
  area: string;
  walkMinutes?: number | null;
}): string {
  const walk =
    typeof input.walkMinutes === "number" && Number.isFinite(input.walkMinutes)
      ? `${input.walkMinutes} min walk`
      : "";
  return [input.area, walk].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// tonight_now
// ---------------------------------------------------------------------------

export type TonightNowSplit = {
  /** Rows whose own window is running at `now`. */
  onNow: WhatsOnRow[];
  /** Rows tonight that have not started yet. */
  later: WhatsOnRow[];
};

/**
 * Split tonight's sourced rows into what is running and what is still to come.
 *
 * "On now" is read off the row's OWN window - its stated start and the same
 * effective end `isOnTonight` uses - so nothing here invents a duration. A row
 * with no parseable start cannot say whether it is running, so it falls to
 * `later`, which promises less.
 */
export function splitTonightRowsByNow(
  rows: readonly WhatsOnRow[],
  now: number,
): TonightNowSplit {
  const onNow: WhatsOnRow[] = [];
  const later: WhatsOnRow[] = [];
  for (const row of rows) {
    const startsAt = row.startsAt ? Date.parse(row.startsAt) : Number.NaN;
    const endsAt = rowEffectiveEnd(row);
    if (
      Number.isFinite(startsAt) &&
      Number.isFinite(endsAt) &&
      startsAt <= now &&
      endsAt >= now
    ) {
      onNow.push(row);
    } else {
      later.push(row);
    }
  }
  return { onNow, later };
}

/**
 * What we hold about how busy a pub is right now: nothing.
 *
 * The crowd report (master plan R-011) is not built, so a "quiet or rammed"
 * answer would be a guess dressed as a reading. Named once here so the tool,
 * the docs and the test all say the same thing.
 */
export const CROWD_REPORTS_NOT_ON_RECORD =
  "Nobody can log how busy a pub is yet, so I can't tell you what's quiet.";

export function tonightNowLine(input: {
  area?: string | null;
  onNow: number;
  later: number;
  read: "ready" | "unavailable";
}): string {
  if (input.read === "unavailable") {
    return "I couldn't read tonight's listings just now.";
  }
  const where = input.area ? ` in ${input.area}` : "";
  if (input.onNow === 0 && input.later === 0) {
    return `Nothing sourced${where} for tonight.`;
  }
  const running =
    input.onNow > 0
      ? `${input.onNow} on right now${where}`
      : `Nothing running${where} this minute`;
  const ahead =
    input.later > 0
      ? `${input.later} still to start tonight`
      : "nothing else listed tonight";
  return `${running}, ${ahead}.`;
}

// ---------------------------------------------------------------------------
// venue_drinks
// ---------------------------------------------------------------------------

export function venueDrinksEmptyLine(
  venueName: string,
  read: "ready" | "unavailable",
): string {
  if (read === "unavailable") {
    return `I couldn't read what people have logged at ${venueName}.`;
  }
  return `No drink prices logged at ${venueName} yet. Log one at the bar and it shows on that pub's page straight away.`;
}

/** One drink row's note: its own tag, its own day, and what it counts toward. */
export function venueDrinkRowNote(input: {
  label: string;
  day: string;
  corroborated: boolean;
}): string {
  const standing = input.corroborated
    ? "two people agree, so it reaches the map"
    : "one report so far, so it stays on this pub's page";
  return `${input.label} · logged ${input.day} · ${standing}`;
}

export const VENUE_DRINKS_NO_VENUE =
  "Name a listed pub and I'll read back what people have logged there.";

// ---------------------------------------------------------------------------
// find_desk
// ---------------------------------------------------------------------------

/**
 * The kinds a work-friendly answer may come from.
 *
 * These are the widened venue kinds the UK extraction lane lands. They are
 * matched as plain strings on purpose: `VenueKind` does not carry them yet, and
 * a tool that hard-fails until a type widens is a tool that ships broken. A pub
 * is deliberately NOT here - a pub row carries no seating or wifi fact, so
 * offering one as a desk would be a recommendation we cannot back.
 */
export const WORK_FRIENDLY_VENUE_KINDS = [
  "cafe",
  "coworking",
  "library",
] as const;

export type WorkFriendlyVenueKind = (typeof WORK_FRIENDLY_VENUE_KINDS)[number];

export function isWorkFriendlyVenueKind(
  kind: unknown,
): kind is WorkFriendlyVenueKind {
  return (
    typeof kind === "string" &&
    (WORK_FRIENDLY_VENUE_KINDS as readonly string[]).includes(kind)
  );
}

/**
 * The honest empty answer, and the one this wave actually ships.
 *
 * Nothing in the London pack carries a seat, a plug or a wifi fact today, so
 * the tool says so rather than handing back a pub and calling it a desk.
 */
export const FIND_DESK_NO_SEAT_DATA =
  "No seat data yet. Nobody has logged a desk-friendly seat, a plug or wifi anywhere, so I won't point you at one.";

export function findDeskEmptyLine(
  area: string | null,
  read: "ready" | "unavailable",
): string {
  if (read === "unavailable") {
    return "I couldn't read the places list just now, so I won't guess at a seat.";
  }
  if (!area) return FIND_DESK_NO_SEAT_DATA;
  return `${FIND_DESK_NO_SEAT_DATA} That goes for ${area} too.`;
}

/** A found row's note. Says what is on record and, plainly, what is not. */
export function findDeskRowNote(input: {
  area: string;
  kind: WorkFriendlyVenueKind;
}): string {
  const noun =
    input.kind === "coworking"
      ? "co-working space"
      : input.kind === "library"
        ? "library"
        : "cafe";
  return `${noun} in ${input.area} · no seat or wifi report on record`;
}

// ---------------------------------------------------------------------------
// report_occupancy
// ---------------------------------------------------------------------------

/** The closed set a person may report. Master plan R-011's three buttons. */
export const OCCUPANCY_LEVELS = ["empty", "some-seats", "full"] as const;

export type OccupancyLevel = (typeof OCCUPANCY_LEVELS)[number];

export const OCCUPANCY_LEVEL_LABELS: Record<OccupancyLevel, string> = {
  empty: "Empty",
  "some-seats": "Some seats",
  full: "Full",
};

export function parseOccupancyLevel(value: unknown): OccupancyLevel | null {
  if (typeof value !== "string") return null;
  const needle = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if ((OCCUPANCY_LEVELS as readonly string[]).includes(needle)) {
    return needle as OccupancyLevel;
  }
  if (/\b(rammed|packed|heaving|no seats)\b/.test(needle)) return "full";
  if (/\b(quiet|dead|empty)\b/.test(needle)) return "empty";
  if (/\b(seats|room|space)\b/.test(needle)) return "some-seats";
  return null;
}

/**
 * Whether a crowd report has anywhere to land.
 *
 * `"unbuilt"` is the state this wave ships in: master plan R-011 owns the
 * table, and inventing a schema for it here - or quietly borrowing the visit
 * report or community price lane, which mean different things - would be worse
 * than saying nothing lands. The predicate exists so that when R-011 arrives
 * only this answer changes.
 */
export type OccupancyStoreState = "unbuilt" | "ready";

export function occupancyStoreState(): OccupancyStoreState {
  return "unbuilt";
}

export type OccupancyReportOutcome =
  | {
      status: "no-venue";
      line: string;
    }
  | {
      status: "no-level";
      line: string;
    }
  | {
      /** Parsed and valid, but there is nowhere to write it yet. */
      status: "store-unbuilt";
      venueId: string;
      venueName: string;
      level: OccupancyLevel;
      line: string;
    }
  | {
      /** Parsed and valid; the client must confirm before anything is written. */
      status: "proposed";
      venueId: string;
      venueName: string;
      level: OccupancyLevel;
      line: string;
    };

/**
 * What a crowd report may do, given a pub, a level and the store's state.
 *
 * It never writes. With a store it hands back a proposal for the reader to
 * confirm (ADR 0006); without one it says plainly that the report has nowhere
 * to go, so a button that looked like it logged something can never exist.
 */
export function occupancyReportOutcome(input: {
  venueId: string;
  venueName: string;
  level: unknown;
  store: OccupancyStoreState;
}): OccupancyReportOutcome {
  if (!input.venueId || !input.venueName) {
    return {
      status: "no-venue",
      line: "Name the pub you're standing in and I'll take the crowd report.",
    };
  }
  const level = parseOccupancyLevel(input.level);
  if (!level) {
    return {
      status: "no-level",
      line: `Is ${input.venueName} empty, some seats, or full?`,
    };
  }
  if (input.store === "unbuilt") {
    return {
      status: "store-unbuilt",
      venueId: input.venueId,
      venueName: input.venueName,
      level,
      line: `${OCCUPANCY_LEVEL_LABELS[level]} at ${input.venueName}, got it. Crowd reports have nowhere to land yet, so I haven't saved it and nobody else will see it.`,
    };
  }
  return {
    status: "proposed",
    venueId: input.venueId,
    venueName: input.venueName,
    level,
    line: `Log ${input.venueName} as ${OCCUPANCY_LEVEL_LABELS[level].toLowerCase()}? Nothing is saved until you confirm.`,
  };
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

/**
 * OpenAI/OpenRouter schemas for the five V0.1 tools. Spread into the one
 * registry list in `lib/ask/tools.ts` so the allowlist stays a single place.
 *
 * `cheapest_pint_near` carries no lat/lng by design.
 */
export const CONCIERGE_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "cheapest_pint_near" as const,
      description:
        "Cheapest listed pints around a named pub or a London area. Never takes the reader's own position, and never invents a figure.",
      parameters: {
        type: "object",
        properties: {
          venueId: { type: "string" },
          venueName: { type: "string" },
          area: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "tonight_now" as const,
      description:
        "Sourced listings running right now versus later tonight. Says plainly that no crowd report exists.",
      parameters: {
        type: "object",
        properties: { area: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "venue_drinks" as const,
      description:
        "Every drink people have logged at one listed pub, each with its own tag, figure and day.",
      parameters: {
        type: "object",
        properties: {
          venueId: { type: "string" },
          venueName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_desk" as const,
      description:
        "Places to sit and work. Answers only from cafe, co-working and library rows, and says so when there is no seat data.",
      parameters: {
        type: "object",
        properties: {
          area: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "report_occupancy" as const,
      description:
        "Take a crowd report for a pub (empty, some seats, full). Writes nothing: the reader confirms, and today there is no crowd store to write to.",
      parameters: {
        type: "object",
        properties: {
          venueId: { type: "string" },
          venueName: { type: "string" },
          level: { type: "string" },
        },
      },
    },
  },
];

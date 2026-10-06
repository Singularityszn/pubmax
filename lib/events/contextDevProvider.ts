// The Context.dev registered-source events lane.
//
// Every specifier below is RELATIVE and carries its extension, and this module
// carries no `server-only` marker, because scripts/whatson/eventsRefresh.mjs
// imports it under plain `node`: Node strips TypeScript types but resolves no
// tsconfig `@/*` alias, and `server-only` throws on import outside a React
// Server Component. This lane is a CLI consumer of `../contextDev.ts`.

import {
  createContextDevBudget,
  extract,
  isContextDevConfigured,
  type ContextDevCallOptions,
} from "../contextDev.ts";
import { contextDevEventSources, type HarvestSource } from "../harvest/sourcePolicy.ts";
import {
  DATE_ONLY_TIME_EVIDENCE,
  emptyEventDrops,
  mergeEventDrops,
  statedCalendarDate,
  toIsoInstant,
  type EventDropCounts,
  type EventDropReason,
} from "../whatson/eventNormalise.mjs";

const ALLOWED_KINDS = new Set(["music", "sport", "event"]);

const CONTEXT_DEV_EVENT_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Only when stated by the page." },
          startsAt: {
            type: "string",
            description: "ISO 8601 instant with timezone when the page states a clock time.",
          },
          startsDate: {
            type: "string",
            description: "YYYY-MM-DD when the page states a day and no clock time.",
          },
          placeName: { type: "string", description: "Only when stated by the page." },
          kind: { type: "string", enum: ["music", "sport", "event"] },
          sourceUrl: { type: "string", description: "Event link only when present on the page." },
          priceText: { type: "string", description: "Ticket price text exactly as listed, if any." },
          sourceId: { type: "string", description: "Stable id from the page when one is stated." },
        },
      },
    },
  },
  required: ["events"],
} as const;

type RawContextDevEvent = {
  title?: unknown;
  startsAt?: unknown;
  startsDate?: unknown;
  placeName?: unknown;
  kind?: unknown;
  sourceUrl?: unknown;
  priceText?: unknown;
  sourceId?: unknown;
};

type ExtractPayload = {
  events?: RawContextDevEvent[];
};

export type ContextDevNormaliseOpts = {
  observedAt: string;
  venueIndex?: unknown;
  resolveVenue?: (venueIndex: unknown, placeName: string, lat: number | null, lng: number | null) => string | null;
};

export type ContextDevRowDrop = EventDropReason;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function httpUrl(value: unknown): string | null {
  if (!nonEmptyString(value)) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}

function samePublisherUrl(value: unknown, source: HarvestSource): boolean {
  const candidate = httpUrl(value);
  if (!candidate) return false;
  const url = new URL(candidate);
  const registered = new URL(source.url);
  return !url.username && !url.password && url.protocol === registered.protocol && url.host === registered.host;
}

function stableId(prefix: string, input: string): string {
  let hash = 2_166_136_261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function parseGbpFromText(value: unknown): number | null {
  if (!nonEmptyString(value)) return null;
  const match = /£\s*(\d+(?:\.\d{1,2})?)(?!\d|[.,]\d)/u.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function evidenceWords(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_WORD = `(?:${MONTHS.map((month) => `${month.slice(0, 3)}(?:${month.slice(3)})?`).join("|")})`;
const STATED_DATE = new RegExp(
  `\\b(?:\\d{4}[-/. ]\\d{1,2}[-/. ]\\d{1,2}|\\d{1,2}[-/. ]\\d{1,2}(?:[-/. ]\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?:\\s+\\d{4})?|${MONTH_WORD}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?)\\b`,
  "gi",
);

type CalendarDateEvidence = { year: number | null; month: number; day: number };

function statedDates(value: string): CalendarDateEvidence[] {
  return Array.from(value.matchAll(STATED_DATE), ([token]) => {
    const parts = token.toLowerCase().replace(/(\d)(?:st|nd|rd|th)\b/g, "$1").split(/[\s,./-]+/).filter(Boolean);
    const monthWord = parts.find((part) => MONTHS.some((month) => month.startsWith(part) && part.length >= 3));
    const month = monthWord ? MONTHS.findIndex((name) => name.startsWith(monthWord)) + 1 : Number(parts[1]);
    const day = monthWord ? Number(parts.find((part) => /^\d{1,2}$/.test(part))) :
      parts[0]?.length === 4 ? Number(parts[2]) : Number(parts[0]);
    const yearPart = parts.find((part) => /^\d{4}$/.test(part));
    const year = yearPart ? Number(yearPart) : null;
    return { year, month, day };
  }).filter(({ year, month, day }) => month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
    (year === null || new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) ===
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`));
}

function sameStatedDay(left: CalendarDateEvidence, right: CalendarDateEvidence): boolean {
  return left.month === right.month && left.day === right.day &&
    (left.year === null || right.year === null || left.year === right.year);
}

function dateAppearsInEvidence(date: string, evidence: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const expected = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return statedDates(evidence).some((stated) => stated.year === expected.year && sameStatedDay(stated, expected));
}

const caseless = (word: string) =>
  word.replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`).replace(/ /g, "\\s+");

// Only an explicit zone counts: a known abbreviation ("CET", "1pm ET"), an
// IANA name, an offset, or words before "time" in any case ("8pm eastern
// time", "lagos time") unless they end in evening copy ("until closing time",
// "happy hour time"). "8PM PUB QUIZ" and "9PM FRI" name no zone.
const ZONE_ABBREVIATIONS = [
  "gmt", "utc", "bst", "cest", "cet", "eest", "eet", "edt", "est", "cdt", "cst", "mdt", "mst", "pdt",
  "pst", "akst", "akdt", "ist", "jst", "aest", "aedt", "awst", "nzst", "nzdt", "hkt", "sgt", "msk", "sast",
];
const CAPITAL_ONLY_ZONE_ABBREVIATIONS = ["ET", "PT", "CT", "MT"];
// Evening copy before "time" ("until closing time", "Match Time") is not a place.
const EVENING_TIME_WORDS = new Set([
  "CLOSING", "START", "STARTING", "OPENING", "KICK-OFF", "KICKOFF", "ORDERS", "HOUR", "SHOW", "DOORS", "HOME",
  "FINISH", "PARTY", "QUIZ", "GAME", "MATCH", "TEA", "BED", "PLAY",
]);

const STATED_CLOCK = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s*([aApP][mM])|([01]?\\d|2[0-3]):([0-5]\\d))" +
    `(?:\\s*([zZ]|[+-](?:0\\d|1[0-4]):[0-5]\\d|[A-Za-z]+\\/[A-Za-z_]+|(?:[A-Za-z]+(?:-[A-Za-z]+)?\\s+){1,3}${caseless("time")}|${[...ZONE_ABBREVIATIONS.map(caseless), ...CAPITAL_ONLY_ZONE_ABBREVIATIONS].join("|")}))?` +
    "(?![\\p{L}\\p{N}])",
  "gu",
);

type StatedZone = { kind: "london" } | { kind: "offset"; minutes: number } | { kind: "unsupported" };

/** What the words after a clock say about its zone, or null when they name none. */
function statedZone(raw: string | undefined): StatedZone | null {
  if (!raw) return null;
  const zone = raw.toUpperCase().replace(/\s+/g, " ");
  if (zone.endsWith(" TIME")) {
    const words = zone.slice(0, -" TIME".length);
    if (EVENING_TIME_WORDS.has(words.split(" ").at(-1) ?? "")) return null;
    if (words === "LONDON" || words === "UK" || words === "LOCAL") return { kind: "london" };
    if (words === "GREENWICH MEAN") return { kind: "offset", minutes: 0 };
    if (words === "BRITISH SUMMER") return { kind: "offset", minutes: 60 };
    return { kind: "unsupported" };
  }
  if (zone === "EUROPE/LONDON") return { kind: "london" };
  if (zone === "Z" || zone === "GMT" || zone === "UTC") return { kind: "offset", minutes: 0 };
  if (zone === "BST") return { kind: "offset", minutes: 60 };
  if (/^[+-]\d{2}:\d{2}$/.test(zone)) {
    return { kind: "offset", minutes: (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) };
  }
  return { kind: "unsupported" };
}

function londonWallClock(instant: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

function timeAppearsInEvidence(instant: string, section: string): boolean {
  const instantMs = Date.parse(instant);
  const clocks = Array.from(section.matchAll(STATED_CLOCK));
  const roles = clocks.map((match, index) => {
    const prefix = section.slice(index === 0 ? 0 : (clocks[index - 1]?.index ?? 0) + (clocks[index - 1]?.[0].length ?? 0), match.index);
    return /\b(?:starts?|start\s+time|begins?|kick[- ]?off|showtime)\s*(?:at|:)?\s*$/i.test(prefix) ? "start" :
      /\b(?:doors?|opens?|entry)\s*(?:at|:)?\s*$/i.test(prefix) ? "doors" :
        /\b(?:ends?|finishes?|closes?)\s*(?:at|:)?\s*$/i.test(prefix) || /^\s*[-–]\s*$/.test(prefix) ? "end" : "unlabelled";
  });
  const starts = clocks.filter((_, index) => roles[index] === "start");
  if (starts.length === 0 && roles.some((role) => role === "doors")) return false;
  const candidates = starts.length > 0 ? starts : clocks.filter((_, index) => roles[index] === "unlabelled");
  if (candidates.length !== 1) return false;
  const hasZone = clocks.some((match) => statedZone(match[6]) !== null);
  const london = londonWallClock(instant);

  return candidates.some((match) => {
    const zone = statedZone(match[6]);
    if (hasZone && !zone) return false;
    let hour = Number(match[1] ?? match[4]);
    const minute = Number(match[2] ?? match[5] ?? "0");
    if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);

    if (!zone || zone.kind === "london") {
      return hour === london.hour && minute === london.minute &&
        dateAppearsInEvidence(london.date, ` ${evidenceWords(section)} `);
    }
    if (zone.kind === "unsupported") return false;
    const offsetClock = new Date(instantMs + zone.minutes * 60_000).toISOString();
    return hour === Number(offsetClock.slice(11, 13)) &&
      minute === Number(offsetClock.slice(14, 16)) &&
      dateAppearsInEvidence(offsetClock.slice(0, 10), ` ${evidenceWords(section)} `);
  });
}

function eventEvidenceSections(markdown: string, title: string): string[] {
  const lines = markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .split(/\r?\n/);
  const sections: string[] = [];
  let card: string[] = [];
  let cardKind: "heading" | "list" | null = null;
  let listIndent = 0;

  const flush = () => {
    const joined = card.join(" ");
    const unambiguousDate = (value: string) => {
      const dates = statedDates(value);
      return dates.every((date, index) => dates.slice(index + 1).every((other) => sameStatedDay(date, other)));
    };
    for (const clause of joined.split(";")) {
      if (clause.trim() && unambiguousDate(clause)) sections.push(clause.trim());
    }
    card = [];
    cardKind = null;
  };

  for (const line of lines) {
    const content = line.trim();
    if (!content) {
      if (cardKind === null) flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(content);
    if (heading) {
      flush();
      const headingText = heading[2] ?? "";
      if (heading[1] === "#") {
        card = [headingText];
        flush();
      } else if (evidenceWords(headingText) === evidenceWords(title)) {
        card = [headingText];
        cardKind = "heading";
      }
      continue;
    }

    const list = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      flush();
      card = [list[2] ?? ""];
      cardKind = "list";
      listIndent = (list[1] ?? "").length;
      continue;
    }

    if (cardKind === "heading" || (cardKind === "list" && line.length - line.trimStart().length > listIndent)) {
      card.push(content);
    } else {
      flush();
      card = [content];
      flush();
    }
  }
  flush();
  return sections;
}

function groundedEvent(raw: RawContextDevEvent, markdown: string): RawContextDevEvent | null {
  if (!nonEmptyString(raw.title) || !nonEmptyString(raw.placeName)) return null;
  const sections = eventEvidenceSections(markdown, raw.title);
  const title = evidenceWords(raw.title);
  const place = evidenceWords(raw.placeName);
  const date = nonEmptyString(raw.startsAt)
    ? raw.startsAt.trim().slice(0, 10)
    : nonEmptyString(raw.startsDate) ? raw.startsDate.trim() : "";
  const instant = nonEmptyString(raw.startsAt) ? toIsoInstant(raw.startsAt) : null;
  const kind = nonEmptyString(raw.kind) ? raw.kind.trim() : "";
  const rawSection = sections.find((candidate) => {
    const words = ` ${evidenceWords(candidate)} `;
    if (!words.includes(` ${title} `) || !words.includes(` ${place} `)) return false;
    if (instant) {
      if (!timeAppearsInEvidence(instant, candidate)) return false;
    } else if (!dateAppearsInEvidence(date, words) || Array.from(candidate.matchAll(STATED_CLOCK)).length > 0) return false;
    if (kind === "music" && !/\b(music|gig|concert|open mic|dj|band|live)\b/.test(words)) return false;
    if (kind === "sport" && !/\b(sport|football|rugby|cricket|match|game|fixture)\b/.test(words)) return false;
    return true;
  });
  if (!rawSection) return null;
  const price = parseGbpFromText(raw.priceText);
  const ticketPrices = Array.from(rawSection.matchAll(/\b(?:tickets?|entry|admission|price)\s*(?:from|at|:|costs?)?\s*(£\s*\d+(?:\.\d{1,2})?(?!\d|[.,]\d))/gi));
  const sourceId = nonEmptyString(raw.sourceId) ? raw.sourceId.trim() : null;
  const publisherIds = Array.from(rawSection.matchAll(/\b(?:event\s+id|source\s*id)\s*[:=#]\s*([\w-]+)(?=$|[\s,;]|[.!?](?:\s|$))/gi));

  return {
    ...raw,
    priceText: nonEmptyString(raw.priceText) && rawSection.toLowerCase().includes(raw.priceText.trim().toLowerCase())
      && price !== null && ticketPrices.some((match) => parseGbpFromText(match[1]) === price)
      ? raw.priceText : undefined,
    sourceId: sourceId !== null && publisherIds.some((match) => match[1] === sourceId)
      ? raw.sourceId : undefined,
  };
}

function sourceCredit(source: HarvestSource): { label: string; url: string } {
  return {
    label: source.label,
    url: source.url,
  };
}

export function normaliseContextDevEventRow(
  raw: RawContextDevEvent,
  source: HarvestSource,
  opts: ContextDevNormaliseOpts,
): { row: Record<string, unknown> | null; drop?: ContextDevRowDrop } {
  if (!raw || typeof raw !== "object") return { row: null, drop: "noTitle" };

  const kind = nonEmptyString(raw.kind) ? raw.kind.trim() : "";
  if (!ALLOWED_KINDS.has(kind)) return { row: null, drop: "noKind" };

  const placeName = nonEmptyString(raw.placeName) ? raw.placeName.trim() : null;
  if (!placeName) return { row: null, drop: "noPlace" };

  const title = nonEmptyString(raw.title) ? raw.title.trim() : null;
  if (!title) return { row: null, drop: "noTitle" };

  // The scraped finder is the only page this call has actually read. A URL
  // supplied by JSON extraction is not evidence that its target exists or was
  // read, so credit the registered page even when an event URL is present.
  if (raw.sourceUrl !== undefined && raw.sourceUrl !== null && raw.sourceUrl !== "") {
    if (!samePublisherUrl(raw.sourceUrl, source)) {
      return { row: null, drop: "noUrl" };
    }
  }

  const startsAt = nonEmptyString(raw.startsAt) ? toIsoInstant(raw.startsAt) : null;
  const startsDate =
    startsAt === null && nonEmptyString(raw.startsDate) ? statedCalendarDate(raw.startsDate) : null;
  if (!startsAt && !startsDate) return { row: null, drop: "noStart" };

  const statedSourceId = nonEmptyString(raw.sourceId) ? raw.sourceId.trim() : null;
  const id = stableId(
    "events-cd",
    `${source.id}|${statedSourceId ?? title}|${placeName}|${startsAt ?? startsDate}`,
  );
  const row: Record<string, unknown> = {
    id,
    placeName,
    kind,
    title,
    source: sourceCredit(source),
    observedAt: opts.observedAt,
    confidence: "listed",
  };

  if (startsAt) row.startsAt = startsAt;
  else {
    row.startsDate = startsDate;
    row.timeEvidence = DATE_ONLY_TIME_EVIDENCE;
  }

  // A pub's own what's-on page rarely numbers its events, and a row with no
  // `sourceId` carries no `eventIdentityKey`, so the shared
  // `dedupeEventRowsBySourceId` waves it through untouched - a page listing one
  // event twice would publish two identical cards under one React key. The
  // row's own deterministic id is the identity when the publisher states none.
  // ONE predicate decides "did the publisher state an id", above and here: an
  // empty string answered YES to a bare `??` in the hash input and NO here, so
  // the title left the hash and two real listings collapsed into one.
  row.sourceId = statedSourceId ?? id;

  const priceGbp = parseGbpFromText(raw.priceText);
  if (priceGbp !== null) row.priceGbp = priceGbp;

  if (opts.resolveVenue && opts.venueIndex) {
    const venueId = opts.resolveVenue(opts.venueIndex, placeName, null, null);
    if (venueId) row.venueId = venueId;
  }

  return { row };
}

export function normaliseContextDevExtract(
  payload: ExtractPayload,
  source: HarvestSource,
  opts: ContextDevNormaliseOpts,
): { rows: Record<string, unknown>[]; dropped: EventDropCounts } {
  const dropped = emptyEventDrops();
  const rows: Record<string, unknown>[] = [];
  const events = Array.isArray(payload?.events) ? payload.events : [];

  for (const event of events) {
    const { row, drop } = normaliseContextDevEventRow(event, source, opts);
    if (row) rows.push(row);
    else if (drop) {
      dropped[drop] += 1;
      dropped.total += 1;
    }
  }

  return { rows, dropped };
}

export function contextDevLaneStatus(env: NodeJS.ProcessEnv = process.env): "configured" | "not-configured" {
  return isContextDevConfigured(env) ? "configured" : "not-configured";
}

// Rows this lane writes carry the SOURCE's own credit label, never "Context.dev",
// so a caller carrying held rows across a lane-level failure has to ask for these
// labels rather than naming the lane.
export function contextDevSourceLabels(): string[] {
  return Array.from(new Set(contextDevEventSources().map((source) => source.label)));
}

type ContextDevLaneFailure = {
  sourceId: string;
  label: string;
  message: string;
};

export type ContextDevLaneResult = {
  status: "not-configured" | "ran" | "failed";
  rows: Record<string, unknown>[];
  dropped: EventDropCounts;
  failures: ContextDevLaneFailure[];
  sourcesRun: Array<{ sourceId: string; label: string; rows: number }>;
};

export async function runContextDevEventsLane({
  observedAt,
  venueIndex = null,
  resolveVenue = null,
  env = process.env,
  callOptions = {},
  log = console.log,
  logError = console.error,
}: {
  observedAt: string;
  venueIndex?: unknown;
  resolveVenue?: ContextDevNormaliseOpts["resolveVenue"] | null;
  env?: NodeJS.ProcessEnv;
  callOptions?: ContextDevCallOptions;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}): Promise<ContextDevLaneResult> {
  const empty = {
    status: "not-configured" as const,
    rows: [],
    dropped: emptyEventDrops(),
    failures: [],
    sourcesRun: [],
  };

  if (!isContextDevConfigured(env)) {
    log("eventsRefresh: Context.dev lane not-configured (no CONTEXT_DEV_API_KEY).");
    return empty;
  }

  const sources = contextDevEventSources();
  if (sources.length === 0) {
    log("eventsRefresh: Context.dev lane has no allowed registered venue-events pages.");
    return { ...empty, status: "ran" };
  }

  // ONE budget for the whole lane, shared by every source and counting retries,
  // so the ceiling is what this run may put on the account rather than how many
  // pages it covers. A caller may hand its own in through callOptions.
  const budget = callOptions.budget ?? createContextDevBudget();
  const opts: ContextDevNormaliseOpts = { observedAt, venueIndex, resolveVenue: resolveVenue ?? undefined };
  const allRows: Record<string, unknown>[] = [];
  const dropped = emptyEventDrops();
  const failures: ContextDevLaneFailure[] = [];
  const sourcesRun: Array<{ sourceId: string; label: string; rows: number }> = [];

  for (const source of sources) {
    const result = await extract<ExtractPayload>(
      source.url,
      CONTEXT_DEV_EVENT_EXTRACT_SCHEMA,
      {
        ...callOptions,
        env,
        budget,
        instructions:
          "Extract upcoming pub and bar events only. Do not invent start times. " +
          "Use startsDate when the page states a day without a clock time.",
      },
    );

    if (result.status === "not-configured") {
      logError(
        "eventsRefresh: Context.dev lane became not-configured mid-run - " +
          "every source still to be asked is recorded as unread.",
      );
      for (const unread of sources.slice(sources.indexOf(source))) {
        failures.push({
          sourceId: unread.id,
          label: unread.label,
          message: "Context.dev key went absent mid-run.",
        });
      }
      break;
    }

    if (result.status === "error") {
      logError(
        `eventsRefresh: Context.dev extract failed for ${source.label} (${result.error.code}: ${result.error.message}) - held rows carry across.`,
      );
      failures.push({
        sourceId: source.id,
        label: source.label,
        message: result.error.message,
      });
      continue;
    }

    if (!samePublisherUrl(result.url, source)) {
      const message = "Extract ended outside the registered publisher host.";
      logError(`eventsRefresh: Context.dev ${source.label} ${message} Held rows carry across.`);
      failures.push({ sourceId: source.id, label: source.label, message });
      continue;
    }

    const events = result.data?.events;
    const grounded = Array.isArray(events)
      ? events.map((event) => normaliseContextDevEventRow(event, source, opts).row
        ? groundedEvent(event, result.markdown)
        : event).filter((event): event is RawContextDevEvent => event !== null)
      : [];
    const normalised = normaliseContextDevExtract({ events: grounded }, source, opts);
    normalised.dropped.ungrounded += Array.isArray(events) ? events.length - grounded.length : 0;
    normalised.dropped.total += Array.isArray(events) ? events.length - grounded.length : 0;
    mergeEventDrops(dropped, normalised.dropped);
    if (!Array.isArray(events) || normalised.rows.length === 0 || normalised.dropped.total > 0) {
      const message = !Array.isArray(events)
        ? "Extract returned no events array."
        : `Extract returned ${normalised.rows.length === 0 ? "no usable" : "incomplete"} event rows (dropped ${normalised.dropped.total}).`;
      logError(`eventsRefresh: Context.dev ${source.label} ${message} Held rows carry across.`);
      failures.push({ sourceId: source.id, label: source.label, message });
      continue;
    }
    allRows.push(...normalised.rows);
    sourcesRun.push({ sourceId: source.id, label: source.label, rows: normalised.rows.length });
    log(
      `eventsRefresh: Context.dev ${source.label} -> ${normalised.rows.length} rows ` +
        `(dropped ${normalised.dropped.total})`,
    );
  }

  return {
    status: failures.length === sources.length ? "failed" : "ran",
    rows: allRows,
    dropped,
    failures,
    sourcesRun,
  };
}

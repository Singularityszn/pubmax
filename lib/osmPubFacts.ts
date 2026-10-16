// What OpenStreetMap states about one pub, as a pub sheet prints it. The pack
// is data/osm/facts/london_pub_facts.json (ODbL), built from the committed raw
// Overpass chunks by scripts/build_osm_pub_facts.mjs and joined at runtime by
// OSM id (lib/osmPubFacts.server.ts).
//
// Three rules. (1) A tag OSM does not state is unknown: no line is printed for
// it, and a missing tag is never read as "no". A stated "no" is printed as
// stated. (2) Every printed fact carries its source and a day: the mapper's own
// check date when OSM has one, otherwise the day of the extract we read. (3)
// The hours are printed per day only when the whole string reads cleanly;
// otherwise the string is printed as OSM writes it, never a guessed table.

import { isHttpUrl } from "@/lib/httpUrl";
import { readOsmOpeningHours } from "@/lib/osmOpeningHours";
import type { WeeklyOpeningHours } from "@/lib/busyness";

const FACT_FIELDS = [
  "openingHours",
  "wheelchair",
  "liveSport",
  "outdoorSeating",
  "beerGarden",
  "realAle",
  "dog",
  "menuUrl",
  "facebook",
  "instagram",
  "twitter",
  "operator",
  "brand",
  "brewery",
] as const;

type OsmPubFactField = (typeof FACT_FIELDS)[number];

export type OsmPubFacts = Partial<Record<OsmPubFactField, string>> & {
  osmId: string;
  /** The planet day of the extract this row was read from, YYYY-MM-DD. */
  readOn: string;
  /** The mapper's `check_date`, as OSM states it. */
  checkDate?: string;
  /** The mapper's `check_date:opening_hours`, as OSM states it. */
  hoursCheckDate?: string;
};

const OSM_ID = /^(node|way|relation)\/\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CHECK_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
const MAX_VALUE_LENGTH = 300;

/** One pack row, or null when it is malformed or states no fact. */
export function osmPubFactsFromRow(row: unknown): OsmPubFacts | null {
  const record = row as Record<string, unknown> | null;
  if (!record || typeof record.osmId !== "string" || !OSM_ID.test(record.osmId)) return null;
  if (typeof record.readOn !== "string" || !DAY.test(record.readOn)) return null;
  const facts: OsmPubFacts = { osmId: record.osmId, readOn: record.readOn };
  let stated = false;
  for (const field of FACT_FIELDS) {
    const value = record[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) continue;
    facts[field] = trimmed;
    stated = true;
  }
  for (const field of ["checkDate", "hoursCheckDate"] as const) {
    const value = record[field];
    if (typeof value === "string" && CHECK_DATE.test(value.trim())) facts[field] = value.trim();
  }
  return stated ? facts : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2024-05-03` reads "3 May 2024", and a month-only check date `2024-05` reads "May 2024". */
function dayLabel(value: string): string | null {
  const match = CHECK_DATE.exec(value);
  if (!match) return null;
  const [, year = "", month = "", day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return null;
  if (day === undefined) return `${monthName} ${year}`;
  const dayNumber = Number(day);
  return dayNumber >= 1 && dayNumber <= 31 ? `${dayNumber} ${monthName} ${year}` : null;
}

/**
 * The day a fact is credited to. A mapper's check date says somebody checked
 * the pub on that day, so it reads "checked". Without one, the day is when we
 * read OpenStreetMap, so it reads "read" rather than claiming a check.
 */
function creditDay(checkDate: string | undefined, readOn: string): string {
  const checked = checkDate ? dayLabel(checkDate) : null;
  if (checked) return `checked ${checked}`;
  return `read ${dayLabel(readOn) ?? readOn}`;
}

type FactChip = { label: string; absent: boolean };

const CHIP_WORDS: Record<
  "wheelchair" | "liveSport" | "outdoorSeating" | "beerGarden" | "realAle" | "dog",
  { name: string; values: Record<string, FactChip> }
> = {
  wheelchair: {
    name: "Wheelchair access",
    values: {
      yes: { label: "Wheelchair accessible", absent: false },
      designated: { label: "Wheelchair accessible", absent: false },
      limited: { label: "Limited wheelchair access", absent: false },
      no: { label: "Not wheelchair accessible", absent: true },
    },
  },
  liveSport: {
    name: "Live sport",
    values: {
      yes: { label: "Shows live sport", absent: false },
      no: { label: "No live sport", absent: true },
    },
  },
  outdoorSeating: {
    name: "Outdoor seating",
    values: {
      yes: { label: "Outdoor seating", absent: false },
      garden: { label: "Outdoor seating in a garden", absent: false },
      sidewalk: { label: "Pavement seating", absent: false },
      pavement: { label: "Pavement seating", absent: false },
      terrace: { label: "Outdoor terrace", absent: false },
      no: { label: "No outdoor seating", absent: true },
    },
  },
  beerGarden: {
    name: "Beer garden",
    values: {
      yes: { label: "Beer garden", absent: false },
      no: { label: "No beer garden", absent: true },
    },
  },
  realAle: {
    name: "Real ale",
    values: {
      yes: { label: "Real ale", absent: false },
      no: { label: "No real ale", absent: true },
    },
  },
  dog: {
    name: "Dogs",
    values: {
      yes: { label: "Dogs welcome", absent: false },
      leashed: { label: "Dogs on a lead", absent: false },
      outside: { label: "Dogs outside only", absent: false },
      no: { label: "No dogs", absent: true },
    },
  },
};

/** A value we have no words for is printed as OSM states it, beside the tag's name. */
function chipFor(field: keyof typeof CHIP_WORDS, value: string | undefined): FactChip | null {
  if (!value) return null;
  const words = CHIP_WORDS[field];
  return words.values[value.toLowerCase()] ?? { label: `${words.name}: ${value}`, absent: false };
}

const SOCIAL_HOSTS = {
  facebook: { label: "Facebook", base: "https://www.facebook.com/" },
  instagram: { label: "Instagram", base: "https://www.instagram.com/" },
  twitter: { label: "X", base: "https://x.com/" },
} as const;

const HANDLE = /^@?([A-Za-z0-9._-]{1,80})$/;

/** A full http(s) URL as stated, or a bare handle on its own network. Anything else is dropped. */
function socialHref(field: keyof typeof SOCIAL_HOSTS, value: string | undefined): string | null {
  if (!value) return null;
  if (isHttpUrl(value)) return value;
  const handle = HANDLE.exec(value)?.[1];
  return handle ? `${SOCIAL_HOSTS[field].base}${handle}` : null;
}

/**
 * The breweries a `brewery` tag names. OSM writes `various` for a pub that
 * pours many breweries' beer, and some mappers write `yes`, which names no
 * brewery and is dropped. Several values are split on `;`.
 */
function breweryNames(value: string | undefined): string | null {
  if (!value) return null;
  const names = value
    .split(";")
    .map((name) => name.trim())
    .filter((name) => name && !/^(yes|no)$/i.test(name))
    .map((name) => (/^various$/i.test(name) ? "Various" : name));
  return names.length ? [...new Set(names)].join(", ") : null;
}

export type OsmPubFactsView = {
  /** Per-day hours when the whole string reads cleanly. A day it does not state is absent. */
  hours: WeeklyOpeningHours | null;
  /** The string as OSM writes it, when it does not read cleanly. */
  hoursRaw: string | null;
  hoursCredit: string;
  chips: FactChip[];
  links: { label: string; href: string }[];
  ownership: { label: string; value: string }[];
  credit: string;
};

/** What a sheet prints from one pub's OSM facts, or null when nothing is printable. */
export function osmPubFactsView(facts: OsmPubFacts | null | undefined): OsmPubFactsView | null {
  if (!facts) return null;
  const hours = facts.openingHours ? readOsmOpeningHours(facts.openingHours) : null;
  const hoursRaw = facts.openingHours && !hours ? facts.openingHours : null;
  const chips = (["wheelchair", "liveSport", "outdoorSeating", "beerGarden", "realAle", "dog"] as const)
    .map((field) => chipFor(field, facts[field]))
    .filter((chip): chip is FactChip => chip !== null);
  const links: { label: string; href: string }[] = [];
  if (facts.menuUrl && isHttpUrl(facts.menuUrl)) links.push({ label: "Menu", href: facts.menuUrl });
  for (const field of ["facebook", "instagram", "twitter"] as const) {
    const href = socialHref(field, facts[field]);
    if (href) links.push({ label: SOCIAL_HOSTS[field].label, href });
  }
  const ownership = ([
    ["Operator", facts.operator],
    ["Brand", facts.brand],
    ["Brewery", breweryNames(facts.brewery)],
  ] as const).flatMap(([label, value]) => (value ? [{ label, value }] : []));
  if (!hours && !hoursRaw && chips.length === 0 && links.length === 0 && ownership.length === 0) return null;
  return {
    hours,
    hoursRaw,
    hoursCredit: `OpenStreetMap hours, ${creditDay(facts.hoursCheckDate ?? facts.checkDate, facts.readOn)}`,
    chips,
    links,
    ownership,
    credit: `OpenStreetMap, ${creditDay(facts.checkDate, facts.readOn)}`,
  };
}

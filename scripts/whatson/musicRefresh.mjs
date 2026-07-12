// scripts/whatson/musicRefresh.mjs
//
// Pure generator for the What's-On MUSIC vertical (PRD_WHATS_ON B5, last of
// the four verticals). No fetching here: every function is a plain transform
// over a small, hand-curated, hand-verified residency list, so the whole
// module unit-tests offline. Orchestration (write output) lives in main()
// below, mirroring scripts/whatson/dealsRefresh.mjs / sportFixtures.mjs.
//
// GOVERNANCE — first-party, individually-verified residency nights ONLY:
//   Every entry in MUSIC_RESIDENCIES below is a weekly recurring live-music
//   night published on the PUB'S OWN website (never a listings/ticketing
//   aggregator — DesignMyNight, Songkick, Eventbrite etc. were used only to
//   discover candidate venues, then every candidate was re-verified against
//   the venue's own site before being included; several candidates found via
//   aggregators were DROPPED below precisely because the pub's own site
//   either didn't confirm a specific day/time or couldn't be reached — see
//   DROPPED CANDIDATES). No venue attribute in the existing datasets
//   (pint_prices_app_dataset.json's `live_music` field) carries any value —
//   every row it every pub is an empty string — so there is no first-party
//   structured signal to cross-reference the way sportFixtures.mjs does; this
//   vertical is entirely hand-seeded instead.
//
// SCOPE — why only two venues / six rows ship in this seed: PRD_WHATS_ON B5
// explicitly accepts thin coverage over invented coverage ("a dozen verified
// venues beats 200 invented"). A short pass across well-known London
// live-music pubs turned up many candidates whose OWN site either had no
// working page, no specific day/time (e.g. The Gladstone Arms: "gigs every
// Tuesday and Sunday" with no time; The Old Blue Last: "EVERY SUNDAY" jazz
// with no time), or only a biweekly slot (The Grafton NW5: "every other
// Thursday" acoustic night; The Betsey Trotwood: alternate-Thursday folk) —
// none of those honestly fit this vertical's weekly-recurrence contract, so
// none is included. Only Skehan's (Nunhead) and The Ivy House (Nunhead) had a
// fully-specified weekly day + start time confirmed on their own site at
// verification time (2026-07-12).
//
// DROPPED CANDIDATES (not included — see reasons above): The Gladstone Arms
// (thegladpub.co.uk) — day confirmed, no time. The Old Blue Last
// (theoldbluelast.com) — day confirmed, no time. The Grafton NW5
// (graftonkentishtown.co.uk) — biweekly, not weekly. The Betsey Trotwood
// (thebetsey.com) — biweekly, not weekly. Duke of Kendal
// (thedukeofkendal.co.uk) — site returned 404 on every path tried, could not
// re-verify the day/time reported by secondary sources. TAM Elephant & Castle
// (tam.tv) — the only day/time found on tam.tv was a stale dated 2023 event
// page, not a live recurring-schedule claim.
//
// RECURRENCE MODEL — same technique as the deals vertical: each row is "the
// next occurrence" of a weekly residency slot, computed DST-aware in
// Europe/London via nextWeeklyOccurrence (imported from quizParsers.mjs — same
// module the quiz + deals verticals already share). No endsAt: unlike a
// Wetherspoons deal day (a fixed 11:30-23:00 window stated by the chain),
// none of these residencies' own pages state how long the set runs — omitted
// rather than guessed.
//
// VENUE MATCHING: rows ship with no venueId and no lat/lng (never invented —
// neither residency's own page publishes coordinates, and there is no
// reliable venueGroupingKey cross-reference dataset for either pub the way
// dealsRefresh.mjs has for Wetherspoons). A later refresh can layer venueId on
// via lib/whatsOn.ts matchVenueId once a geocoded match is confirmed.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nextWeeklyOccurrence } from "./quizParsers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "music_london.json");

// Skehan's own "What's On" / "Live Music" pages, checked 2026-07-12: a full
// weekly programme with day + start time stated for every slot below (Friday
// alternates Karaoke/Rock'n'Roll, ambiguous, so it is NOT included).
export const SKEHANS_SOURCE = {
  label: "Skehan's — Live Music",
  url: "https://skehans.com/whats-on/",
};

// The Ivy House's own "What's On" page, checked 2026-07-12: "Jazz + Roasts
// Sundays" — a recurring Sunday-afternoon jazz session with roast dinners,
// 4pm start, free entry.
export const IVY_HOUSE_SOURCE = {
  label: "The Ivy House — What's On",
  url: "https://www.ivyhousenunhead.com/whats-on",
};

// Every entry MUST already be a currently-published, unambiguous weekly
// residency on the venue's own site — never a guessed day/time or a
// biweekly/alternating slot (see DROPPED CANDIDATES above). Add/remove/
// re-check on the periodic refresh.
export const MUSIC_RESIDENCIES = [
  {
    id: "skehans-monday-jam",
    placeName: "Skehan's",
    dayName: "Monday",
    startTime: "20:30",
    title: "Monday Jam Sessions",
    detail:
      "An inclusive jam session open to all patrons — bring your own instrument and join in, or just come to listen.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-tuesday-trad",
    placeName: "Skehan's",
    dayName: "Tuesday",
    startTime: "19:00",
    title: "Irish/English Trad Session",
    detail: "Traditional Irish and English music session, alternating performers every Tuesday.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-wednesday-jam",
    placeName: "Skehan's",
    dayName: "Wednesday",
    startTime: "20:00",
    title: "South London Jam",
    detail: "An eclectic mix of musicians getting together for a live jam.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-saturday-gig",
    placeName: "Skehan's",
    dayName: "Saturday",
    startTime: "21:00",
    title: "The Big Saturday Night Gig",
    detail: "Live music from Skehan's regular roster of musicians, into the night.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "skehans-sunday-folk",
    placeName: "Skehan's",
    dayName: "Sunday",
    startTime: "19:00",
    title: "Sunday Night Folk Sessions",
    detail: "Live folk music session.",
    source: SKEHANS_SOURCE,
  },
  {
    id: "ivyhouse-sunday-jazz",
    placeName: "The Ivy House",
    dayName: "Sunday",
    startTime: "16:00",
    title: "Jazz + Roasts Sundays",
    detail:
      "Live jazz band on the community pub's stage, paired with Sunday roasts. Free entry; booking recommended for food.",
    source: IVY_HOUSE_SOURCE,
  },
];

// ---------------------------------------------------------------------------
// Row building (pure)
// ---------------------------------------------------------------------------

// Build weekly music-residency rows (B1 row contract, confidence:"listed" — a
// first-party published programme, not a per-night confirmation that this
// exact lineup plays this exact week). A residency whose weekly slot cannot
// be resolved (malformed day/time) is dropped, never guessed.
export function buildMusicResidencyRows({ residencies, observedAt }) {
  const rows = [];
  for (const res of residencies ?? []) {
    const startsAt = nextWeeklyOccurrence(res?.dayName, res?.startTime, observedAt);
    if (!startsAt) continue;
    if (typeof res.placeName !== "string" || res.placeName.length === 0) continue;
    if (typeof res.id !== "string" || res.id.length === 0) continue;

    rows.push({
      id: `music-${res.id}`,
      placeName: res.placeName,
      kind: "music",
      startsAt,
      title: res.title,
      detail: res.detail,
      source: { ...res.source },
      observedAt,
      confidence: "listed",
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// ---------------------------------------------------------------------------
// main: write public/data/whats_on/music_london.json
// ---------------------------------------------------------------------------

function main() {
  const observedAt = new Date().toISOString();

  const rows = buildMusicResidencyRows({ residencies: MUSIC_RESIDENCIES, observedAt });

  // Fail closed: never let a silent regression (malformed day/time, dropped
  // entries) collapse the baseline to zero while main() still reports
  // success. The whole seed is small and hand-curated, so require every
  // residency to have resolved — with an --allow-empty escape hatch (mirrors
  // sportFixtures.mjs / dealsRefresh.mjs pattern) for the rare legitimate case
  // of a refresh that intentionally drops every entry pending re-verification.
  const allowEmpty = process.argv.includes("--allow-empty");
  if (rows.length === 0 && !allowEmpty) {
    console.error(
      `musicRefresh: aborting — generated 0 rows from ${MUSIC_RESIDENCIES.length} residency ` +
        `definition(s). Refusing to overwrite ${OUT_PATH} with an empty result. ` +
        "Pass --allow-empty to override.",
    );
    process.exitCode = 1;
    return;
  }
  if (rows.length < MUSIC_RESIDENCIES.length && !allowEmpty) {
    console.error(
      `musicRefresh: aborting — generated ${rows.length} row(s) from ` +
        `${MUSIC_RESIDENCIES.length} residency definition(s); at least one dropped ` +
        "(malformed day/time or missing placeName/id). Refusing to overwrite " +
        `${OUT_PATH} silently. Pass --allow-empty to override.`,
    );
    process.exitCode = 1;
    return;
  }

  const payload = {
    generatedAt: observedAt,
    kind: "music",
    region: "greater-london",
    sources: [
      {
        ...SKEHANS_SOURCE,
        firstParty: true,
        notes:
          "Skehan's own weekly live-music programme (checked 2026-07-12): " +
          "Monday Jam Sessions 20:30, Tuesday Trad Session 19:00, Wednesday " +
          "South London Jam 20:00, The Big Saturday Night Gig 21:00, Sunday " +
          "Night Folk Sessions 19:00. Friday alternates Karaoke/Rock'n'Roll — " +
          "not included (ambiguous which runs on a given week).",
      },
      {
        ...IVY_HOUSE_SOURCE,
        firstParty: true,
        notes:
          "The Ivy House's own 'Jazz + Roasts Sundays' — recurring Sunday " +
          "16:00 live jazz session, checked 2026-07-12.",
      },
    ],
    rows,
  };

  // Meta pretty-printed, rows one-per-line: reviewable diffs (mirrors
  // quizRefresh.mjs / sportFixtures.mjs / dealsRefresh.mjs).
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body);
  console.log(`wrote ${rows.length} music-residency rows -> ${OUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

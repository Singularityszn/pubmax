// scripts/whatson/sportFixtures.mjs
//
// Pure generator for the What's-On TIMED SPORT vertical (PRD_WHATS_ON B2,
// follow-on to the untimed sport_attributes.json rows). Crosses a small,
// hand-sourced fixture calendar against the Greene King "shows live sport"
// attribute rows (sport_attributes.json) to derive likely screening rows —
// kind:"sport", confidence:"derived" (lib/whatsOn.ts). No fetching here: every
// function is a plain transform so the whole module unit-tests offline.
// Orchestration (read attrs, write output) lives in main() below, invoked
// directly (mirrors quizRefresh.mjs / scrape_greene_king_sport.mjs, minus a
// live-fetch step — the fixture calendar is a static seed, not scraped).
//
// GOVERNANCE — why a static seed instead of scraping a fixture provider:
//   Wholesale scraping of a fixture/results database (livescore-style
//   aggregators, betting-odds sites, etc.) is exactly the "protected
//   database" scraping PRD_WHATS_ON forbids (see "Attributes" owner decision
//   + Guardrails). FIFA's own public match-schedule / match-centre pages are
//   the source for every fixture below; each entry cites its own match-centre
//   URL individually. A weekly refresh only has to hand-edit this file's
//   small SPORT_FIXTURES list — cheaper AND more honest than standing up a
//   scraper against a source that would need to be re-vetted for
//   permissibility every time the calendar moves on.
//
// SCOPE — why only two fixtures ship in this seed: squarely inside the FIFA
// World Cup 2026 knockout stage (11 Jun - 19 Jul 2026). The Premier League
// and Champions League are both off-season until August, so there is no
// competitive top-flight fixture to source honestly for the "next 2-3 weeks"
// window right now — padding the seed with preseason club friendlies (mostly
// overseas, odd UK kick-off hours, not reliably screened outside the club's
// own fanbase) would trade honesty for row count. The two World Cup
// semi-finals are the only fixtures in that window with a publicly fixed
// date + kickoff + venue that are also the kind of mass, prime-time,
// free-to-air broadcast a "shows live sport" pub actually screens. The next
// refresh should replace this list wholesale once the Premier League
// calendar resumes.
//
// VERIFIED 2026-07-12 (both quarter-finals played 2026-07-09/11, so both
// semi-final matchups are now decided — no placeholder teams remain):
//   SF1 (Match 101): France beat Morocco 2-0, Spain beat Belgium 2-1 —
//     France v Spain, AT&T Stadium, Dallas, Tue 14 Jul 2026, kickoff 2pm CT /
//     3pm ET / 20:00 BST London. Confirmed by FIFA match centre + independent
//     press (NBC Sports, Fox Sports, Sky Sports, kickoffclock.com) citing the
//     same 20:00 BST slot.
//   SF2 (Match 102): England beat Norway 2-1 (a.e.t.), Argentina beat
//     Switzerland 3-1 (a.e.t.) — England v Argentina, Mercedes-Benz Stadium,
//     Atlanta, Wed 15 Jul 2026, kickoff 3pm ET / 20:00 BST London. Confirmed
//     by FIFA match centre + independent press (NBC Sports, Fox Sports,
//     kickoffclock.com).
// Unknown != invented: had either quarter-final still been unresolved at
// refresh time, the pending leg would ship as "TBC" per row rather than a
// guessed team — see the DROPPED-FIXTURE / DIAGNOSTICS handling in
// buildSportFixtureRowsWithDiagnostics below for how an unresolved fixture is
// actually excluded from output (never emitted with a guessed value).
//
// CROSS-REFERENCE, NOT CONFIRMATION: a pub flagged "shows live sport" by
// Greene King is not thereby confirmed to screen any ONE specific fixture —
// hence confidence:"derived" rather than "listed"/"confirmed", and every
// row's `detail` says so in plain language. Both provenances (the per-venue
// Greene King screening fact AND the fixture's own FIFA match-centre source)
// are kept: the structured `source` field carries the venue-specific,
// verifiable Greene King page (matches the sport_attributes.json convention);
// the fixture's own source label + URL are cited in prose inside `detail`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ATTRS_PATH = join(ROOT, "public", "data", "whats_on", "sport_attributes.json");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "sport_fixtures.json");

// Generic schedule-index source, used for the payload-level `sources` list
// (overall provenance context). Each individual fixture below cites its OWN
// match-centre URL — more precise than pointing every fixture at the index.
const FIFA_SOURCE = {
  label: "FIFA World Cup 2026 match schedule",
  url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
};

// Hand-sourced, hand-refreshed fixture calendar (see SCOPE + VERIFIED above).
// Add or replace entries on the weekly refresh; every entry MUST already be a
// publicly confirmed date + kickoff + venue + team pairing, each individually
// re-verified against a live source at refresh time — never a guessed
// matchup or time carried over from a stale search result. Kickoffs are
// Europe/London wall-clock; londonWallClockToIso below resolves the correct
// BST/GMT instant (and rejects anything that isn't a real London wall-clock
// moment — see its own doc comment).
export const SPORT_FIXTURES = [
  {
    id: "wc2026-sf1-fra-esp",
    title: "France v Spain — FIFA World Cup Semi-Final",
    competition: "FIFA World Cup 2026",
    venue: "AT&T Stadium, Dallas",
    kickoffLondonDate: "2026-07-14",
    kickoffLondonTime: "20:00",
    source: {
      label: "FIFA match centre — France v Spain",
      url: "https://www.fifa.com/en/match-centre/match/17/285023/289290/400021541",
    },
  },
  {
    id: "wc2026-sf2-eng-arg",
    title: "England v Argentina — FIFA World Cup Semi-Final",
    competition: "FIFA World Cup 2026",
    venue: "Mercedes-Benz Stadium, Atlanta",
    kickoffLondonDate: "2026-07-15",
    kickoffLondonTime: "20:00",
    source: {
      label: "FIFA match centre — England v Argentina",
      url: "https://www.fifa.com/en/match-centre/match/17/285023/289290/400021540",
    },
  },
];

// ---------------------------------------------------------------------------
// URL validation (mirrors lib/whatsOn.ts isHttpUrl; reimplemented locally so
// this module stays a dependency-free, offline-testable plain transform —
// see the module doc comment above).
// ---------------------------------------------------------------------------

function isHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Europe/London wall-clock -> ISO instant (DST-aware; two-pass resolution,
// same technique as scripts/whatson/quizParsers.mjs nextWeeklyOccurrence).
// ---------------------------------------------------------------------------

// Reformat a UTC instant as its Europe/London wall-clock parts. Shared by the
// offset calculation and the round-trip validity check below.
function londonWallClockParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function londonOffsetMinutes(date) {
  const parts = londonWallClockParts(date);
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((wallAsUtc - date.getTime()) / 60_000);
}

const pad = (n) => String(n).padStart(2, "0");

// Resolve a Europe/London wall-clock date+time ("YYYY-MM-DD", "HH:MM") to an
// ISO instant carrying the correct offset for that calendar date (+01:00 in
// BST, +00:00 in GMT). Returns null (never guessed) when:
//   - the date/time doesn't parse as the expected shape;
//   - the calendar date doesn't exist (e.g. "2026-02-30" — JS Date's
//     rollover semantics would otherwise silently turn this into 2026-03-02);
//   - the wall-clock moment falls in the SPRING-FORWARD GAP (the ~1 hour that
//     is skipped when clocks jump forward, e.g. 01:30 on the last Sunday of
//     March in Europe/London) — no real offset reproduces that local time.
// AMBIGUOUS FALL-BACK HOUR: on the last Sunday of October, Europe/London
// clocks go back and the local hour 01:00-02:00 occurs twice (once BST, once
// GMT). This function does NOT reject that case (both instants are "real"
// wall-clock moments) — the two-pass resolution below deterministically picks
// the LATER of the two occurrences (the post-transition, GMT instant), which
// is verified by the same round-trip check used to reject the spring-forward
// gap. Callers that need the earlier (BST) occurrence of an ambiguous hour
// are not supported; none of this module's fixtures fall in that window.
export function londonWallClockToIso(dateStr, timeStr) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ""));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr ?? ""));
  if (!dm || !tm) return null;
  const [y, mo, da] = [Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])];
  const [hh, mm] = [Number(tm[1]), Number(tm[2])];
  if (hh > 23 || mm > 59) return null;

  // Two passes to land on the right offset around a DST switch.
  let offset = londonOffsetMinutes(new Date(Date.UTC(y, mo, da, hh, mm)));
  let instant = Date.UTC(y, mo, da, hh, mm) - offset * 60_000;
  offset = londonOffsetMinutes(new Date(instant));
  instant = Date.UTC(y, mo, da, hh, mm) - offset * 60_000;

  // Round-trip guard: reformat the computed instant back to Europe/London
  // wall-clock parts and require it to exactly match what was requested.
  // This is what actually rejects both a non-existent calendar date (the
  // instant lands on a different day/month than requested) and a
  // spring-forward gap time (the instant lands one hour later than
  // requested, since that wall-clock hour was skipped).
  const roundTrip = londonWallClockParts(new Date(instant));
  if (
    roundTrip.year !== y ||
    roundTrip.month !== mo + 1 ||
    roundTrip.day !== da ||
    roundTrip.hour !== hh ||
    roundTrip.minute !== mm
  ) {
    return null;
  }

  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${dm[1]}-${dm[2]}-${dm[3]}T${pad(hh)}:${pad(mm)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ---------------------------------------------------------------------------
// Cross-reference: fixtures x screening pubs -> derived WhatsOnRow[]
// ---------------------------------------------------------------------------

function slugFromAttrRowId(attrRow) {
  const slug = String(attrRow?.id ?? "").replace(/^sport-attr-gk-/, "");
  return slug.length > 0 ? slug : "pub";
}

// "2026-07-11T21:26:43.108Z" -> "2026-07-11" (best-effort; falls back to the
// raw string when unparsable so a bad upstream value is visible, not hidden).
function dateOnly(iso) {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : String(iso ?? "unknown date");
}

// Build derived sport-fixture rows (B1 row contract) for every (fixture,
// screening-pub) pair, PLUS skip diagnostics (never silent — see main()'s
// fail-closed check below). `attributeRows` are sport_attributes.json rows
// (kind:"sport", no startsAt); `fixtures` is SPORT_FIXTURES-shaped.
//
// A fixture is dropped entirely (never guessed) when its kickoff cannot be
// resolved OR its own source URL isn't a real absolute http(s) URL — either
// way, no row for that fixture would carry honest provenance. An individual
// (fixture, pub) pair is dropped when the attribute row lacks a usable
// placeName or a valid http(s) source URL.
export function buildSportFixtureRowsWithDiagnostics({ attributeRows, fixtures, observedAt }) {
  const rows = [];
  const droppedFixtures = [];
  const droppedAttributeRows = [];

  for (const fixture of fixtures ?? []) {
    const startsAt = londonWallClockToIso(fixture?.kickoffLondonDate, fixture?.kickoffLondonTime);
    const fixtureSourceUrl = fixture?.source?.url;
    const fixtureSourceLabel = fixture?.source?.label;
    if (!startsAt || !isHttpUrl(fixtureSourceUrl) || typeof fixtureSourceLabel !== "string" || fixtureSourceLabel.length === 0) {
      droppedFixtures.push({
        id: fixture?.id ?? "(unknown fixture id)",
        reason: !startsAt ? "unresolved kickoff" : "invalid or missing fixture.source",
      });
      continue;
    }

    for (const attrRow of attributeRows ?? []) {
      if (!attrRow || attrRow.kind !== "sport") continue;
      const placeName = attrRow.placeName;
      const sourceUrl = attrRow.source?.url;
      const validPlaceName = typeof placeName === "string" && placeName.length > 0;
      const validSourceUrl = isHttpUrl(sourceUrl);
      if (!validPlaceName || !validSourceUrl) {
        droppedAttributeRows.push({
          fixtureId: fixture.id,
          attrRowId: attrRow.id ?? placeName ?? "(unknown attribute row)",
          reason: !validPlaceName ? "missing placeName" : "missing/invalid source.url",
        });
        continue;
      }

      const row = {
        id: `sport-fixture-${fixture.id}-${slugFromAttrRowId(attrRow)}`,
        placeName,
        kind: "sport",
        startsAt,
        title: fixture.title,
        detail:
          `${placeName} is Greene King-listed as showing live sport ` +
          `(checked ${dateOnly(attrRow.observedAt)}) — screening of this SPECIFIC ` +
          `fixture is not confirmed by the venue. Fixture per ${fixtureSourceLabel} ` +
          `(${fixtureSourceUrl}): ${fixture.competition}, ${fixture.venue}, kickoff ` +
          `${fixture.kickoffLondonTime} London time.`,
        source: { label: "Greene King", url: sourceUrl },
        observedAt,
        confidence: "derived",
      };
      if (typeof attrRow.venueId === "string" && attrRow.venueId.length > 0) row.venueId = attrRow.venueId;
      if (typeof attrRow.lat === "number" && Number.isFinite(attrRow.lat)) row.lat = attrRow.lat;
      if (typeof attrRow.lng === "number" && Number.isFinite(attrRow.lng)) row.lng = attrRow.lng;
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { rows, diagnostics: { droppedFixtures, droppedAttributeRows } };
}

// Back-compat convenience wrapper: rows only, no diagnostics. Used by tests
// and by anything that doesn't need the fail-closed accounting main() does.
export function buildSportFixtureRows(args) {
  return buildSportFixtureRowsWithDiagnostics(args).rows;
}

// ---------------------------------------------------------------------------
// main: read sport_attributes.json, write public/data/whats_on/sport_fixtures.json
// ---------------------------------------------------------------------------

function main() {
  const observedAt = new Date().toISOString();

  let attrs;
  try {
    attrs = JSON.parse(readFileSync(ATTRS_PATH, "utf8"));
  } catch (err) {
    console.error(`sportFixtures: aborting — could not read/parse ${ATTRS_PATH}: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const attributeRows = Array.isArray(attrs?.rows) ? attrs.rows : [];
  const sportAttributeRows = attributeRows.filter((r) => r?.kind === "sport");

  if (sportAttributeRows.length === 0) {
    console.error(
      `sportFixtures: aborting — ${ATTRS_PATH} yielded zero kind:"sport" attribute rows ` +
        `(read ${attributeRows.length} total row(s)). Refusing to overwrite ${OUT_PATH} with an empty result.`,
    );
    process.exitCode = 1;
    return;
  }

  const { rows, diagnostics } = buildSportFixtureRowsWithDiagnostics({
    attributeRows,
    fixtures: SPORT_FIXTURES,
    observedAt,
  });

  if (diagnostics.droppedFixtures.length > 0) {
    for (const d of diagnostics.droppedFixtures) {
      console.warn(`sportFixtures: dropped fixture "${d.id}" — ${d.reason}`);
    }
  }
  if (diagnostics.droppedAttributeRows.length > 0) {
    console.warn(
      `sportFixtures: skipped ${diagnostics.droppedAttributeRows.length} (fixture, pub) pair(s) ` +
        `with missing/invalid placeName or source.url`,
    );
  }

  // Fail closed: never let a silent input regression (malformed kickoff
  // times, missing venue attributes, renamed input fields, etc.) collapse the
  // baseline down to zero or a sliver while main() still reports success.
  // Threshold is 50% of the naive fixtures x sport-pubs cross-product —
  // generous enough to tolerate a genuinely smaller fixture list or
  // attribute refresh, but not a systemic drop.
  const expected = SPORT_FIXTURES.length * sportAttributeRows.length;
  if (expected > 0 && rows.length < expected * 0.5) {
    console.error(
      `sportFixtures: aborting — generated ${rows.length} row(s), expected ~${expected} ` +
        `(${SPORT_FIXTURES.length} fixture(s) x ${sportAttributeRows.length} sport pub(s)). ` +
        `Refusing to overwrite ${OUT_PATH} with a suspiciously small result. ` +
        `${diagnostics.droppedFixtures.length} fixture(s) and ${diagnostics.droppedAttributeRows.length} ` +
        `attribute-row pair(s) were dropped — see warnings above.`,
    );
    process.exitCode = 1;
    return;
  }

  const payload = {
    generatedAt: observedAt,
    kind: "sport",
    sources: [
      FIFA_SOURCE,
      {
        label: "Greene King",
        url: "https://www.greeneking.co.uk/pubs/",
        firstParty: true,
        notes:
          "Screening-pub list is sport_attributes.json (pubs flagged " +
          '"sports":true). Rows here CROSS-REFERENCE that list against the ' +
          'fixture calendar above; confidence is "derived" because no pub ' +
          "confirms it will show any one specific match.",
      },
    ],
    fixtures: SPORT_FIXTURES,
    rows,
  };

  // Meta pretty-printed, rows one-per-line: reviewable diffs (mirrors
  // quizRefresh.mjs / scrape_greene_king_sport.mjs).
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body);
  console.log(`wrote ${rows.length} derived sport-fixture rows -> ${OUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

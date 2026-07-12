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
//   + Guardrails). FIFA's own public match-schedule page is the source for
//   every fixture below; each entry cites it individually. A weekly refresh
//   only has to hand-edit this file's small SPORT_FIXTURES list — cheaper AND
//   more honest than standing up a scraper against a source that would need
//   to be re-vetted for permissibility every time the calendar moves on.
//
// SCOPE — why only two fixtures ship in this seed: authored 2026-07-11/12,
// squarely inside the FIFA World Cup 2026 knockout stage (11 Jun - 19 Jul
// 2026). The Premier League and Champions League are both off-season until
// August, so there is no competitive top-flight fixture to source honestly
// for the "next 2-3 weeks" window right now — padding the seed with
// preseason club friendlies (mostly overseas, odd UK kick-off hours, not
// reliably screened outside the club's own fanbase) would trade honesty for
// row count. The two World Cup semi-finals are the only fixtures in that
// window with a publicly fixed date + kickoff + venue that are also the kind
// of mass, prime-time, free-to-air broadcast a "shows live sport" pub
// actually screens. The next refresh should replace this list wholesale once
// the Premier League calendar resumes.
//
// HONESTY ON THE UNRESOLVED SEMI-FINAL: SF2's second team (Argentina or
// Switzerland) could not be corroborated from available sources as of this
// seed's observedAt — rather than guess, the row ships as "England v TBC"
// with the pending leg named in `detail`. Unknown != invented.
//
// CROSS-REFERENCE, NOT CONFIRMATION: a pub flagged "shows live sport" by
// Greene King is not thereby confirmed to screen any ONE specific fixture —
// hence confidence:"derived" rather than "listed"/"confirmed", and every
// row's `detail` says so in plain language. Both provenances (the per-venue
// Greene King screening fact AND the FIFA fixture calendar) are kept: the
// structured `source` field carries the venue-specific, verifiable Greene
// King page (matches the sport_attributes.json convention); the fixture's
// own source label + url are cited in prose inside `detail`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ATTRS_PATH = join(ROOT, "public", "data", "whats_on", "sport_attributes.json");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "sport_fixtures.json");

const FIFA_SOURCE = {
  label: "FIFA World Cup 2026 match schedule",
  url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/schedule",
};

// Hand-sourced, hand-refreshed fixture calendar (see SCOPE above). Add or
// replace entries on the weekly refresh; every entry MUST already be a
// publicly confirmed date + kickoff + venue — never a guessed matchup or
// time. Kickoffs are Europe/London wall-clock; londonWallClockToIso below
// resolves the correct BST/GMT instant.
export const SPORT_FIXTURES = [
  {
    id: "wc2026-sf1-fra-esp",
    title: "France v Spain — FIFA World Cup Semi-Final",
    competition: "FIFA World Cup 2026",
    venue: "AT&T Stadium, Dallas",
    kickoffLondonDate: "2026-07-14",
    kickoffLondonTime: "20:00",
    source: FIFA_SOURCE,
  },
  {
    id: "wc2026-sf2-eng-tbc",
    title: "England v TBC (Argentina/Switzerland winner) — FIFA World Cup Semi-Final",
    competition: "FIFA World Cup 2026",
    venue: "Mercedes-Benz Stadium, Atlanta",
    kickoffLondonDate: "2026-07-15",
    kickoffLondonTime: "20:00",
    source: FIFA_SOURCE,
  },
];

// ---------------------------------------------------------------------------
// Europe/London wall-clock -> ISO instant (DST-aware; two-pass resolution,
// same technique as scripts/whatson/quizParsers.mjs nextWeeklyOccurrence).
// ---------------------------------------------------------------------------

function londonOffsetMinutes(date) {
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
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((wallAsUtc - date.getTime()) / 60_000);
}

const pad = (n) => String(n).padStart(2, "0");

// Resolve a Europe/London wall-clock date+time ("YYYY-MM-DD", "HH:MM") to an
// ISO instant carrying the correct offset for that calendar date (+01:00 in
// BST, +00:00 in GMT). Returns null on a malformed date/time (never guessed).
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
// screening-pub) pair. `attributeRows` are sport_attributes.json rows
// (kind:"sport", no startsAt); `fixtures` is SPORT_FIXTURES-shaped. A fixture
// whose kickoff cannot be resolved is skipped entirely (never guessed) rather
// than emitting rows with a fabricated time.
export function buildSportFixtureRows({ attributeRows, fixtures, observedAt }) {
  const rows = [];
  for (const fixture of fixtures) {
    const startsAt = londonWallClockToIso(fixture.kickoffLondonDate, fixture.kickoffLondonTime);
    if (!startsAt) continue;

    for (const attrRow of attributeRows ?? []) {
      if (!attrRow || attrRow.kind !== "sport") continue;
      const placeName = attrRow.placeName;
      const sourceUrl = attrRow.source?.url;
      if (typeof placeName !== "string" || placeName.length === 0) continue;
      if (typeof sourceUrl !== "string" || sourceUrl.length === 0) continue;

      const row = {
        id: `sport-fixture-${fixture.id}-${slugFromAttrRowId(attrRow)}`,
        placeName,
        kind: "sport",
        startsAt,
        title: fixture.title,
        detail:
          `${placeName} is Greene King-listed as showing live sport ` +
          `(checked ${dateOnly(attrRow.observedAt)}) — screening of this SPECIFIC ` +
          `fixture is not confirmed by the venue. Fixture per ${fixture.source.label}: ` +
          `${fixture.competition}, ${fixture.venue}, kickoff ${fixture.kickoffLondonTime} London time.`,
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
  return rows;
}

// ---------------------------------------------------------------------------
// main: read sport_attributes.json, write public/data/whats_on/sport_fixtures.json
// ---------------------------------------------------------------------------

function main() {
  const observedAt = new Date().toISOString();
  const attrs = JSON.parse(readFileSync(ATTRS_PATH, "utf8"));
  const attributeRows = Array.isArray(attrs?.rows) ? attrs.rows : [];
  const rows = buildSportFixtureRows({ attributeRows, fixtures: SPORT_FIXTURES, observedAt });

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

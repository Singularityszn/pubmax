// What a tenner buys in a Wetherspoon, and the one place that answer is read.
//
// THE FIGURE IS SOMEBODY ELSE'S AND THE PACK SAYS SO. Every row here comes
// from SpoonMe's ranking of UK Wetherspoon pubs by the alcohol units the
// cheapest £10 basket holds (Oliver Clegg, 30 August 2026). We did not measure
// it and we could not: our own Wetherspoon directory carries no drink prices,
// because the chain publishes none on the web (lib/wetherspoons.ts records the
// probe at length), and the UK price bundle carries no drink name, no serving
// size and no strength on any of its rows. Units need all three. So this lane
// is credited and linked wherever it is printed, and it may never wear the
// authority a price of ours wears.
//
// WHAT WE DO OWN IS THE ARITHMETIC. scripts/spoonme/import-report.mjs re-costs
// every basket from its own lines, re-adds every unit, re-checks the £10
// ceiling and recomputes the whole rank order before a row is written. A row
// whose own numbers disagree is quarantined rather than repaired. 805 of 805
// rows held and 805 of 805 ranks agreed on the imported edition.
//
// THIS IS NOT A PRICE LANE. Nothing here reaches pin price colour, the
// cheapest-pint buckets, a price band, a trust standing or the Pint Index. A
// basket cost is a basket cost: it is not a pint price and is never painted as
// one. `__tests__/spoonsValue.test.ts` holds the fence.
//
// PURE and browser-safe: this module imports two leaves (the shared band class
// family and the URL reader) and nothing else, so a bundle that needs the word
// "units" pulls no venue index behind it.

import type { Route } from "next";
import { firstHttps } from "@/lib/httpUrl";
import { priceBandClass, type PriceBand } from "@/lib/priceBand";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** One drink on a pub's best-value round. */
export type SpoonsValueLine = Readonly<{
  name: string;
  servingLabel: string;
  quantity: number;
  glasses: number;
  linePricePence: number;
  lineMilliunits: number;
  bundleLabel?: string;
}>;

/** One pub, as the imported edition holds it. */
export type SpoonsValueRow = Readonly<{
  spoonmeId: string;
  name: string;
  town: string;
  addressLine: string;
  postcode: string;
  county: string;
  country: string;
  airport: boolean;
  londonZ12: boolean;
  /** Units x 1000, so the whole lane stays in integers. */
  milliunits: number;
  /** What the round costs, in pence. Always at or under the budget. */
  pence: number;
  drinkCount: number;
  lines: readonly SpoonsValueLine[];
  /** Our own rank, recomputed from the units. Ties share a rank. */
  rankNumber: number;
  /** The rank the source published, kept so the two can be compared. */
  sourceRankNumber: number;
  /** The map pin this pub was joined to, or null when none was found. */
  venueId: string | null;
  venueMatch?: Readonly<{ metres: number; nameScore: number }>;
  lat: number | null;
  lng: number | null;
  checkedAt: string;
}>;

export type SpoonsValueCredit = Readonly<{
  title: string;
  author: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: string;
  retrievedAt: string;
  licence: string;
}>;

export type SpoonsValuePack = Readonly<{
  version: number;
  provenance: SpoonsValueCredit;
  budgetPence: number;
  count: number;
  rows: readonly SpoonsValueRow[];
}>;

/** The slim lane the map fetches when the lens is switched on. */
export type SpoonsValueMapPub = Readonly<{
  venueId: string;
  milliunits: number;
  pence: number;
  rankNumber: number;
}>;

// ---------------------------------------------------------------------------
// Parsing. A malformed body reads as absent, never as an empty ranking.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function parseLine(value: unknown): SpoonsValueLine | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  if (typeof value.servingLabel !== "string") return null;
  if (!finiteInt(value.quantity) || value.quantity <= 0) return null;
  if (!finiteInt(value.glasses) || value.glasses < 0) return null;
  if (!finiteInt(value.linePricePence) || value.linePricePence < 0) return null;
  if (!finiteInt(value.lineMilliunits) || value.lineMilliunits <= 0) return null;
  return {
    name: value.name,
    servingLabel: value.servingLabel,
    quantity: value.quantity,
    glasses: value.glasses,
    linePricePence: value.linePricePence,
    lineMilliunits: value.lineMilliunits,
    ...(typeof value.bundleLabel === "string" ? { bundleLabel: value.bundleLabel } : {}),
  };
}

function parseRow(value: unknown): SpoonsValueRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.spoonmeId !== "string" || value.spoonmeId === "") return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  if (!finiteInt(value.milliunits) || value.milliunits <= 0) return null;
  if (!finiteInt(value.pence) || value.pence <= 0) return null;
  if (!finiteInt(value.rankNumber) || value.rankNumber <= 0) return null;
  if (!Array.isArray(value.lines)) return null;
  const lines: SpoonsValueLine[] = [];
  for (const raw of value.lines) {
    const line = parseLine(raw);
    if (!line) return null;
    lines.push(line);
  }
  if (lines.length === 0) return null;
  return {
    spoonmeId: value.spoonmeId,
    name: value.name,
    town: typeof value.town === "string" ? value.town : "",
    addressLine: typeof value.addressLine === "string" ? value.addressLine : "",
    postcode: typeof value.postcode === "string" ? value.postcode : "",
    county: typeof value.county === "string" ? value.county : "",
    country: typeof value.country === "string" ? value.country : "",
    airport: value.airport === true,
    londonZ12: value.londonZ12 === true,
    milliunits: value.milliunits,
    pence: value.pence,
    drinkCount: finiteInt(value.drinkCount) ? value.drinkCount : lines.length,
    lines,
    rankNumber: value.rankNumber,
    sourceRankNumber: finiteInt(value.sourceRankNumber)
      ? value.sourceRankNumber
      : value.rankNumber,
    venueId: typeof value.venueId === "string" && value.venueId !== "" ? value.venueId : null,
    ...(isRecord(value.venueMatch) &&
    typeof value.venueMatch.metres === "number" &&
    typeof value.venueMatch.nameScore === "number"
      ? { venueMatch: { metres: value.venueMatch.metres, nameScore: value.venueMatch.nameScore } }
      : {}),
    lat: typeof value.lat === "number" ? value.lat : null,
    lng: typeof value.lng === "number" ? value.lng : null,
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : "",
  };
}

function parseCredit(value: unknown): SpoonsValueCredit | null {
  if (!isRecord(value)) return null;
  const fields = ["title", "author", "publisher", "sourceUrl", "publishedAt", "retrievedAt", "licence"] as const;
  for (const field of fields) {
    if (typeof value[field] !== "string" || (value[field] as string).trim() === "") return null;
  }
  // A CREDIT URL IS AN https URL. Three surfaces render `sourceUrl` as an
  // `href`, so a string that is not an https address is not a credit: it is a
  // link this lane would ask a reader to follow on our word. The check runs
  // here as well as in the importer, because the pack is a committed file and
  // a file can be older than the rule that wrote it.
  if (firstHttps(value.sourceUrl as string) === "") return null;
  return {
    title: value.title as string,
    author: value.author as string,
    publisher: value.publisher as string,
    sourceUrl: value.sourceUrl as string,
    publishedAt: value.publishedAt as string,
    retrievedAt: value.retrievedAt as string,
    licence: value.licence as string,
  };
}

/**
 * Read a pack body, or null. A credit that will not parse fails the WHOLE pack
 * rather than costing a line of small print: a figure this lane cannot credit
 * is a figure it may not print.
 */
export function parseSpoonsValuePack(value: unknown): SpoonsValuePack | null {
  if (!isRecord(value)) return null;
  if (!finiteInt(value.budgetPence) || value.budgetPence <= 0) return null;
  const provenance = parseCredit(value.provenance);
  if (!provenance) return null;
  if (!Array.isArray(value.rows)) return null;
  const rows: SpoonsValueRow[] = [];
  for (const raw of value.rows) {
    const row = parseRow(raw);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return null;
  return {
    version: finiteInt(value.version) ? value.version : 1,
    provenance,
    budgetPence: value.budgetPence,
    count: rows.length,
    rows,
  };
}

/** Read the slim map lane, or an empty list. Rows are `[id, mu, pence, rank]`. */
export function parseSpoonsValueMapLane(value: unknown): SpoonsValueMapPub[] {
  if (!isRecord(value) || !Array.isArray(value.pubs)) return [];
  const out: SpoonsValueMapPub[] = [];
  for (const raw of value.pubs) {
    if (!Array.isArray(raw) || raw.length !== 4) continue;
    const [venueId, milliunits, pence, rankNumber] = raw;
    if (typeof venueId !== "string" || venueId === "") continue;
    if (!finiteInt(milliunits) || milliunits <= 0) continue;
    if (!finiteInt(pence) || pence <= 0) continue;
    if (!finiteInt(rankNumber) || rankNumber <= 0) continue;
    out.push({ venueId, milliunits, pence, rankNumber });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The band, and why it is not a tercile
// ---------------------------------------------------------------------------

/**
 * THE BAND IS CUT AGAINST THE ROUND MOST PUBS POUR, AND TERCILES WERE MEASURED
 * AND REJECTED.
 *
 * The price-band law cuts a city's pints into thirds because their prices are
 * spread across a range. These figures are not: 488 of the 805 pubs, 60.6 per
 * cent, hand over exactly the same round, so the first and second terciles are
 * BOTH 12.785 units and a tercile band cannot cut this distribution at all
 * (`__tests__/spoonsValue.test.ts` runs `priceBandThresholdsFrom` over the
 * shipped figures and proves it). Forcing one would paint the pub most people
 * walk into the same colour as the worst pub in the country.
 *
 * So the threshold is the MODAL round, the report's own headline finding, and
 * it is DERIVED from the shipped rows rather than typed. Three bands with three
 * real populations: 189 pubs above it, 488 on it, 128 below.
 */
export const SPOONS_VALUE_BANDS = ["above", "typical", "below"] as const;
export type SpoonsValueBand = (typeof SPOONS_VALUE_BANDS)[number];

/** The units the most pubs hand over for the budget, or null over no rows. */
export function modalMilliunits(rows: readonly { milliunits: number }[]): number | null {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.milliunits, (counts.get(row.milliunits) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    // A tie goes to the larger round, so the threshold can never be flattered
    // by picking the meaner of two equally common answers.
    if (count > bestCount || (count === bestCount && best !== null && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The band a figure falls into. Null for no figure and null for no threshold. */
export function spoonsValueBand(
  milliunits: number | null | undefined,
  modal: number | null | undefined,
): SpoonsValueBand | null {
  if (typeof milliunits !== "number" || !Number.isFinite(milliunits) || milliunits <= 0) {
    return null;
  }
  if (typeof modal !== "number" || !Number.isFinite(modal) || modal <= 0) return null;
  if (milliunits > modal) return "above";
  if (milliunits === modal) return "typical";
  return "below";
}

/**
 * The band's hue, taken from the ONE class family a band paints with
 * (`priceBandClass`). More for your money is the green end, less is the red
 * end, which is the same direction a cheap pint already reads in, so a reader
 * does not have to learn a second colour language.
 *
 * The mapping is a table rather than a cast so the two vocabularies stay
 * separate: this lane owns its own words, and only the hue is shared.
 */
const BAND_HUE: Readonly<Record<SpoonsValueBand, PriceBand>> = {
  above: "cheap",
  typical: "average",
  below: "expensive",
};

export function spoonsValueBandClass(band: SpoonsValueBand | null | undefined): string {
  return band ? priceBandClass(BAND_HUE[band]) : "";
}

/** The map's numeric vocabulary for the same answer: 0 best, 3 no figure. */
export function spoonsValueBucket(band: SpoonsValueBand | null | undefined): 0 | 1 | 2 | 3 {
  switch (band) {
    case "above":
      return 0;
    case "typical":
      return 1;
    case "below":
      return 2;
    default:
      return 3;
  }
}

export function spoonsValueBandLabel(band: SpoonsValueBand): string {
  switch (band) {
    case "above":
      return "More than most";
    case "typical":
      return "The usual round";
    case "below":
      return "Less than most";
  }
}

/** The legend line, carrying the number the band was cut at. */
export function spoonsValueBandLegendLabel(band: SpoonsValueBand, modal: number): string {
  const units = formatUnits(modal);
  switch (band) {
    case "above":
      return `More than ${units}`;
    case "typical":
      return units;
    case "below":
      return `Less than ${units}`;
  }
}

/**
 * The map key's own row for one band: the line a reader sees beside the swatch
 * on the map, and the short code that rides in front of it.
 *
 * The words live HERE rather than in `lib/mapPriceLegend.ts` for the reason the
 * control's words do: this lane owns its vocabulary, and only the hue is
 * shared. A map key row has to stand alone, so the line names the unit that the
 * control's own note carries in a sentence beside it.
 */
export function spoonsValueMapKeyRow(
  band: SpoonsValueBand,
  modal: number,
): Readonly<{ label: string; code: "More" | "Usual" | "Less" }> {
  const units = formatUnitsLabel(modal);
  switch (band) {
    case "above":
      return { label: `More than ${units}`, code: "More" };
    case "typical":
      return { label: units, code: "Usual" };
    case "below":
      return { label: `Less than ${units}`, code: "Less" };
  }
}

/** The map key's row for a pub the ranking says nothing about. */
export const SPOONS_VALUE_UNRANKED_KEY_LABEL = "Not in the ranking";

// ---------------------------------------------------------------------------
// Words and figures
// ---------------------------------------------------------------------------

/** Units to one decimal place. Never a bare number: units are not money. */
export function formatUnits(milliunits: number): string {
  return (milliunits / 1000).toFixed(1);
}

export function formatUnitsLabel(milliunits: number): string {
  return `${formatUnits(milliunits)} units`;
}

export function formatBasketCost(pence: number): string {
  const pounds = pence / 100;
  return `£${pounds.toFixed(2).replace(/\.00$/, "")}`;
}

const SERVING_PLURALS: Readonly<Record<string, string>> = {
  Pint: "pints",
  "Half pint": "half pints",
  "Third pint": "third pints",
  Can: "cans",
  Bottle: "bottles",
};

/** One line of a round, in the words a person would use ordering it. */
export function formatRoundLine(line: SpoonsValueLine): string {
  const plural = SERVING_PLURALS[line.servingLabel];
  if (!plural) {
    return line.quantity > 1 ? `${line.quantity} x ${line.name}` : line.name;
  }
  const serving = line.quantity === 1 ? plural.replace(/s$/, "") : plural;
  return `${line.quantity} ${serving} of ${line.name}`;
}

/** The whole round, as one phrase. */
function formatRound(row: SpoonsValueRow): string {
  return row.lines.map(formatRoundLine).join(" and ");
}

/**
 * The venue sheet's one line about this pub. Deliberately says what the round
 * IS and what it costs, so nothing on screen is a bare figure a reader could
 * mistake for the price of a pint.
 */
export function bestValueRoundLine(row: SpoonsValueRow): string {
  return `${formatRound(row)} for ${formatBasketCost(row.pence)}, ${formatUnitsLabel(row.milliunits)}`;
}

export const BEST_VALUE_ROUND_LABEL = "Best value round";

/** The lens's own name, on the control and in a sentence. */
export const SPOONS_VALUE_LENS_LABEL = "Spoons value";

/** What the figure IS, wherever a column or a row needs a head. */
export const SPOONS_VALUE_FIGURE_LABEL = "Units for £10";

export const SPOONS_VALUE_PAGE_TITLE = "What a tenner buys in a Wetherspoon";

/**
 * The line that rides every surface this lane touches. Voice rule 4: we do not
 * push anybody to drink more, and rule 7 says the swing goes at the pricing
 * rather than at the reader. So it states what the ranking is FOR and stops.
 */
export const SPOONS_VALUE_RESPONSIBLE_LINE =
  "This ranks what a tenner buys, not what to drink. Know your limits.";

/**
 * THE TABLE IS THE ANSWER, so the words in front of it are rationed to one
 * short paragraph. The first cut carried a Screen lede AND an opening
 * paragraph, and at 390x844 a reader met no listing at all before the consent
 * bar: the same defect /tonight was fixed for. What was cut is not lost, it is
 * row 1 of the table, which says it better.
 */
export function spoonsValueLede(
  lowestMilliunits: number,
  highestMilliunits: number,
  modal: number | null,
): string {
  const swing = `Same tenner, and the answer runs from ${formatUnits(lowestMilliunits)} units to ${formatUnits(highestMilliunits)}.`;
  const usual = modal === null ? "" : ` Most pubs pour ${formatUnits(modal)}.`;
  return `${swing}${usual} ${SPOONS_VALUE_RESPONSIBLE_LINE}`;
}

/** How the credit reads wherever an imported figure is printed. */
export function spoonsValueCreditLine(credit: SpoonsValueCredit): string {
  return `Ranking method after ${credit.publisher} by ${credit.author}`;
}

export const SPOONS_VALUE_NOT_OUR_FIGURE_LINE =
  "These figures are read off Wetherspoon menus by SpoonMe, not logged here.";

export const SPOONS_VALUE_NOT_AFFILIATED_LINE =
  "Neither we nor SpoonMe are connected to J D Wetherspoon plc.";

/**
 * What one pub's sheet holds about it, as GET /api/spoons-value answers it.
 *
 * `rankedCount` rides along so no surface types the size of the ranking in: a
 * number written into copy rots the day the edition is re-imported.
 */
export type SpoonsValueHeld = Readonly<{
  row: SpoonsValueRow;
  modalMilliunits: number | null;
  rankedCount: number;
  credit: SpoonsValueCredit;
}>;

/** Read one pub's answer, or null. A malformed body is an absent row. */
export function parseSpoonsValueHeld(value: unknown): SpoonsValueHeld | null {
  if (!isRecord(value)) return null;
  const row = parseRow(value.row);
  const credit = parseCredit(value.credit);
  if (!row || !credit) return null;
  if (!finiteInt(value.rankedCount) || value.rankedCount <= 0) return null;
  return {
    row,
    modalMilliunits: finiteInt(value.modalMilliunits) ? value.modalMilliunits : null,
    rankedCount: value.rankedCount,
    credit,
  };
}

// ---------------------------------------------------------------------------
// The map's own view of the lane
// ---------------------------------------------------------------------------

/**
 * What a pin needs to paint under this lens, and nothing else. Its own type
 * rather than the map lane's, so it is impossible for a basket cost to reach
 * the price stack `priceBucket` and every downstream price surface read: this
 * lane paints a bucket and a units label, and stamps NO price standing,
 * because a round somebody else costed is not a claim about this pub's pint.
 */
export type SpoonsValuePinLane = Readonly<{
  byVenueId: ReadonlyMap<string, { milliunits: number; pence: number }>;
  modalMilliunits: number | null;
}>;

export type SpoonsValuePin = Readonly<{
  /** 0 above the usual round, 1 on it, 2 below it, 3 not in the ranking. */
  bucket: 0 | 1 | 2 | 3;
  /** The pin's tag, or null for a pub this lane holds nothing about. */
  label: string | null;
}>;

/**
 * What the lens control knows. FOUR-WAY on purpose: a lane still being read and
 * a lane we could not read are different things to say, and neither of them is
 * a country with nothing ranked in it.
 */
export type SpoonsValueLensState = Readonly<{
  status: "off" | "loading" | "ready" | "empty" | "unavailable";
  modalMilliunits: number | null;
}>;

export const SPOONS_VALUE_LENS_OFF: SpoonsValueLensState = {
  status: "off",
  modalMilliunits: null,
};

/**
 * What the lens shows RIGHT NOW, from what the reader chose and what the read
 * came back with.
 *
 * OFF IS DERIVED rather than written back: switching the lens off is an answer
 * the state already holds, so nothing has to be un-set. Living here rather than
 * in the map component keeps one rule in one place and keeps a 300-branch
 * render function from growing two more.
 */
export function spoonsValueLensView(
  on: boolean,
  read: SpoonsValueLensState,
  lane: SpoonsValuePinLane | null,
): Readonly<{ lens: SpoonsValueLensState; lane: SpoonsValuePinLane | null }> {
  if (!on) return { lens: SPOONS_VALUE_LENS_OFF, lane: null };
  return { lens: read, lane };
}

/**
 * The state a toggle leaves behind. Switching ON owes the reader the wait, said
 * out loud; switching off owes them nothing.
 */
export function spoonsValueReadForToggle(next: boolean): SpoonsValueLensState {
  return next ? { status: "loading", modalMilliunits: null } : SPOONS_VALUE_LENS_OFF;
}

/** What one pin says under the lens. A pub outside the ranking says nothing. */
export function spoonsValuePinFor(
  lane: SpoonsValuePinLane,
  venueId: string,
): SpoonsValuePin {
  const held = lane.byVenueId.get(venueId);
  if (!held) return { bucket: 3, label: null };
  const band = spoonsValueBand(held.milliunits, lane.modalMilliunits);
  return { bucket: spoonsValueBucket(band), label: formatUnitsLabel(held.milliunits) };
}

// ---------------------------------------------------------------------------
// The ranking page's own view
// ---------------------------------------------------------------------------

/**
 * One row as the ranking page sends it to the browser: everything the table
 * prints and nothing else. The baskets are folded to one sentence on the
 * server, because 805 pubs of line rows is a payload a reader never sees.
 */
export type SpoonsValueTableRow = Readonly<{
  id: string;
  rank: number;
  name: string;
  town: string;
  county: string;
  country: string;
  airport: boolean;
  londonZ12: boolean;
  milliunits: number;
  pence: number;
  round: string;
  venueId: string | null;
}>;

export function toTableRow(row: SpoonsValueRow): SpoonsValueTableRow {
  return {
    id: row.spoonmeId,
    rank: row.rankNumber,
    name: row.name,
    town: row.town,
    county: row.county,
    country: row.country,
    airport: row.airport,
    londonZ12: row.londonZ12,
    milliunits: row.milliunits,
    pence: row.pence,
    round: formatRound(row),
    venueId: row.venueId,
  };
}

/**
 * The cuts the page offers, named once so the chips, the counts and the empty
 * line cannot disagree. `country` is expanded per country the pack holds, so
 * nothing here states a place the data does not.
 */
export type SpoonsValueCutId = "all" | "airports" | "london-zones" | `country:${string}`;

export type SpoonsValueCut = Readonly<{
  id: SpoonsValueCutId;
  label: string;
  count: number;
}>;

export function spoonsValueCuts(
  rows: readonly SpoonsValueTableRow[],
): SpoonsValueCut[] {
  const cuts: SpoonsValueCut[] = [{ id: "all", label: "Everywhere", count: rows.length }];
  const byCountry = new Map<string, number>();
  for (const row of rows) {
    if (!row.country) continue;
    byCountry.set(row.country, (byCountry.get(row.country) ?? 0) + 1);
  }
  for (const [country, count] of [...byCountry].sort((a, b) => b[1] - a[1])) {
    cuts.push({ id: `country:${country}`, label: country, count });
  }
  const zones = rows.filter((row) => row.londonZ12).length;
  if (zones > 0) cuts.push({ id: "london-zones", label: "London zones 1-2", count: zones });
  const airports = rows.filter((row) => row.airport).length;
  if (airports > 0) cuts.push({ id: "airports", label: "Airports", count: airports });
  return cuts;
}

export function applySpoonsValueCut(
  rows: readonly SpoonsValueTableRow[],
  cut: SpoonsValueCutId,
): SpoonsValueTableRow[] {
  if (cut === "all") return [...rows];
  if (cut === "airports") return rows.filter((row) => row.airport);
  if (cut === "london-zones") return rows.filter((row) => row.londonZ12);
  const country = cut.slice("country:".length);
  return rows.filter((row) => row.country === country);
}

/**
 * The one query that opens the map under this lens.
 *
 * A page whose whole subject is the units ranking may not hand a reader a map
 * that is not under it. Before this, every door off /spoons-value (the primary
 * and all 805 row links) landed on the ordinary pint map, and the only way into
 * the lens was the Drink lane menu, fourteen items down.
 *
 * It is a lens rather than a drink lane on purpose: this lane paints through its
 * own `spoonsBucket` property, never `bucket`, so no reader is ever told a green
 * pin means a cheap pint here.
 */
const SPOONS_VALUE_LENS_PARAM = "lens";
const SPOONS_VALUE_LENS_VALUE = "spoons";

/** Whether an arrival asked for the units lens. */
export function spoonsValueLensRequested(search: string): boolean {
  return (
    new URLSearchParams(search).get(SPOONS_VALUE_LENS_PARAM) === SPOONS_VALUE_LENS_VALUE
  );
}

/** Where the whole ranking opens on the map, under the lens it is about. */
export const SPOONS_VALUE_MAP_HREF =
  `/map?${SPOONS_VALUE_LENS_PARAM}=${SPOONS_VALUE_LENS_VALUE}` as const;

/** Where a ranked pub opens on the map, or null when no pin was joined to it. */
export function spoonsValueMapHref(row: SpoonsValueTableRow): Route | null {
  if (!row.venueId) return null;
  return `/map?sel=${encodeURIComponent(row.venueId)}&${SPOONS_VALUE_LENS_PARAM}=${SPOONS_VALUE_LENS_VALUE}`;
}

/** Where the map lane lives. The full edition is read on the server alone. */
export const SPOONS_VALUE_MAP_LANE_URL = "/data/spoonme/map.json";

/** The route the ranking is published at. */
export const SPOONS_VALUE_ROUTE = "/spoons-value";

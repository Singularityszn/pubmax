// THE DRY ROUND (launch review B4, "Dry January, what do I do with this app?").
//
// A crawl whose every stop lists an alcohol-free price, with that price and
// the pint price beside each other at every stop.
//
// FIVE RULES, each a test in __tests__/dryRound.test.tsx or
// __tests__/dryRoundGenerate.test.ts.
//
// 1. WORDS ON THE ONE GENERATION PATH. The planner chip adds "an alcohol-free
//    dry round" to the ask (dryRoundQuery), the way the £20 crawl adds its
//    budget. The generator reads "dry round" (isDryRoundAsk), makes the night
//    alcohol-free and keeps only pubs that list an alcohol-free price. There
//    is no second planner and no second field.
// 2. LISTED ONLY. The prices are the /near alcohol-free lane
//    (lib/nearCheapestAnything.server.ts): the reviewed drink publish and the
//    listed site-harvest rows, each with its publisher and its day. An
//    estimate never enters, and a pub with no listed price is never a stop.
// 3. TOO FEW IS SAID. An area with fewer listed pubs than stops gets a
//    sentence that names how many and which (dryRoundTooFewLine), never a
//    route padded with a pub that lists none.
// 4. BOTH FIGURES, EACH WITH ITS SOURCE. A stop prints its alcohol-free price
//    with the drink's own name, its measure or "Size not stated", its
//    publisher and its day, and the listed pint beside it or "No listed pint
//    price". A measure is never compared with another: a pub's figure is the
//    first stated measure in the closed order, and the ranking never reads it.
// 5. NAMED IN WORDS. Every string that names this says "alcohol-free" or "Dry
//    round", never "0.0" and never "zero" (docs/VOICE.md, "Name alcohol-free
//    choices in words"). A drink's own name from its source keeps its branded
//    wording. The fence reads string literals only, so this comment is not
//    copy.
//
// Pure and browser-safe: it imports one leaf and some types, because the
// describe-first chip reads it on /plan's first paint.

import type { Route } from "next";

import { DRINK_MEASURES, type DrinkMeasure } from "@/lib/drinkMeasure";
import type { NearDrinkRow } from "@/lib/nearCheapestAnything";

/** The chip's name, on the planner and on Tonight. */
export const DRY_ROUND_LABEL = "Dry round";

/** What the chip does, under the chip. */
export const DRY_ROUND_NOTE = "Only pubs that list an alcohol-free price, with the pint price beside it.";

/** The words the chip adds to an ask. "dry round" is what the generator reads. */
const DRY_ROUND_WORDS = "an alcohol-free dry round";

const DRY_ROUND_ASK = /\bdry[ -]round\b/i;

/** The address Tonight's door opens: the planner, with the Dry round on. */
const DRY_ROUND_PARAM = "dry";

/** True when an ask names a dry round. */
export function isDryRoundAsk(text: string | null | undefined): boolean {
  return typeof text === "string" && DRY_ROUND_ASK.test(text);
}

/** The words the chip adds, or the ask itself when it already names one. */
export function dryRoundQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed || isDryRoundAsk(trimmed)) return trimmed;
  return `${trimmed.replace(/[.,;\s]+$/, "")}, ${DRY_ROUND_WORDS}`;
}

/** True when a planner address asks for the Dry round on. */
export function dryRoundFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get(DRY_ROUND_PARAM) === "1";
  } catch {
    return false;
  }
}

/** The planner with the Dry round on, for a door on another surface. */
export function dryRoundPlanHref(src?: string): Route {
  const params = new URLSearchParams();
  params.set(DRY_ROUND_PARAM, "1");
  if (src) params.set("src", src);
  return `/plan?${params.toString()}`;
}

/** One pub's listed alcohol-free price, as the dry round prints it. */
export type DryRoundAlcoholFree = {
  priceGbp: number;
  /** The drink's own name from its source. */
  drinkLabel: string | null;
  /** The measure the source stated, or null for "Size not stated". */
  measure: DrinkMeasure | null;
  publisher: string | null;
  /** The day the price was read, `YYYY-MM-DD`, or null. */
  observedOn: string | null;
};

/** One pub's listed pint, beside the alcohol-free price. */
type DryRoundPint = {
  pence: number;
  publisher: string;
  /** The instant the pint was read at its source. */
  observedAt: string;
};

export type DryRoundStopPrices = {
  alcoholFree: DryRoundAlcoholFree;
  pint: DryRoundPint | null;
};

function measureRank(measure: DrinkMeasure | null): number {
  return measure === null ? DRINK_MEASURES.length : DRINK_MEASURES.indexOf(measure);
}

/**
 * One listed alcohol-free price per pub, from the lane's rows. The lane holds a
 * pub's cheapest row in EACH measure, and two measures are never compared, so
 * the pub's figure is its first stated measure in the closed order, then its
 * size-not-stated row. A tie in one measure goes to the lower price, then the
 * drink's name, so the answer never flips on row order.
 */
export function dryRoundListedPrices(rows: readonly NearDrinkRow[]): Map<string, DryRoundAlcoholFree> {
  const out = new Map<string, DryRoundAlcoholFree>();
  for (const [venueId, priceGbp, observedOn, publisher, drinkLabel, measure] of rows) {
    if (typeof venueId !== "string" || !venueId || typeof priceGbp !== "number"
      || !Number.isFinite(priceGbp) || priceGbp <= 0) continue;
    const next: DryRoundAlcoholFree = {
      priceGbp,
      drinkLabel: drinkLabel?.trim() || null,
      measure: measure ?? null,
      publisher: publisher?.trim() || null,
      observedOn: observedOn ?? null,
    };
    const held = out.get(venueId);
    const better = !held
      || measureRank(next.measure) < measureRank(held.measure)
      || (measureRank(next.measure) === measureRank(held.measure)
        && (next.priceGbp < held.priceGbp
          || (next.priceGbp === held.priceGbp && (next.drinkLabel ?? "") < (held.drinkLabel ?? ""))));
    if (better) out.set(venueId, next);
  }
  return out;
}

/**
 * The stops a dry round may use: the candidates with a listed alcohol-free
 * price, in the order they arrived, or the names of the few there are when
 * they cannot fill the stops asked for. Nothing is padded.
 */
export function dryRoundSelection<T extends { venue: { id: string; name: string } }>(
  candidates: readonly T[],
  listed: ReadonlyMap<string, unknown>,
  stopCount: number,
): { ok: true; candidates: T[] } | { ok: false; listedNames: string[] } {
  const kept = candidates.filter(({ venue }) => listed.has(venue.id));
  return kept.length >= stopCount
    ? { ok: true, candidates: kept }
    : { ok: false, listedNames: kept.map(({ venue }) => venue.name) };
}

function namesInWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The answer when an area has too few listed pubs for the stops asked for. */
export function dryRoundTooFewLine(input: {
  areaName: string;
  stopCount: number;
  listedNames: readonly string[];
}): string {
  const count = input.listedNames.length;
  if (count === 0) {
    return `No pub in ${input.areaName} lists an alcohol-free price yet, so there is no dry round to plan there. Try another area.`;
  }
  const verb = count === 1 ? "lists" : "list";
  const fewer = count === 1 ? "1 stop" : `${count} stops`;
  return `Only ${namesInWords(input.listedNames)} in ${input.areaName} ${verb} an alcohol-free price, too few for a ${input.stopCount}-stop dry round. Try ${fewer}, or another area.`;
}

/** The answer when the alcohol-free prices could not be read. A failed read is not an empty area. */
export const DRY_ROUND_UNREAD_LINE =
  "We could not read the alcohol-free prices just now, so we cannot plan a dry round. Try again.";

/** The answer when a kept pub lists no alcohol-free price. */
export const DRY_ROUND_ANCHOR_UNLISTED_LINE =
  "That pub lists no alcohol-free price, so it cannot be a dry round stop. Pick a pub that does, or plan without the dry round.";

/** The prices a generated dry round carries, as the wire holds them. */
export type DryRoundWire = {
  venues: { venueId: string; alcoholFree: DryRoundAlcoholFree; pint: DryRoundPint | null }[];
};

type PintEvidence = {
  pence: number | null;
  source: { label: string; observedAt: string } | null;
};

/**
 * The wire block for the stops and their alternatives: each pub's listed
 * alcohol-free price, and its listed pint only where the pint names its
 * publisher and its day.
 */
export function dryRoundWire(
  venueIds: readonly string[],
  listed: ReadonlyMap<string, DryRoundAlcoholFree>,
  pints: ReadonlyMap<string, PintEvidence>,
): DryRoundWire {
  const venues: DryRoundWire["venues"] = [];
  for (const venueId of new Set(venueIds)) {
    const alcoholFree = listed.get(venueId);
    if (!alcoholFree) continue;
    const evidence = pints.get(venueId);
    const pint = evidence && typeof evidence.pence === "number" && evidence.pence > 0 && evidence.source
      ? { pence: evidence.pence, publisher: evidence.source.label, observedAt: evidence.source.observedAt }
      : null;
    venues.push({ venueId, alcoholFree, pint });
  }
  return { venues };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 80;

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= TEXT_MAX ? value.trim() : null;
}

function cleanAlcoholFree(value: unknown): DryRoundAlcoholFree | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const price = row.priceGbp;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > 1_000) return null;
  const measure = row.measure === null || row.measure === undefined
    ? null
    : (DRINK_MEASURES as readonly unknown[]).includes(row.measure) ? row.measure as DrinkMeasure : undefined;
  if (measure === undefined) return null;
  const observedOn = typeof row.observedOn === "string" && DAY.test(row.observedOn) ? row.observedOn : null;
  return {
    priceGbp: price,
    drinkLabel: cleanText(row.drinkLabel),
    measure,
    publisher: cleanText(row.publisher),
    observedOn,
  };
}

function cleanPint(value: unknown): DryRoundPint | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const publisher = cleanText(row.publisher);
  if (!Number.isSafeInteger(row.pence) || (row.pence as number) <= 0 || (row.pence as number) > 100_000) return null;
  if (!publisher || typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) return null;
  return { pence: row.pence as number, publisher, observedAt: row.observedAt };
}

/** The wire block read defensively, by pub. Null when the route is not a dry round. */
export function cleanDryRoundPrices(value: unknown): Map<string, DryRoundStopPrices> | null {
  if (!value || typeof value !== "object") return null;
  const venues = (value as { venues?: unknown }).venues;
  if (!Array.isArray(venues)) return null;
  const out = new Map<string, DryRoundStopPrices>();
  for (const entry of venues.slice(0, 60)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const venueId = cleanText(row.venueId);
    const alcoholFree = cleanAlcoholFree(row.alcoholFree);
    if (!venueId || !alcoholFree) continue;
    out.set(venueId, { alcoholFree, pint: cleanPint(row.pint) });
  }
  return out;
}

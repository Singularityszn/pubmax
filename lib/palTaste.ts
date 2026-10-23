// The Pal's taste read, from their declared favourite drink and their own logs.
//
// A taste read is the person's OWN history said back to their Pal: the pubs
// they wrote in their diary, the drinks and prices they dropped, the vibes they
// tagged and the pubs they saved. It is never a fact about a pub. A price here
// is what this person usually paid, not what a pub charges tonight, and the
// agent is told so in the same line.
//
// It only says what the logs support. Every line has a floor of evidence, a
// read with too little behind it says nothing, and the empty read is null so
// the agent knows it has to ask instead of guess.
//
// Duty of care: nothing here counts consumption. A visit is one pub on one
// London day, however many drinks the person logged there.
//
// Pure leaf: no I/O, no Date.now(). The server reader is lib/palTaste.server.ts.

import { CONCIERGE_MOODS, type ConciergeMood } from "@/lib/concierge/rank";
import { cleanText } from "@/lib/textClean";

export type PalTasteDiaryInput = {
  venueId: string;
  venueName: string;
  /** London calendar day (YYYY-MM-DD). */
  visitedOn: string;
  rating: number | null;
};

export type PalTasteDropInput = {
  venueId: string;
  drink: string;
  /** Only a pint price counts toward the usual pint. */
  pintPriceGbp: number | null;
  vibeTags: readonly string[];
  /** London calendar day (YYYY-MM-DD). */
  day: string;
};

type PalTasteSavedInput = { venueId: string; venueName: string };

/** What the venue index knows about a pub: its reader name and its patch. */
export type PalTastePlace = { name: string; patch: string | null };

export type PalTasteInput = {
  favouriteDrink?: string | null;
  diary: readonly PalTasteDiaryInput[];
  drops: readonly PalTasteDropInput[];
  saved: readonly PalTasteSavedInput[];
  placeOf: (venueId: string) => PalTastePlace | null;
};

export type PalTaste = {
  /** The owner's explicit profile preference, not inferred from logged prices. */
  declaredDrink?: string;
  /** Distinct pub-days across the diary and drops. */
  visits: number;
  distinctPubs: number;
  lastVisit: { name: string; on: string; recordedPints?: Array<{ drink: string; priceGbp: number }> } | null;
  patches: string[];
  regulars: string[];
  loved: string[];
  notKeen: string[];
  drinks: string[];
  usualPintGbp: number | null;
  vibes: string[];
  /** Explorer: most visits are to a pub not seen before. Regular: a few locals. */
  style: "explorer" | "regular" | null;
  favouriteNight: string | null;
  /** Saved and not yet visited: real listed pubs the Pal may offer as a pick. */
  wishlist: string[];
};

const MAX_LIST = 3;
const MIN_VISITS_FOR_PATTERN = 4;
const MIN_PRICED_PINTS = 2;
const LOVED_RATING = 4;
const NOT_KEEN_RATING = 2;
const NAME_CAP = 60;
const DRINK_CAP = 40;
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function topCounted(counts: Counts, min = 1): string[] {
  return [...counts.values()]
    .filter((entry) => entry.count >= min)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last) || a.label.localeCompare(b.label))
    .slice(0, MAX_LIST)
    .map((entry) => entry.label);
}

function bump(counts: Counts, key: string, label: string, day: string): void {
  const hit = counts.get(key);
  if (hit) {
    hit.count += 1;
    if (day > hit.last) hit.last = day;
  } else {
    counts.set(key, { label, count: 1, last: day });
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

type Counts = Map<string, { label: string; count: number; last: string }>;
type NameOf = (venueId: string, fallback?: string) => string;

/** One visit per pub per London day, whichever surface logged it. */
function visitDaysOf(input: PalTasteInput): Array<{ venueId: string; day: string }> {
  const days = new Map<string, { venueId: string; day: string }>();
  const add = (venueId: string, day: string) => {
    if (venueId && DAY_PATTERN.test(day)) days.set(`${venueId}|${day}`, { venueId, day });
  };
  for (const entry of input.diary) add(entry.venueId, entry.visitedOn);
  for (const drop of input.drops) add(drop.venueId, drop.day);
  return [...days.values()];
}

function visitSignals(input: PalTasteInput, visitDays: Array<{ venueId: string; day: string }>, nameOf: NameOf) {
  const pubs: Counts = new Map();
  const patches: Counts = new Map();
  const weekdays: Counts = new Map();
  let last: { venueId: string; day: string } | null = null;
  for (const visit of visitDays) {
    const name = nameOf(visit.venueId, input.diary.find((entry) => entry.venueId === visit.venueId)?.venueName);
    if (!name) continue;
    bump(pubs, visit.venueId, name, visit.day);
    const patch = input.placeOf(visit.venueId)?.patch;
    if (patch) bump(patches, patch.toLocaleLowerCase("en-GB"), cleanText(patch, NAME_CAP), visit.day);
    const weekday = WEEKDAYS[new Date(`${visit.day}T12:00:00Z`).getUTCDay()];
    if (weekday) bump(weekdays, weekday, weekday, visit.day);
    if (!last || visit.day > last.day) last = visit;
  }
  const visits = [...pubs.values()].reduce((sum, entry) => sum + entry.count, 0);
  const lastVisit: PalTaste["lastVisit"] = last ? { name: pubs.get(last.venueId)?.label ?? "", on: last.day } : null;
  if (last && lastVisit) {
    const recorded = new Map<string, { drink: string; priceGbp: number }>();
    for (const drop of input.drops) {
      if (drop.venueId !== last.venueId || drop.day !== last.day) continue;
      const drink = cleanText(drop.drink, DRINK_CAP);
      const priceGbp = drop.pintPriceGbp;
      if (!drink || priceGbp === null || !Number.isFinite(priceGbp) || priceGbp <= 0) continue;
      recorded.set(`${drink.toLowerCase()}|${priceGbp}`, { drink, priceGbp });
    }
    if (recorded.size) lastVisit.recordedPints = [...recorded.values()].slice(0, MAX_LIST);
  }
  return { pubs, patches, weekdays, visits, lastVisit };
}

/** A pub's rating is the newest one the person gave it. */
function ratingSignals(input: PalTasteInput, nameOf: NameOf): { loved: string[]; notKeen: string[] } {
  const ratings = new Map<string, { rating: number; day: string; name: string }>();
  for (const entry of input.diary) {
    if (entry.rating === null || !Number.isFinite(entry.rating)) continue;
    const prior = ratings.get(entry.venueId);
    if (prior && prior.day >= entry.visitedOn) continue;
    const name = nameOf(entry.venueId, entry.venueName);
    if (name) ratings.set(entry.venueId, { rating: entry.rating, day: entry.visitedOn, name });
  }
  const byRating = [...ratings.values()].sort((a, b) => b.rating - a.rating || b.day.localeCompare(a.day));
  return {
    loved: byRating.filter((entry) => entry.rating >= LOVED_RATING).slice(0, MAX_LIST).map((entry) => entry.name),
    notKeen: byRating
      .filter((entry) => entry.rating <= NOT_KEEN_RATING)
      .reverse()
      .slice(0, 2)
      .map((entry) => entry.name),
  };
}

function dropSignals(drops: readonly PalTasteDropInput[]) {
  const drinks: Counts = new Map();
  const vibes: Counts = new Map();
  const pintPrices: number[] = [];
  for (const drop of drops) {
    const drink = cleanText(drop.drink, DRINK_CAP);
    if (drink) bump(drinks, drink.toLocaleLowerCase("en-GB"), drink, drop.day);
    for (const tag of drop.vibeTags) {
      const vibe = cleanText(tag, DRINK_CAP);
      if (vibe) bump(vibes, vibe, vibe, drop.day);
    }
    const price = drop.pintPriceGbp;
    if (price !== null && Number.isFinite(price) && price > 0) pintPrices.push(price);
  }
  return {
    drinks: topCounted(drinks),
    vibes: topCounted(vibes),
    usualPintGbp: pintPrices.length >= MIN_PRICED_PINTS ? Math.round(median(pintPrices) * 100) / 100 : null,
  };
}

function wishlistOf(input: PalTasteInput, visited: ReadonlySet<string>, nameOf: NameOf): string[] {
  const wishlist: string[] = [];
  for (const save of input.saved) {
    if (wishlist.length >= MAX_LIST) break;
    if (visited.has(save.venueId)) continue;
    const name = nameOf(save.venueId, save.venueName);
    if (name && !wishlist.includes(name)) wishlist.push(name);
  }
  return wishlist;
}

function styleOf(visits: number, distinctPubs: number): PalTaste["style"] {
  if (visits < MIN_VISITS_FOR_PATTERN) return null;
  const share = distinctPubs / visits;
  return share >= 0.6 ? "explorer" : share <= 0.4 ? "regular" : null;
}

function favouriteNightOf(weekdays: Counts, visits: number): string | null {
  if (visits < MIN_VISITS_FOR_PATTERN) return null;
  const top = [...weekdays.values()].sort((a, b) => b.count - a.count)[0];
  return top && top.count / visits >= 0.4 ? top.label : null;
}

/** Null when neither a declared drink nor usable logged signals are available. */
export function buildPalTaste(input: PalTasteInput): PalTaste | null {
  const declaredDrink = cleanText(input.favouriteDrink ?? "", DRINK_CAP);
  const nameOf: NameOf = (venueId, fallback = "") => cleanText(input.placeOf(venueId)?.name || fallback, NAME_CAP);
  const visitDays = visitDaysOf(input);
  const { pubs, patches, weekdays, visits, lastVisit } = visitSignals(input, visitDays, nameOf);
  const taste: PalTaste = {
    ...(declaredDrink ? { declaredDrink } : {}),
    visits,
    distinctPubs: pubs.size,
    lastVisit,
    patches: topCounted(patches),
    regulars: topCounted(pubs, 2),
    ...ratingSignals(input, nameOf),
    ...dropSignals(input.drops),
    style: styleOf(visits, pubs.size),
    favouriteNight: favouriteNightOf(weekdays, visits),
    wishlist: wishlistOf(input, new Set(visitDays.map((visit) => visit.venueId)), nameOf),
  };
  const empty =
    !taste.declaredDrink && taste.visits === 0 && taste.drinks.length === 0 && taste.vibes.length === 0 && taste.wishlist.length === 0;
  return empty ? null : taste;
}

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function shortDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function formatPalTastePrice(gbp: number): string {
  return `£${gbp.toFixed(2)}`;
}

const VOICES = {
  // A typed turn is the person's own message, so it speaks as them.
  first: { I: "I", i: "I", my: "my", My: "My", am: "am", have: "have" },
  // The voice recall answer is a tool result the agent reads about them.
  third: { I: "They", i: "they", my: "their", My: "Their", am: "are", have: "have" },
} as const;

/**
 * The taste read as lines for the agent, empty when there is no read: the
 * system prompt tells the agent that no taste lines means it has to ask.
 */
export function palTastePreamble(taste: PalTaste | null, voice: keyof typeof VOICES = "first"): string[] {
  if (!taste) return [];
  const w = VOICES[voice];
  const lines: string[] = [];
  if (taste.declaredDrink) lines.push(`- ${w.My} profile's favourite drink: ${taste.declaredDrink}. This is a preference ${w.i} entered, not evidence about a pub.`);
  if (taste.visits > 0 && taste.lastVisit?.name) {
    lines.push(
      `- ${w.I} ${w.have} logged ${taste.visits} ${taste.visits === 1 ? "visit" : "visits"} to ${taste.distinctPubs} ${taste.distinctPubs === 1 ? "pub" : "pubs"}, most recently ${taste.lastVisit.name} on ${shortDay(taste.lastVisit.on)}.`,
    );
    if (taste.lastVisit.recordedPints?.length) {
      const prices = taste.lastVisit.recordedPints.map((pint) => `${pint.drink} at ${formatPalTastePrice(pint.priceGbp)} a pint`);
      lines.push(`- At that visit ${w.i} recorded ${listed(prices)}. These are recorded prices, not a bill total or proof of what ${w.i} drank.`);
    }
  }
  if (taste.patches.length > 0) lines.push(`- ${w.My} usual patches: ${listed(taste.patches)}.`);
  if (taste.regulars.length > 0) lines.push(`- Pubs ${w.i} keep going back to: ${listed(taste.regulars)}.`);
  if (taste.loved.length > 0) lines.push(`- Pubs ${w.i} rated highest: ${listed(taste.loved)}.`);
  if (taste.notKeen.length > 0) lines.push(`- Pubs ${w.i} rated low, so do not push them: ${listed(taste.notKeen)}.`);
  if (taste.drinks.length > 0) lines.push(`- What ${w.i} usually drink: ${listed(taste.drinks)}.`);
  if (taste.usualPintGbp !== null) {
    lines.push(
      `- ${w.I} usually pay about ${formatPalTastePrice(taste.usualPintGbp)} a pint. That is ${w.my} habit, not a price at any pub.`,
    );
  }
  if (taste.vibes.length > 0) lines.push(`- Vibes ${w.i} tag ${w.my} pints with: ${listed(taste.vibes)}.`);
  if (taste.style === "explorer") lines.push(`- ${w.I} like trying somewhere new more than going back.`);
  if (taste.style === "regular") lines.push(`- ${w.I} stick to a few locals ${w.i} trust.`);
  if (taste.favouriteNight) lines.push(`- ${w.I} ${w.am} mostly out on ${taste.favouriteNight}.`);
  if (taste.wishlist.length > 0) lines.push(`- Saved but not tried yet: ${listed(taste.wishlist)}.`);
  if (lines.length === 0) return [];
  return [
    `What ${w.my} ${taste.declaredDrink ? "profile and own logs" : "own logs"} say about ${w.my} taste. It is ${w.my} history, never a fact about a pub or tonight's price:`,
    ...lines,
  ];
}

const VIBE_MOODS: Record<string, { mood: ConciergeMood; said: string }> = {
  "quiet pint": { mood: "quiet", said: "the quiet pints you log" },
  "old local": { mood: "heritage", said: "the old locals you log" },
  "date night": { mood: "date", said: "your date nights" },
  riverside: { mood: "riverside", said: "the riverside pints you log" },
  chaotic: { mood: "lively", said: "the chaotic nights you log" },
};

export type PalTasteAsk = {
  /** An ask the deterministic router reads: area, mood and budget words it already knows. */
  query: string;
  /** One line saying which of their habits the pick leaned on. */
  because: string;
};

/**
 * A search the keyless path can run when an ask names no area, mood or budget,
 * built only from the person's own read. Null when the read has no patch and
 * no mood to lean on, so the caller still asks.
 */
export function palTasteAsk(taste: PalTaste | null, knownAreas: readonly string[]): PalTasteAsk | null {
  if (!taste) return null;
  const known = new Set(knownAreas.map((area) => area.toLocaleLowerCase("en-GB")));
  const area = taste.patches.find((patch) => known.has(patch.toLocaleLowerCase("en-GB")));
  const lean = taste.vibes
    .map((vibe) => VIBE_MOODS[vibe])
    .find((value) => value !== undefined && CONCIERGE_MOODS.includes(value.mood));
  const mood = lean?.mood;
  if (!area && !mood) return null;
  const cap = taste.usualPintGbp !== null ? Math.ceil(taste.usualPintGbp) : null;
  const query = [mood ? `${mood} pub` : "pub", area ? `in ${area}` : "", cap ? `under £${cap}` : ""]
    .filter(Boolean)
    .join(" ");
  const leaned = [
    area ? `${area}, your usual patch` : "",
    lean ? lean.said : "",
    cap ? "about what you usually pay" : "",
  ].filter(Boolean);
  return { query, because: `Going off ${listed(leaned)}.` };
}

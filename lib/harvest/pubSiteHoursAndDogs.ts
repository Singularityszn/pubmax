// Dog policy and opening hours taken from a pub's own website.
//
// The amenity harvest (lib/harvest/pubWebsiteAmenities.ts) keeps the page text
// it read, and this reads the same text again without a model. A fact stands
// only when a passage on the page states it, and that passage is the
// evidence. Silence, a mixed message and a conditional answer all stay
// unknown: a pub that welcomes dogs "in the garden only" has not said dogs are
// welcome, and an hours block with a day the page states twice two ways has
// not said when the pub opens.

import type { OpeningWindow, WeeklyOpeningHours } from "../busyness.ts";
import { parseStatedClock } from "./chainDeals.ts";

type DogPolicy = "welcome" | "not-allowed";

export type StatedDogPolicy = { policy: DogPolicy; evidence: string };

export type StatedSiteHours = {
  hours: WeeklyOpeningHours;
  /** The days the passage speaks about, Sunday 0 to Saturday 6. */
  statedDays: number[];
  evidence: string;
};

const MIN_EVIDENCE_CHARS = 8;
const MAX_DOG_EVIDENCE_CHARS = 280;
/** A week of hours with two windows a day runs past the amenity quote cap. */
const MAX_HOURS_EVIDENCE_CHARS = 640;

function fold(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Whether the page holds this passage after whitespace, quote and case folding. */
function passageIsOnPage(pageText: string, passage: string, maxChars: number): boolean {
  const folded = fold(passage);
  if (folded.length < MIN_EVIDENCE_CHARS || folded.length > maxChars) return false;
  return fold(pageText).includes(folded);
}

// ---------------------------------------------------------------------------
// Dogs
// ---------------------------------------------------------------------------

/**
 * Where a page breaks one statement from the next. Markdown list dashes and
 * table pipes separate facility lists ("- Dog Friendly - Family Friendly").
 */
const CLAUSE_BREAK = /(?<=[.!?])\s+|\s+[-\u2013\u2022*|]\s+|\s*#{1,6}\s+|\s*\|\s*|\n+/;

const DOG_WORD = /(?<!\bhot\s)(?<!\bcorn\s)\b(?:dogs?|doggos?|pooch(?:es)?|pups?|puppies|four[\s-]legged (?:friends?|guests?|companions?))\b/i;
const DOG_WELCOME =
  /\bdog[\s-]*friendly\b|\b(?:dogs?|pooch(?:es)?|pups?|four[\s-]legged (?:friends?|guests?|companions?))\s+(?:are\s+|is\s+)?(?:always\s+|very\s+|more than\s+|most\s+|also\s+|warmly\s+)?(?:welcome[ds]?|allowed|permitted)\b|\bwelcomes?\s+(?:well[\s-]behaved\s+)?(?:dogs?|pooch(?:es)?|pups?|four[\s-]legged)\b|\bbring (?:your|the) (?:dogs?|pooch|pup)\b/i;
const DOG_REFUSED =
  /\bno dogs\b|\b(?:dogs?|pets?)\s+(?:are\s+)?(?:not|n't|never)\s+(?:allowed|permitted|admitted|welcome)\b|\b(?:do not|don't|cannot|can't)\s+(?:allow|accept|admit|welcome)\s+(?:any\s+)?(?:dogs?|pets?)\b|\bnot\s+(?:a\s+)?dog[\s-]*friendly\b|\bonly\s+(?:assistance|guide|hearing)\s+dogs\b|\b(?:except|apart from|other than|with the exception of)\s+(?:registered\s+)?(?:assistance|guide|hearing)\s+dogs\b/i;
/** Assistance dogs are a legal duty, so a page that welcomes them says nothing about pets. */
const ASSISTANCE_DOG = /\b(?:assistance|guide|hearing|service)\s+dogs?\b/i;
/** Politeness around a statement, which limits nothing. */
const COURTESY = /\b(?:sorry|please|unfortunately|we(?:'re| are) afraid|note)\b/g;
/**
 * The whole of a welcome or a refusal at the pub. Any other words beside one,
 * a day, an hour, a room or the furniture, may limit it, so it is no policy.
 */
const PUB_WIDE_WELCOME =
  /^(?:(?:we(?: are|'re)(?: a)? )?dog friendly(?: pub| establishment)?|dogs(?: are)?(?: always| very)? welcome(?: (?:in|at) (?:the|our) pub)?|we welcome dogs|bring your dog|four legged friends(?: are)?(?: always)? welcome)$/;
const PUB_WIDE_REFUSAL =
  /^(?:no dogs(?: are)?(?: allowed| permitted)?|dogs are not (?:allowed|permitted|admitted|welcome)(?: (?:in|inside|at) (?:the pub|our pub|the premises|the building|the venue))?|we (?:do not|don't) (?:allow|accept|admit) dogs|we(?: are|'re) not dog friendly|only (?:assistance|guide) dogs(?: are)?(?: allowed| permitted| welcome)?|no dogs (?:except|apart from) (?:assistance|guide) dogs)$/;
/** A visitor's review quotes a guest, and a site footer names a page; neither is the pub stating a policy. */
const NOT_THE_PUB_SPEAKING =
  /\b(?:google|tripadvisor|reviews?|reviewed|rated|stars?|thanks|thank you|careers|privacy policy|terms and conditions|cookie|gift cards?|mailing list|sign up|quick links)\b|[\u2605\u2B50]|\p{Extended_Pictographic}/iu;
const NEGATION = /\b(?:not|no|never|n't|unfortunately|sadly)\b|n't\b/i;
/** Seasonal and one-off events speak for a day, not the pub's standing policy. */
const ONE_OFF = /\b(?:christmas|festive|halloween|new years?|easter|show|competition|parade|walk|event|festival|race)\b/i;

/** A day, a part of the day, a place, an exception, a number or a clock: words that limit a statement. */
const LIMIT =
  /\d|\b(?:only|except|excluding|unless|until|after|before|during|weekdays?|weekends?|(?:mon|tues?|wed(?:nes)?|weds|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:days?)?|lunch(?:times?)?|mornings?|afternoons?|evenings?|nights?|daytime|gardens?|terraces?|bar areas?|areas?|rooms?|upstairs|downstairs|inside|outside|indoors|outdoors|restaurant|dining)\b/i;

/** A clause, and the clause after it when this one does not end a sentence and so may run on into it. */
type Clause = { text: string; next: string | null };

function clauses(pageText: string): Clause[] {
  const texts = pageText.split(CLAUSE_BREAK).map((clause) => clause.trim()).filter(Boolean);
  return texts.map((text, index) => ({ text, next: /[.!?]["')\]]*$/.test(text) ? null : texts[index + 1] ?? null }));
}

function statesOnly({ text, next }: Clause, form: RegExp): boolean {
  if (next !== null && LIMIT.test(next)) return false;
  return form.test(fold(text).replace(COURTESY, " ").replace(/[^a-z0-9']+/g, " ").trim());
}

/** What a clause says about dogs, and whether it stands as the pub's policy or only as a limited answer. */
function dogClauseVerdict(clause: Clause): { policy: DogPolicy; stands: boolean } | null {
  const { text } = clause;
  if (!DOG_WORD.test(text) || /\?\s*$/.test(text)) return null;
  if (NOT_THE_PUB_SPEAKING.test(text)) return null;
  if (DOG_REFUSED.test(text)) return { policy: "not-allowed", stands: statesOnly(clause, PUB_WIDE_REFUSAL) };
  if (!DOG_WELCOME.test(text)) return null;
  if (ASSISTANCE_DOG.test(text) || NEGATION.test(text) || ONE_OFF.test(text)) return null;
  return { policy: "welcome", stands: statesOnly(clause, PUB_WIDE_WELCOME) };
}

/** A clause short enough to quote, or the run of words around the dog statement inside it. */
function quotable(clause: string, pattern: RegExp): string | null {
  const trimmed = clause.replace(/^[\s\-*#>|]+|[\s|]+$/g, "");
  if (fold(trimmed).length <= MAX_DOG_EVIDENCE_CHARS) return trimmed;
  const match = pattern.exec(trimmed);
  if (!match) return null;
  const start = trimmed.lastIndexOf(" ", Math.max(0, match.index - 80)) + 1;
  const endSpace = trimmed.indexOf(" ", Math.min(trimmed.length, match.index + match[0].length + 80));
  return trimmed.slice(start, endSpace === -1 ? trimmed.length : endSpace).trim();
}

/**
 * The page's dog policy, or null when the page does not state one. A page
 * that both welcomes and refuses dogs, with a limit on either or not, has not
 * stated a policy.
 */
export function statedDogPolicy(pageText: string): StatedDogPolicy | null {
  let welcome: string | null = null;
  let refused: string | null = null;
  const said = new Set<DogPolicy>();
  for (const clause of clauses(pageText)) {
    const verdict = dogClauseVerdict(clause);
    if (!verdict) continue;
    said.add(verdict.policy);
    if (!verdict.stands) continue;
    if (verdict.policy === "welcome") welcome ??= quotable(clause.text, DOG_WELCOME);
    else refused ??= quotable(clause.text, DOG_REFUSED);
  }
  if (said.size > 1) return null;
  const evidence = welcome ?? refused;
  if (!evidence || !passageIsOnPage(pageText, evidence, MAX_DOG_EVIDENCE_CHARS)) return null;
  return { policy: welcome ? "welcome" : "not-allowed", evidence };
}

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

const DAY = String.raw`(sun|mon|tue|tues|tuesday|wed|weds|wednes|thu|thur|thurs|fri|sat|satur)(?:day)?(?![a-z])\.?`;
const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const dayIndexOf = (word: string): number | undefined => DAY_INDEX[word.toLowerCase().slice(0, 3)];

/** The label of an hours block. "Kitchen hours" and "Serving times" are other blocks. */
const HOURS_LABEL = /\b(?:opening\s+(?:hours|times)|open(?:ing)?\s+hours|hours\s+of\s+opening|pub\s+hours|bar\s+hours|we(?:'re| are)\s+open)\b/gi;
/** A label that only names a link ("[Opening Times](url)") opens no block. */
const LINK_LABEL_TAIL = /^[^\]\n]{0,12}\]\(/;
/** Words between the label and the first day that turn the block into something other than the pub's week. */
const OTHER_BLOCK =
  /\b(?:kitchen|food|serving|served|menu|lunch|brunch|dinner|breakfast|christmas|festive|bank holiday|new year|easter|summer|winter|seasonal|temporary|today only|this week|event|garden|terrace|rooftop|restaurant)\b/i;
const SEASONAL_BEFORE = /\b(?:christmas|festive|bank holiday|new year'?s?|easter|summer|winter|seasonal|temporary|holiday|kitchen|food|restaurant|garden|terrace|rooftop)\b[^.]{0,24}$/i;
const LABEL_GAP_CHARS = 140;

const SEP = /[\s:|*_#\\\-\u2013\u2014,;]*/.source;
const CLOCK = String.raw`(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midday|midnight|12\s*noon|12\s*midnight)`;
/** The en dash bytes read as Latin-1, which some pages serve, join a range too. */
const RANGE_JOIN = /\s*(?:-|\u2013|\u2014|\u00e2\u20ac\u201c|to|until|till|til)\s*/.source;
/** A bracketed note after a day's hours ("(Kitchen open 12pm - 10pm)", "(Last orders 11pm)") answers another question. */
const NOTE = /^\s*\([^()]{0,60}\)/;
/** Hours followed by a condition ("12:00-02:00 for club nights") hold only when the condition does. */
const QUALIFIER = /^[\s|*]*(?:for|on|during|except|when|if|only|excluding|apart|unless|subject|by|with|in)\b/i;
const DAY_SPEC = new RegExp(
  String.raw`^${SEP}(?:today\s*\(\s*${DAY}\s*\)|${DAY})(?:${RANGE_JOIN}(?:today\s*\(\s*${DAY}\s*\)|${DAY}))?`,
  "i",
);
const DAY_LIST_TAIL = new RegExp(String.raw`^\s*(?:,|&|and)\s*${DAY}`, "i");
const WINDOW = new RegExp(String.raw`^${SEP}(${CLOCK})${RANGE_JOIN}(${CLOCK})`, "i");
const NEXT_WINDOW = new RegExp(String.raw`^\s*(?:,|&|and|/|\||;|\s)\s*(?:\|\s*)*(${CLOCK})${RANGE_JOIN}(${CLOCK})`, "i");
const CLOSED = new RegExp(String.raw`^${SEP}closed\b`, "i");

function clockOf(raw: string): string | null {
  const value = raw.toLowerCase().replace(/\./g, (dot, offset, whole) => (/\d/.test(whole[offset - 1] ?? "") && /\d/.test(whole[offset + 1] ?? "") ? ":" : ""));
  const compact = value.replace(/\s+/g, " ").trim();
  if (/^(?:12 ?)?noon$|^midday$/.test(compact)) return "12:00";
  if (/^(?:12 ?)?midnight$/.test(compact)) return "00:00";
  return parseStatedClock(compact);
}

const BARE_CLOCK = /^(\d{1,2})(?:[:.]\d{2})?$/;
const MERIDIEM_CLOCK = /\d\s*[ap]\.?m\.?$/i;

/**
 * A clock with no meridiem reads only as 24-hour, so its window must show it:
 * an hour from 13 to 23, a 00 hour or a zero-padded clock. "12:00 - 11:00" and
 * "5:00 - 11:00pm" could each be either, so they are not read.
 */
function reads24Hour(raws: readonly string[]): boolean {
  const bare = raws.map((raw) => BARE_CLOCK.exec(raw.trim())).filter((match) => match !== null);
  if (bare.length === 0) return true;
  if (raws.some((raw) => MERIDIEM_CLOCK.test(raw.trim()))) return false;
  return bare.some(([clock, hour]) => clock.startsWith("0") || Number(hour) >= 13);
}

function windowOf(opensRaw: string, closesRaw: string): OpeningWindow | null {
  const opens = clockOf(opensRaw);
  const closes = clockOf(closesRaw);
  if (!opens || !closes || opens === closes || !reads24Hour([opensRaw, closesRaw])) return null;
  return { opens, closes };
}

function daysOf(from: string, to: string | undefined): number[] | null {
  const start = dayIndexOf(from);
  if (start === undefined) return null;
  if (!to) return [start];
  const end = dayIndexOf(to);
  if (end === undefined || end === start) return null;
  const days: number[] = [];
  for (let step = 0; step < 7; step += 1) {
    const index = (start + step) % 7;
    days.push(index);
    if (index === end) return days;
  }
  return null;
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

/** Two windows on one day that share a minute, closing times past midnight read as the next day. */
function windowsOverlap(a: OpeningWindow, b: OpeningWindow): boolean {
  const span = (w: OpeningWindow) => {
    const open = minutes(w.opens);
    const close = minutes(w.closes);
    return [open, close <= open ? close + 1440 : close] as const;
  };
  const [aOpen, aClose] = span(a);
  const [bOpen, bClose] = span(b);
  return aOpen < bClose && bOpen < aClose;
}

type Entry = { days: number[]; windows: OpeningWindow[]; end: number };

/** One "Mon - Thu 12pm - 11pm" or "Sunday closed" entry at `from`, or null. */
function entryAt(text: string, from: number): Entry | null {
  const rest = text.slice(from);
  const day = DAY_SPEC.exec(rest);
  if (!day) return null;
  let cursor = day[0].length;
  let days = daysOf(day[1] ?? day[2] ?? "", day[3] ?? day[4]);
  if (!days) return null;
  for (let tail = DAY_LIST_TAIL.exec(rest.slice(cursor)); tail; tail = DAY_LIST_TAIL.exec(rest.slice(cursor))) {
    if (day[3] ?? day[4]) return null;
    const extra = dayIndexOf(tail[1] ?? "");
    if (extra === undefined) return null;
    days = [...days, extra];
    cursor += tail[0].length;
  }
  const closed = CLOSED.exec(rest.slice(cursor));
  if (closed) return { days, windows: [], end: from + cursor + closed[0].length };
  const first = WINDOW.exec(rest.slice(cursor));
  if (!first) return null;
  const window = windowOf(first[1] ?? "", first[2] ?? "");
  if (!window) return null;
  cursor += first[0].length;
  const windows = [window];
  for (let next = NEXT_WINDOW.exec(rest.slice(cursor)); next; next = NEXT_WINDOW.exec(rest.slice(cursor))) {
    const more = windowOf(next[1] ?? "", next[2] ?? "");
    if (!more) return null;
    windows.push(more);
    cursor += next[0].length;
  }
  const note = NOTE.exec(rest.slice(cursor));
  if (note) cursor += note[0].length;
  if (QUALIFIER.test(rest.slice(cursor))) return null;
  return { days, windows, end: from + cursor };
}

const sameWindows = (a: readonly OpeningWindow[], b: readonly OpeningWindow[]) =>
  a.length === b.length && a.every((w, i) => w.opens === b[i]?.opens && w.closes === b[i]?.closes);

/** The block a label opens, or null when what follows the label is not a stated week. */
function blockAfterLabel(text: string, labelStart: number, labelEnd: number): StatedSiteHours | null {
  if (LINK_LABEL_TAIL.test(text.slice(labelEnd))) return null;
  if (SEASONAL_BEFORE.test(text.slice(Math.max(0, labelStart - 40), labelStart))) return null;
  const gapText = text.slice(labelEnd, labelEnd + LABEL_GAP_CHARS);
  const firstDay = new RegExp(String.raw`(?:today\s*\(\s*)?\b${DAY}`, "i").exec(gapText);
  if (!firstDay) return null;
  const gap = gapText.slice(0, firstDay.index);
  if (/\d/.test(gap) || OTHER_BLOCK.test(gap)) return null;
  const hours: WeeklyOpeningHours = {};
  let cursor = labelEnd + firstDay.index;
  let end = cursor;
  for (let entry = entryAt(text, cursor); entry; entry = entryAt(text, cursor)) {
    for (const day of entry.days) {
      const existing = hours[day];
      if (existing && !sameWindows(existing, entry.windows)) return null;
      hours[day] = entry.windows;
    }
    cursor = entry.end;
    end = entry.end;
  }
  const statedDays = Object.keys(hours).map(Number).sort((a, b) => a - b);
  if (statedDays.length === 0) return null;
  for (const windows of Object.values(hours)) {
    if (!windows) continue;
    for (let i = 0; i < windows.length; i += 1) {
      for (let j = i + 1; j < windows.length; j += 1) {
        if (windowsOverlap(windows[i]!, windows[j]!)) return null;
      }
    }
  }
  const evidence = text.slice(labelStart, end).trim();
  return { hours, statedDays, evidence };
}

/** Two blocks agree when every day both state has the same windows. */
const blocksAgree = (a: WeeklyOpeningHours, b: WeeklyOpeningHours) =>
  Object.entries(a).every(([day, windows]) => {
    const other = b[Number(day)];
    return other === undefined || windows === undefined || sameWindows(windows, other);
  });

/**
 * The pub's own week as the page states it under an opening-hours label, or
 * null. Days the page does not state stay out, an explicitly closed day is an
 * empty window list, and a page whose hours blocks disagree on a day has
 * stated nothing. Of blocks that agree, the one stating the most days stands.
 * A bare "11 - 5" names no meridiem and is not read, and neither is a window
 * whose clocks without a meridiem could be 12-hour ("12:00 - 11:00").
 */
export function statedSiteOpeningHours(pageText: string): StatedSiteHours | null {
  const blocks: StatedSiteHours[] = [];
  for (const label of pageText.matchAll(HOURS_LABEL)) {
    const start = label.index ?? 0;
    const block = blockAfterLabel(pageText, start, start + label[0].length);
    if (block) blocks.push(block);
  }
  const first = blocks[0];
  if (!first || blocks.some((a) => blocks.some((b) => !blocksAgree(a.hours, b.hours)))) return null;
  const best = blocks.reduce((a, b) => (b.statedDays.length > a.statedDays.length ? b : a), first);
  if (!passageIsOnPage(pageText, best.evidence, MAX_HOURS_EVIDENCE_CHARS)) return null;
  return best;
}

// ---------------------------------------------------------------------------
// Rows from the amenity harvest's kept pages
// ---------------------------------------------------------------------------

/** The checkpoint fields this reads. A read is used only when the amenity run finished it: status "ok". */
export type KeptPageRead = { status?: string; name?: string; venueId?: string | null; sourceUrl?: string };

/**
 * The amenity run's final refusals: each proves the pub's page is not its own
 * or may not be used, so a read that ends in one settles the pub. Any other
 * status that is not "ok" may pass on a later run.
 */
const SETTLED_REFUSALS: ReadonlySet<string> = new Set([
  "chain-page",
  "site-of-another-pub",
  "listed-site-unconfirmed",
  "located-site-unconfirmed",
  "robots-denied",
  "robots-disallowed",
  "robots-unreadable",
  "robots-unreachable",
  "redirect-refused",
  "refused-host",
  "no-website",
  "no-site-found",
  "http-401",
  "http-403",
  "http-404",
  "http-410",
  "http-451",
]);

export type SiteFactsRow = {
  osmId: string;
  name: string;
  venueId: string | null;
  sourceUrl: string;
  /** The day the page was read, YYYY-MM-DD. */
  readOn: string;
  dogs?: StatedDogPolicy;
  hours?: StatedSiteHours;
};

/**
 * One row per pub whose kept page states a dog policy or opening hours. Only
 * a read the amenity run finished counts, because only that read passed every
 * fence the run holds: the source policy and robots at the page it landed on,
 * the chain list, the pub's address on a site only a dataset or a search gave
 * it, and the duplicate check for a dataset venue reading another pub's page.
 * A page on the chain list speaks for the brand. A passage more than one pub
 * on one host states word for word is the chain's too, so it goes.
 */
export function siteFactsRows(input: {
  reads: Readonly<Record<string, KeptPageRead>>;
  loadPage: (osmId: string) => { text: string; readAt: string } | null;
  isChainPage: (url: string) => boolean;
}): { rows: SiteFactsRow[]; skipCounts: Record<string, number>; unsettled: string[] } {
  const skipCounts: Record<string, number> = {};
  const skip = (reason: string) => {
    skipCounts[reason] = (skipCounts[reason] ?? 0) + 1;
  };
  const unsettled: string[] = [];
  const candidates: SiteFactsRow[] = [];
  for (const [osmId, read] of Object.entries(input.reads)) {
    // A page read under --read-only waits as "read" until a model run
    // finishes it, and its later fences have not run yet. A quota, model,
    // network or server failure may pass on a later run.
    if (read.status !== "ok") {
      if (!SETTLED_REFUSALS.has(read.status ?? "")) {
        unsettled.push(osmId);
        skip(`unsettled-${read.status ?? "no-status"}`);
      }
      continue;
    }
    const page = read.sourceUrl ? input.loadPage(osmId) : null;
    if (!read.sourceUrl || !page) {
      unsettled.push(osmId);
      skip("unsettled-page-missing");
      continue;
    }
    if (input.isChainPage(read.sourceUrl)) {
      skip("chain-page");
      continue;
    }
    const dogs = statedDogPolicy(page.text);
    const hours = statedSiteOpeningHours(page.text);
    if (!dogs && !hours) {
      skip("page-stated-neither");
      continue;
    }
    candidates.push({
      osmId,
      name: read.name ?? "",
      venueId: read.venueId ?? null,
      sourceUrl: read.sourceUrl,
      readOn: page.readAt.slice(0, 10),
      ...(dogs ? { dogs } : {}),
      ...(hours ? { hours } : {}),
    });
  }
  const hostOf = (url: string) => new URL(url).host.toLowerCase().replace(/^www\./, "");
  const statedBy = new Map<string, Set<string>>();
  const passageId = (row: SiteFactsRow, kind: "dogs" | "hours") => {
    const evidence = row[kind]?.evidence;
    return evidence === undefined ? null : `${hostOf(row.sourceUrl)}\u0000${kind}\u0000${fold(evidence)}`;
  };
  for (const row of candidates) {
    for (const kind of ["dogs", "hours"] as const) {
      const id = passageId(row, kind);
      if (id) statedBy.set(id, (statedBy.get(id) ?? new Set()).add(row.osmId));
    }
  }
  const rows: SiteFactsRow[] = [];
  for (const row of candidates) {
    const kept: SiteFactsRow = { ...row };
    for (const kind of ["dogs", "hours"] as const) {
      const id = passageId(row, kind);
      if (id && (statedBy.get(id)?.size ?? 0) > 1) {
        delete kept[kind];
        skip(`chain-${kind}-passage`);
      }
    }
    if (kept.dogs || kept.hours) rows.push(kept);
  }
  rows.sort((a, b) => a.osmId.localeCompare(b.osmId));
  return { rows, skipCounts, unsettled: unsettled.sort() };
}

/**
 * The rows to publish: the fresh rows, plus each committed row whose pub the
 * checkpoint has not settled, kept unchanged. A pub with no checkpoint entry,
 * an unfinished or failed read, or a missing kept page was not read again, so
 * only a settled outcome (a finished read with its kept page, or a final
 * refusal) may change or drop its row. A checkpoint with no finished read at
 * all is not a harvest, so it publishes nothing.
 */
export function mergeSiteFactsRows(
  previousRows: readonly SiteFactsRow[],
  fresh: { rows: readonly SiteFactsRow[]; skipCounts: Readonly<Record<string, number>>; unsettled: readonly string[] },
  reads: Readonly<Record<string, KeptPageRead>>,
): { rows: SiteFactsRow[]; skipCounts: Record<string, number> } | { refusal: string } {
  if (previousRows.length > 0 && !Object.values(reads).some((read) => read.status === "ok")) {
    return { refusal: "the checkpoint holds no finished read; run the amenity harvest without --read-only first" };
  }
  const unsettled = new Set(fresh.unsettled);
  const kept = previousRows.filter((row) => !Object.hasOwn(reads, row.osmId) || unsettled.has(row.osmId));
  const rows = [...fresh.rows, ...kept].sort((a, b) => a.osmId.localeCompare(b.osmId));
  const skipCounts = { ...fresh.skipCounts, ...(kept.length > 0 ? { "kept-unsettled": kept.length } : {}) };
  return { rows, skipCounts };
}

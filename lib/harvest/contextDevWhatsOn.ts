import "server-only";

import { createHash } from "node:crypto";

import { londonWallClockToIso } from "../../scripts/whatson/dealsRefresh.mjs";
import { nextWeeklyOccurrence } from "../../scripts/whatson/quizParsers.mjs";
import { currentOwnSiteRows } from "../whatson/eventNormalise.mjs";
import { isValidWhatsOnRow, POINT_ROW_GRACE_MS, timedRowEffectiveEnd } from "../whatsOnRowShape.mjs";
import type { WhatsOnRow } from "../whatsOn.ts";
import { parseChainDealDays, WEEKDAY_NAMES } from "./chainDeals.ts";
import { statedSiteOpeningHours } from "./pubSiteHoursAndDogs.ts";
import { isHarvestableOperatorUrl } from "./sourcePolicy.ts";
import { eventKindFrom, parseVenueEventListings, resolveEventClock, resolveEventDate } from "./venueEvents.ts";

export type WhatsOnPub = { osmId: string; name: string; venueId: string | null; lat: number; lng: number; website: string };

export function pageKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

/** One shared home page cannot attribute facts to pubs at different locations. */
export function ambiguousPubWebsites(pubs: WhatsOnPub[]): Set<string> {
  const held = new Map<string, WhatsOnPub>();
  const ambiguous = new Set<string>();
  for (const pub of pubs) {
    const url = new URL(pub.website);
    const key = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
    const previous = held.get(key);
    if (previous && Math.hypot(pub.lat - previous.lat, (pub.lng - previous.lng) * 0.62) > 0.001)
      ambiguous.add(key);
    held.set(key, pub);
  }
  return new Set(pubs.filter((pub) => {
    const url = new URL(pub.website);
    return ambiguous.has(`${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`);
  }).map((pub) => pub.website));
}

/**
 * A successful read replaces every row this lane held from its page. A held row
 * whose time has passed leaves. One pub's slot that several of its pages list
 * publishes once, from the first page that lists it. A pub screens several
 * fixtures at once, so a sport slot is also its fixture.
 */
export function mergeOwnSiteListings(previous: WhatsOnRow[], observations: { sourceUrl: string; osmId: string; rows: WhatsOnRow[] }[], nowMs: number): WhatsOnRow[] {
  const replaced = new Set(observations.map((entry) => entry.sourceUrl));
  const held = currentOwnSiteRows(previous, nowMs).filter((row) => !replaced.has(row.source.url));
  const rows = new Map([...previous.filter((row) => !row.id.startsWith("own-site-")), ...held].map((row) => [row.id, row]));
  const claimed = new Map<string, string>();
  for (const entry of observations) {
    for (const row of entry.rows) {
      const slot = `${entry.osmId}|${row.kind}|${row.startsAt}${row.kind === "sport" ? `|${row.title}` : ""}`;
      if ((claimed.get(slot) ?? entry.sourceUrl) !== entry.sourceUrl) continue;
      claimed.set(slot, entry.sourceUrl);
      rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

/** A published link must stay under this pub's own site path. */
export function isPubPage(url: string, website: string): boolean {
  if (!isHarvestableOperatorUrl(url)) return false;
  const page = new URL(url);
  const home = new URL(website);
  if (page.hostname.replace(/^www\./, "") !== home.hostname.replace(/^www\./, "")) return false;
  const root = home.pathname.replace(/\/$/, "");
  return !root || page.pathname === root || page.pathname.startsWith(`${root}/`);
}

/** Discover pages through the site's links, without guessing an events URL. */
export function discoverWhatsOnPages(markdown: string, website: string): string[] {
  const found = new Set<string>();
  for (const [, label, href] of markdown.matchAll(/\[([^\]]+)\]\(([^\s)]+)[^)]*\)/g)) {
    let page: URL;
    try { page = new URL(href!, website); } catch { continue; }
    page.hash = "";
    if (!isPubPage(page.href, website) || page.search) continue;
    if (/private|hire|event[-_ ]?spaces?|wedding|christmas|privacy|terms/i.test(`${label} ${page.pathname}`)) continue;
    if (!/what.?s[-_ ]?on|events?|quiz|gigs?|live[-_ ]?music|sport|happy[-_ ]?hour|offers?|contact|opening[-_ ]?hours/i.test(`${label} ${page.pathname}`)) continue;
    found.add(page.href);
  }
  return [...found];
}

export function plainText(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[\s#*|]+/gm, "").replace(/\*+/g, "").replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1");
}

const MONTH_WORDS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DAY_WORDS = "(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?";

/** A line that states only days, dates and clocks, with no words of its own. */
function scheduleOnly(line: string): boolean {
  const text = plainText(line).toLowerCase();
  const rest = text.replace(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/g, " ")
    .replace(new RegExp(`\\b(?:every|each|and|from|at|${DAY_WORDS}|${MONTH_WORDS}|\\d{1,2}(?:st|nd|rd|th)?|\\d{4})\\b`, "g"), " ");
  const dateRange = new RegExp(`\\d(?:st|nd|rd|th)?\\s*[-\u2013]\\s*\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_WORDS})\\b`).test(text);
  return /\d|day\b/.test(text) && !dateRange && /^[\s|,&\-\u2013.']*$/.test(rest);
}

const PAIRING = /\s+v(?:s\.?)?\s+/i;
const clockOnly = (line: string) => /^\s*(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\s*$/i.test(plainText(line));

const statesDate = (line: string) => new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_WORDS})\\b`, "i").test(line);

/**
 * Cards are headings and list items with the lines under them. A run of
 * date and clock lines directly above a heading belongs to that heading when
 * it opens a section's first dated fixture or continues a list of such items.
 * A deeper heading that names no listing, neither a fixture nor an event
 * kind, leaves the run with its parent.
 * A later item that states only its clock keeps the list's last stated day.
 */
function listingCards(markdown: string): { title: string; text: string; markdown: string; happyHourParent: string | null }[] {
  const cards: { title: string; lines: string[]; happyHourParent: string | null; navigation?: boolean }[] = [];
  let happyHour: { title: string; level: number } | null = null;
  let run: string[] = [];
  let lastLevel = 0;
  let datedList = null as { level: number; day: string | null } | null;
  let opened = null as { parent: { lines: string[] }; child: { title: string; lines: string[] }; run: string[] } | null;
  const flush = () => {
    cards.at(-1)?.lines.push(...run);
    run = [];
  };
  const settleOpened = () => {
    if (opened && !eventKindFrom(opened.child.title) && ![opened.child.title, ...opened.child.lines.slice(opened.run.length)].some((item) => PAIRING.test(plainText(item)))) {
      opened.child.lines.splice(0, opened.run.length);
      opened.parent.lines.push(...opened.run);
      datedList = null;
    }
    opened = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^\s*(?:[-*]\s+)?(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      settleOpened();
      const title = plainText(heading[2]!).trim();
      const level = heading[1]!.length;
      if (happyHour && level <= happyHour.level) happyHour = null;
      if (/\bhappy\s+hours?\b/i.test(title)) happyHour = { title, level };
      const opensList = lastLevel < level && run.some(statesDate);
      const continuesList = datedList?.level === level;
      // An undated weekday-and-clock line above a named listing is that listing's weekly schedule.
      const namesSchedule = Boolean(eventKindFrom(title)) && !run.some(statesDate) && run.some((item) => /^(?:every\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(item.trim()) && resolveEventClock(item));
      let lines: string[] = [];
      if (run.length && (opensList || continuesList || namesSchedule)) {
        const day = run.find(statesDate) ?? (continuesList && run.every(clockOnly) ? datedList!.day : null);
        lines = day && !run.includes(day) ? [day, ...run] : run;
        datedList = { level, day };
        if (opensList && !continuesList && !namesSchedule && cards.length) opened = { parent: cards.at(-1)!, child: { title, lines }, run: [...lines] };
        run = [];
      } else {
        flush();
        datedList = null;
      }
      const card = { title, lines, happyHourParent: happyHour && level > happyHour.level ? happyHour.title : null };
      if (opened) opened.child = card;
      cards.push(card);
      lastLevel = level;
    }
    else if (!happyHour && /^\s*[-*]\s+/.test(line)) {
      // Each list item owns its schedule. A neighbouring offer cannot date a quiz.
      flush();
      const title = plainText(line.replace(/^\s*[-*]\s+/, "")).trim();
      const navigation = /^(?:Google Calendar|ICS)(?:\s+(?:Google Calendar|ICS))*$/i.test(title);
      cards.push({ title, lines: [], happyHourParent: null, navigation });
    }
    else if (line.trim() && !/^\s*!\[|^\s*\[[^\]]+\]\([^)]*\)\s*$/.test(line)) {
      if (scheduleOnly(line)) run.push(line);
      else {
        flush();
        if (datedList && statesDate(line)) datedList.day = null;
        cards.at(-1)?.lines.push(line);
      }
    }
  }
  flush();
  settleOpened();
  return cards.filter((card) => !card.navigation).map((card) => {
    const lines = card.lines.slice(0, 5);
    return { title: card.title, text: plainText([card.title, ...lines].join("\n")), markdown: `## ${card.title}\n${lines.join("\n")}`, happyHourParent: card.happyHourParent };
  });
}

function happyHourCards(cards: ReturnType<typeof listingCards>): string {
  return cards.filter((card) => /\bhappy\s+hours?\b/i.test(card.title) || card.happyHourParent).flatMap((card) => {
    if (/\b(?:until|ends?|valid to)\s+\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+|christmas|seasonal|bank holiday/i.test(card.text)) return [];
    const title = card.happyHourParent ? `${card.happyHourParent} - ${card.title}` : card.title;
    const lines = card.text.split("\n");
    // A shared pm marker in "5-9pm" applies to both increasing hour numbers.
    const schedules = lines.map((line) => line.replace(/^.*?\bhappy\s+hours?\s+/i, "")
      .replace(/\b(?:everyday|every day|daily)\b/i, "Every Monday-Sunday")
      .replace(/\b(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\s*(am|pm)\b/gi, (token, from: string, to: string, period: string) => Number(from) <= Number(to) ? `${from}${period}-${to}${period}` : token));
    return [`## ${title}\n${schedules.join("\n")}`];
  }).join("\n");
}

/**
 * A card that names more than one kind takes its kind from the clause that
 * states its clock. A clock clause that names no kind belongs to the heading.
 */
function clockStatesKind(clauses: string[], clock: string, kind: WhatsOnRow["kind"], heading: string): boolean {
  if (new Set(clauses.map(eventKindFrom).filter(Boolean)).size <= 1) return true;
  const stated = new Set(clauses.filter((clause) => resolveEventClock(clause) === clock).map(eventKindFrom).filter(Boolean));
  return stated.size === 0 ? eventKindFrom(heading) === kind : stated.size === 1 && stated.has(kind);
}

/** A window that ends at or before its start closes the next day. */
function windowMs(start: string, end: string): number {
  const minutes = (clock: string) => Number(clock.slice(0, -3)) * 60 + Number(clock.slice(-2));
  return ((minutes(end) - minutes(start) + 1440) % 1440 || 1440) * 60_000;
}

/**
 * This harvest counts its own requests, so an account refill cannot reopen its
 * allowance. A saved state from before that count proves its spend only by a
 * balance no higher than the start. Otherwise the allowance counts as spent.
 */
export function harvestCredits(plan: { creditsAtStart: number; maxCredits: number }, state: { creditsSpent?: number; creditsAfter?: number }, creditsRemaining: number, reserve: number) {
  const spent = state.creditsSpent ?? (state.creditsAfter !== undefined && state.creditsAfter <= plan.creditsAtStart ? plan.creditsAtStart - state.creditsAfter : plan.maxCredits);
  return { spent, available: Math.min(creditsRemaining - reserve, plan.maxCredits - spent) };
}

/** Greene King's timed fixtures come from its FANZO partner, so they are not the pub's own listing. */
export function isPartnerFixturePage(url: string): boolean {
  const page = new URL(url);
  return page.hostname.replace(/^www\./, "") === "greeneking.co.uk" && /\/sports\/fixtures\/?$/.test(page.pathname);
}

/** Parse the existing listing and hours shapes from one fresh own-site read. */
export function readPubWhatsOn(pub: WhatsOnPub, markdown: string, sourceUrl: string, observedAt: string, asOf = observedAt) {
  const now = Date.parse(observedAt);
  const serviceNow = Date.parse(asOf);
  if (!Number.isFinite(now) || !Number.isFinite(serviceNow) || serviceNow < now || !isPubPage(sourceUrl, pub.website)) throw new Error("Invalid pub observation");
  const cards = listingCards(markdown);
  const drops: { title: string; reason: string }[] = [];
  const rows: WhatsOnRow[] = [];
  const base = { placeName: pub.name, lat: pub.lat, lng: pub.lng, ...(pub.venueId ? { venueId: pub.venueId } : {}), source: { label: `${pub.name} website`, url: sourceUrl }, observedAt, confidence: "listed" as const };
  const keep = (row: WhatsOnRow) => {
    if (isValidWhatsOnRow(row, serviceNow) && row.startsAt && timedRowEffectiveEnd(row) > serviceNow) rows.push(row);
  };
  for (const card of cards) {
    const lines = card.text.split("\n").map((line) => line.trim()).filter(Boolean);
    const named = lines.find((line) => line.length <= 80 && eventKindFrom(line));
    const kind = named ? eventKindFrom(named) : null;
    if (!kind) continue;
    if (/^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*\(\d+\)$/i.test(card.title)) {
      drops.push({ title: card.title, reason: "incomplete-fixture" });
      continue;
    }
    const otherVenue = /\bat (the [\p{L} '&-]+?)(?:[🎤🎭]|$)/iu.exec(card.title)?.[1];
    const venueWords = (value: string) => value.toLowerCase().replace(/\bthe\b/g, "").replace(/[^a-z0-9]/g, "");
    if (otherVenue && venueWords(otherVenue) !== venueWords(pub.name)) {
      drops.push({ title: card.title, reason: "other-venue" });
      continue;
    }
    const dates = lines.map((line) => resolveEventDate(line, now)).filter((date) => date.ok);
    if (new Set(dates.map((date) => JSON.stringify(date.date))).size > 1) {
      drops.push({ title: card.title, reason: "conflicting-dates" });
      continue;
    }
    if (/every other|fortnight|alternate|monthly|first |last |second |third |fourth /i.test(card.text)) {
      drops.push({ title: card.title, reason: "unsupported-recurrence" });
      continue;
    }
    if (/\bdoors\b|sign[- ]?ups?/i.test(card.text) && !/\bstarts?\b|\bbegins?\b|\bkick[- ]?off\b/i.test(card.text)) {
      drops.push({ title: card.title, reason: "doors-only" });
      continue;
    }
    if (/\b(?:UTC|GMT|BST|CET|EST|PST)\b|\d{2}:\d{2}\s*[+-]\d{2}:\d{2}/i.test(card.text)) {
      drops.push({ title: card.title, reason: "explicit-timezone" });
      continue;
    }
    const starts = [...card.text.matchAll(/\b(?:starts?|begins?|kick[- ]?off)\s*(?:at|:)?\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/gi)]
      .map((match) => resolveEventClock(match[1]!)).filter((clock) => clock !== null);
    const clocks = [...card.text.matchAll(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/gi)]
      .map((match) => resolveEventClock(match[0])).filter((clock) => clock !== null);
    const clock = starts.length === 1 ? starts[0] : starts.length === 0 && new Set(clocks).size === 1 ? clocks[0] : null;
    if (!clock) {
      drops.push({ title: card.title, reason: clocks.length ? "ambiguous-time" : "no-time" });
      continue;
    }
    // Plural weekday headings and explicit "every/each" statements name weekly slots.
    const clauses = lines.flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/));
    if (!clockStatesKind(clauses, clock, kind, card.title)) {
      drops.push({ title: card.title, reason: "mixed-kinds" });
      continue;
    }
    const weeklyLines = clauses.filter((line) => /\b(?:every|each)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s\b/i.test(line));
    const weeklyDays = WEEKDAY_NAMES.filter((day) => weeklyLines.some((line) => new RegExp(`\\b${day}s?\\b`, "i").test(line)));
    const days = weeklyDays.filter((day) => weeklyDays.length === 1 || clauses.some((line) => new RegExp(`\\b${day}s?\\b`, "i").test(line) && resolveEventClock(line) === clock));
    if (days.length && !/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(card.text)) {
      for (const day of days) {
        const startsAt = nextWeeklyOccurrence(day, clock, new Date(serviceNow - POINT_ROW_GRACE_MS[kind]).toISOString());
        if (startsAt) keep({ ...base, id: `own-site-${pageKey(`${pub.osmId}|${named}|${startsAt}`)}`, kind, title: eventKindFrom(card.title) ? card.title : named!, startsAt, timeEvidence: card.text });
      }
      continue;
    }
    const parsed = parseVenueEventListings(card.markdown, now);
    drops.push(...parsed.drops);
    for (const event of parsed.events) {
      if (event.date.year > new Date(now).getUTCFullYear() && !new RegExp(`\\b${event.date.year}\\b`).test(card.text)) {
        drops.push({ title: card.title, reason: "no-stated-year" });
        continue;
      }
      const date = `${event.date.year}-${String(event.date.month).padStart(2, "0")}-${String(event.date.day).padStart(2, "0")}`;
      const startsAt = londonWallClockToIso(date, clock);
      if (!startsAt) continue;
      const fixture = lines.slice(1).find((line) => PAIRING.test(line) && !PAIRING.test(event.title));
      const title = event.kind === "sport" && fixture ? `${event.title}: ${fixture}` : event.title;
      keep({ ...base, id: `own-site-${pageKey(`${pub.osmId}|${title}|${startsAt}`)}`, kind: event.kind, title, startsAt, timeEvidence: card.text });
    }
  }
  // Deal schedules are considered only within an explicit happy-hour card.
  // Opening hours and food offers cannot become drinks listings.
  const dealParse = parseChainDealDays(happyHourCards(cards));
  for (const deal of dealParse.deals.filter((item) => /\bhappy\s+hours?\b/i.test(item.title))) {
    for (const day of deal.days) {
      const startsAt = nextWeeklyOccurrence(day, deal.startTime, new Date(serviceNow - windowMs(deal.startTime, deal.endTime)).toISOString());
      if (!startsAt) continue;
      let date = startsAt.slice(0, 10);
      if (deal.endTime <= deal.startTime) date = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const endsAt = londonWallClockToIso(date, deal.endTime);
      if (!endsAt) continue;
      keep({ ...base, id: `own-site-${pageKey(`${pub.osmId}|${deal.id}|${startsAt}`)}`, kind: "deal", title: deal.title, startsAt, endsAt, ...(deal.detail ? { detail: deal.detail } : {}) });
    }
  }
  return { rows: [...new Map(rows.map((row) => [row.id, row])).values()], hours: statedSiteOpeningHours(plainText(markdown)), drops: [...drops, ...dealParse.drops] };
}

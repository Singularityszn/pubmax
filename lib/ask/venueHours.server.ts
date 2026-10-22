import "server-only";

import type { WeeklyOpeningHours } from "@/lib/busyness";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { DAY_MS } from "@/lib/dayMs";
import { firstHttp } from "@/lib/httpUrl";
import { placesOpeningHours, PLACES_REFRESH_DAYS } from "@/lib/placesEnrichment";
import { OPENING_EVIDENCE_FRESH_DAYS } from "@/lib/planRouteEvidence";
import { planOpeningSchedulesForVenues } from "@/lib/planRouteEvidence.server";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { wordsOnly } from "@/lib/ask/placePhrases";
import { askRequestClauses } from "@/lib/ask/router";
import { venueSearchNames } from "@/lib/venueSearchNames.mjs";
import type { AskToolContext, AskToolResult } from "@/lib/ask/toolContract";
import type { AskSource } from "@/lib/ask/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hoursLines(hours: WeeklyOpeningHours): string[] {
  return Object.entries(hours).flatMap(([day, windows]) => {
    const label = DAYS[Number(day)];
    if (!label || !windows) return [];
    return windows.length
      ? windows.map((window) => `${label} ${window.opens} to ${window.closes}`)
      : [`${label} closed`];
  });
}

/** Answer a named pub's regular hours from existing records, without a provider call. */
async function readVenueHours(query: string, ctx: AskToolContext): Promise<AskToolResult> {
  const empty: AskToolResult = {
    ok: true, tool: "search_venues", data: null, cards: [], proposals: [], provenance: [],
    answerHint: "Which pub do you mean? I need its name to check the opening hours.",
  };
  const venues = await loadConciergeVenues(ctx.cityId);
  const hoursClauses = askRequestClauses(query).filter((clause) => /\b(?:opening|closing)\s+(?:hours|times)\b/i.test(clause));
  if (hoursClauses.length > 1) return empty;
  const hoursClause = hoursClauses[0] ?? query;
  const question = hoursClause.trim().replace(/[.!?,;:]+$/, "")
    .replace(/(?:,\s*|\s+)please$/i, "")
    .replace(/^please[,\s]+/i, "")
    .replace(/^(?:what(?:['’]s|\s+(?:is|are))|(?:can|could|would)\s+you\s+(?:tell|show)\s+me|(?:tell|show)\s+me)\s+/i, "")
    .split(/\b(?:near|next to|close to|beside|around)\b/i)[0] ?? "";
  const [before, after] = question.split(/\b(?:opening|closing)\s+(?:hours|times)\b/i);
  const subject = (after?.trim() ? after : before ?? "")
    .replace(/^\s*(?:of|at|for)\s+/i, "").replace(
      /^\s*(?:a|an|the)\s+(?:(?!(?:pub|bar|venue|place)\b)[^\s,.!?;]+\s+)*(?:pub|bar|venue|place)\s+(?:called|named)\s+/i, "",
    );
  const matchingVenues = (phrase: string) => {
    const name = wordsOnly(phrase).replace(/^the\s+/, "");
    return venues.filter((candidate) => venueSearchNames(candidate).some(
      (label: string) => wordsOnly(label).replace(/^the\s+/, "") === name,
    ));
  };
  const completeMatches = matchingVenues(subject);
  const matches = completeMatches.length ? completeMatches
    : matchingVenues(subject.replace(/['’]s(?=\s*[,.;:!?]*\s*$)/i, ""));
  const venue = matches.length === 1 ? matches[0] : null;
  if (!venue) return empty;

  const detail = await lookupVenueDetail(venue.id);
  if (detail.status === "unavailable") {
    return { ...empty, ok: false, degraded: true, answerHint: `I couldn't check the opening hours for ${venue.name}.` };
  }
  const now = ctx.now ?? Date.now();
  let lines: string[] = [];
  let source: AskSource | undefined;
  if (detail.status === "found") {
    const record = detail.venue.placesContent;
    const hours = placesOpeningHours(record, new Date(now), PLACES_REFRESH_DAYS);
    if (hours && record?.regularOpeningHours) {
      lines = hoursLines(hours);
      source = { kind: "directory", label: `Google Places. Checked ${record.regularOpeningHours.observedAt.slice(0, 10)}` };
    } else {
      const facts = detail.venue.siteFacts;
      const age = facts ? now - Date.parse(`${facts.readOn}T00:00:00Z`) : NaN;
      const url = firstHttp(facts?.sourceUrl);
      if (facts?.hours && url && age >= 0 && age <= OPENING_EVIDENCE_FRESH_DAYS * DAY_MS) {
        lines = hoursLines(facts.hours.hours);
        source = { kind: "directory", label: `${venue.name} website. Checked ${facts.readOn}`, url };
      }
    }
  }
  if (!lines.length) {
    const schedule = (await planOpeningSchedulesForVenues([venue])).get(venue.id);
    const age = schedule ? now - Date.parse(schedule.source.observedAt) : NaN;
    const url = firstHttp(schedule?.source.url);
    if (schedule?.venueListedOpen && url && schedule.source.label.trim()
      && age >= 0 && age <= OPENING_EVIDENCE_FRESH_DAYS * DAY_MS) {
      lines = schedule.ranges.map((range) => `${range.weekday} ${range.startsAt} to ${range.endsAt}`);
      source = { kind: "directory", label: `${schedule.source.label}. Checked ${schedule.source.observedAt.slice(0, 10)}`, url };
    }
  }
  const evidence = lines.length > 0 && source ? { lines, source } : null;
  const answer = evidence
    ? `${venue.name}: recorded regular opening hours: ${evidence.lines.join(", ")}. Source: ${evidence.source.label}. Holiday and one-off hours may differ.`
    : `Opening hours for ${venue.name} are not known from a current record.`;
  return {
    ...empty,
    data: { venueId: venue.id, hours: evidence?.lines ?? null },
    cards: [{ key: `hours:${venue.id}`, venueId: venue.id, title: venue.name, place: venue.area,
      price: null, note: answer, ...(evidence ? { provenance: evidence.source } : {}) }],
    provenance: evidence ? [evidence.source] : [],
    answerHint: answer,
  };
}

export async function searchVenueHours(query: string, ctx: AskToolContext): Promise<AskToolResult> {
  try {
    return await readVenueHours(query, ctx);
  } catch {
    return {
      ok: false, tool: "search_venues", data: null, cards: [], proposals: [], provenance: [],
      degraded: true, answerHint: "I couldn't check the opening hours. Try the pub's own website.",
    };
  }
}

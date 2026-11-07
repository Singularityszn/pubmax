// The words an open crawl's link preview prints (launch plan P0 item 4).
//
// A pure leaf: the server loader (lib/openCrawlShareCard.server.ts) reads the
// facts, and the crew page's metadata, its share image and the public preview
// all print them through these functions, so a card on X and the page it
// opens can never say two different things.
//
// What a stranger may read: the host's PUBLIC handle, the day and time, the
// area, the meeting pub, the places left and the pint price band. Never a
// member, never the stop list. Exact stops stay for members.

import { displayHandle } from "@/lib/handleDisplay";
import {
  formatPlanInviteSpendBand,
  type PlanInviteSpendBand,
} from "@/lib/shareArtifacts";
import { openCrawlPlacesLine } from "@/lib/openCrawl";
import type { VenueAreaRelation } from "@/lib/venueTruth";

export type OpenCrawlShareArea = {
  name: string;
  relation: Exclude<VenueAreaRelation, "unplaced">;
};

export type OpenCrawlShareCard = {
  crewId: string;
  title: string;
  hostHandle: string;
  startsAt: string;
  meetingPubName: string;
  /** Null when the meeting pub sits in no area we curate. */
  area: OpenCrawlShareArea | null;
  /** Null when the crew carries no capacity (an open crew with no open crawl facts). */
  placesLeft: number | null;
  /** Null unless EVERY stop has a listed pint price. Never a per-person total. */
  spendBand: PlanInviteSpendBand | null;
};

const LONDON = "Europe/London";

/** "Thu 12 Nov" in London time, or null on a start we cannot read. */
export function openCrawlShareDay(startsAt: string): string | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: LONDON,
  }).format(new Date(start));
}

/** "19:00" in London time, or null on a start we cannot read. */
export function openCrawlShareTime(startsAt: string): string | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: LONDON,
  }).format(new Date(start));
}

/** "Thu 12 Nov, 19:00", or null on a start we cannot read. */
export function openCrawlShareWhen(startsAt: string): string | null {
  const day = openCrawlShareDay(startsAt);
  const time = openCrawlShareTime(startsAt);
  return day && time ? `${day}, ${time}` : null;
}

/** "in Soho" for a pub inside an area's core, "near Soho" for one in its outer band. */
export function openCrawlShareAreaLine(area: OpenCrawlShareArea | null): string | null {
  if (!area) return null;
  return area.relation === "inside" ? `in ${area.name}` : `near ${area.name}`;
}

/** "5 places left", "Full", or null when the crew carries no capacity. */
export function openCrawlSharePlacesLine(placesLeft: number | null): string | null {
  if (placesLeft === null) return null;
  return placesLeft > 0 ? openCrawlPlacesLine(placesLeft) : "Full";
}

/** The link title: the night's name and the host's public handle. */
export function openCrawlShareTitle(card: Pick<OpenCrawlShareCard, "title" | "hostHandle">): string {
  return `${card.title} · open crawl hosted by ${displayHandle(card.hostHandle)}`;
}

/**
 * The link description, one fact per clause:
 * "Thu 12 Nov, 19:00 in Soho. Meet at The Blue Posts. 5 places left. £4.50–£6.20 per pint."
 */
export function openCrawlShareDescription(card: OpenCrawlShareCard): string {
  const when = openCrawlShareWhen(card.startsAt) ?? "Time to be confirmed";
  const area = openCrawlShareAreaLine(card.area);
  const sentences = [area ? `${when} ${area}.` : `${when}.`, `Meet at ${card.meetingPubName}.`];
  const places = openCrawlSharePlacesLine(card.placesLeft);
  if (places) sentences.push(`${places}.`);
  if (card.spendBand) sentences.push(`${formatPlanInviteSpendBand(card.spendBand)}.`);
  return sentences.join(" ");
}

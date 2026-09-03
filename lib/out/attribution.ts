import type { WhatsOnRow } from "@/lib/whatsOn";

export const OUT_CARD_SOURCES = ["ticketmaster", "skiddle", "common", "venue"] as const;
export type OutCardSource = (typeof OUT_CARD_SOURCES)[number];

export type OutSourceCredit = {
  label: string;
  logoRequired: boolean;
  url: string;
};

const SKIDDLE_HOME = "https://www.skiddle.com/";
const TICKETMASTER_HOME = "https://www.ticketmaster.co.uk/";
const COMMON_HOME = "https://www.common-social.com/";

// The Skiddle fence lives in lib/whatson/eventNormalise.mjs, which both supply
// lanes read. It is deliberately NOT re-exported here: this module is reached
// from app/out/OutClient.tsx ("use client"), and a re-export is not shaken out
// of a module the bundler treats as side-effectful, so it would drag the whole
// normaliser and the city bounds into the browser bundle for a symbol no
// client reads.

export function outCardSource(label: string): OutCardSource {
  const normalised = label.trim().toLowerCase();
  if (normalised === "ticketmaster") return "ticketmaster";
  if (normalised === "skiddle") return "skiddle";
  if (normalised === "common") return "common";
  return "venue";
}

// How a publisher is SPELLED, in one place. A row carries the label its own
// lane wrote down ("common"), and matching stays case-insensitive through
// outCardSource, so nothing depends on the spelling - but a reader sees these
// three names side by side and one of them may not arrive in lower case.
// A venue's own listing keeps its own name, which is not ours to restyle.
const SOURCE_DISPLAY_LABELS: Record<Exclude<OutCardSource, "venue">, string> = {
  ticketmaster: "Ticketmaster",
  skiddle: "Skiddle",
  common: "Common",
};

export function outSourceDisplayLabel(label: string): string {
  const key = outCardSource(label);
  return key === "venue" ? label : SOURCE_DISPLAY_LABELS[key];
}

// The hosts each named publisher actually serves its own event pages from.
//
// Ticketmaster's Discovery API answers with white-label partner links as well
// as its own: about a third of a London night comes back on universe.com, a
// platform Ticketmaster owns but which is not ticketmaster.co.uk to anybody
// reading the address bar. A credit that says only "Ticketmaster" over a link
// to somewhere else names the wrong place at the exact point the claim is made.
//
// A venue's own listing is not in this table: its label IS its own name, so
// there is no publisher for a host to disagree with.
const SOURCE_HOSTS: Record<Exclude<OutCardSource, "venue">, readonly string[]> = {
  ticketmaster: ["ticketmaster.co.uk", "ticketmaster.com"],
  skiddle: ["skiddle.com"],
  common: ["common-social.com"],
};

function parsedUrl(url: string): URL | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/** The host as a reader would say it, with a bare `www.` prefix dropped. */
function readableHost(parsed: URL): string {
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

function hostBelongsToPublisher(parsed: URL, key: OutCardSource): boolean {
  if (key === "venue") return true;
  const host = parsed.hostname.toLowerCase();
  return SOURCE_HOSTS[key].some((owned) => host === owned || host.endsWith(`.${owned}`));
}

/**
 * Whether a URL points at a page about ONE event, rather than at a publisher's
 * front door.
 *
 * A homepage is a real link to a real publisher, which is what makes it the
 * dishonest answer here: printed beside a listing it reads as "this event, at
 * the source", and it is not. A credit with no event page to open says the
 * publisher's name and opens nothing.
 */
export function outSourceLinksToEventPage(url: string): boolean {
  const parsed = parsedUrl(url);
  if (!parsed) return false;
  const path = parsed.pathname.replace(/\/+$/, "");
  return path !== "";
}

export type OutRowSourceCredit = {
  /** What the credit says: the publisher, and the destination when they differ. */
  label: string;
  /** The event page, or null when there is no event page to open. */
  href: string | null;
};

/**
 * The credit one listing prints, and where it goes.
 *
 * ONE owner for both halves, because they are one claim: a reader takes the
 * name to be a promise about the link. Keeping them apart is how "Ticketmaster"
 * came to stand over a universe.com address.
 */
export function outRowSourceCredit(source: {
  label: string;
  url: string;
}): OutRowSourceCredit {
  const publisher = outSourceDisplayLabel(source.label);
  const parsed = parsedUrl(source.url);
  const href = outSourceLinksToEventPage(source.url) ? source.url.trim() : null;
  if (!parsed || hostBelongsToPublisher(parsed, outCardSource(source.label))) {
    return { label: publisher, href };
  }
  // The publisher stays named - the feed is theirs and the attribution is owed
  // to them - and the destination is named beside it, so the words and the
  // address agree before the tap rather than after it.
  return { label: `${publisher} · ${readableHost(parsed)}`, href };
}

export function outSourceAttributionFromLabels(labels: readonly string[]): OutSourceCredit[] {
  const seen = new Map<OutCardSource, OutSourceCredit>();
  for (const label of labels) {
    const key = outCardSource(label);
    if (seen.has(key)) continue;
    if (key === "skiddle") {
      seen.set(key, { label: SOURCE_DISPLAY_LABELS.skiddle, logoRequired: true, url: SKIDDLE_HOME });
    } else if (key === "ticketmaster") {
      seen.set(key, {
        label: SOURCE_DISPLAY_LABELS.ticketmaster,
        logoRequired: false,
        url: TICKETMASTER_HOME,
      });
    } else if (key === "common") {
      seen.set(key, { label: SOURCE_DISPLAY_LABELS.common, logoRequired: false, url: COMMON_HOME });
    }
  }
  return [...seen.values()];
}

export function outSourceAttribution(rows: readonly WhatsOnRow[]): OutSourceCredit[] {
  return outSourceAttributionFromLabels(rows.map((row) => row.source.label));
}

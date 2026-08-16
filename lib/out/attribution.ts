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

/**
 * Skiddle's licence asks for the name, the LOGO and a link to the event's own
 * skiddle.com page whenever one of their rows is on screen. We hold the name
 * and the link; the official logo asset is ABSENT and pending from the captain,
 * and drawing a lookalike would satisfy no licence while imitating another
 * company's wordmark.
 *
 * So this is the fence, not the missing API key: while the asset is absent the
 * Skiddle lane is off, and no Skiddle row can reach a reader with an
 * obligation we cannot discharge. Set this true in the same change that adds
 * the supplied asset, and the lane returns to being gated on SKIDDLE_API_KEY
 * alone.
 */
export const SKIDDLE_BRAND_ASSET_PRESENT = false;

/** True while a Skiddle row may not be served at all. */
export function skiddleLaneFenced(): boolean {
  return !SKIDDLE_BRAND_ASSET_PRESENT;
}

export function outCardSource(label: string): OutCardSource {
  const normalised = label.trim().toLowerCase();
  if (normalised === "ticketmaster") return "ticketmaster";
  if (normalised === "skiddle") return "skiddle";
  if (normalised === "common") return "common";
  return "venue";
}

export function outSourceAttribution(rows: readonly WhatsOnRow[]): OutSourceCredit[] {
  const seen = new Map<OutCardSource, OutSourceCredit>();
  for (const row of rows) {
    const key = outCardSource(row.source.label);
    if (seen.has(key)) continue;
    if (key === "skiddle") {
      seen.set(key, { label: "Skiddle", logoRequired: true, url: SKIDDLE_HOME });
    } else if (key === "ticketmaster") {
      seen.set(key, { label: "Ticketmaster", logoRequired: false, url: TICKETMASTER_HOME });
    } else if (key === "common") {
      seen.set(key, { label: "common", logoRequired: false, url: COMMON_HOME });
    }
  }
  return [...seen.values()];
}

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

// The fence is owned by lib/whatson/eventNormalise.mjs, which the build-time
// refresh CLI reads too - a second copy here would let the read seam and the
// write seam disagree about whether the lane is shut.
export { SKIDDLE_BRAND_ASSET_PRESENT, skiddleLaneFenced } from "@/lib/whatson/eventNormalise.mjs";

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

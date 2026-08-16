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

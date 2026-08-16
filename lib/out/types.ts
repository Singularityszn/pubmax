import type { OutSourceCredit } from "@/lib/out/attribution";
import type { WhatsOnRow } from "@/lib/whatsOn";

export const MAX_OUT_EVENTS = 100;
export const OUT_DAYS = ["today", "tomorrow", "weekend"] as const;
export type OutDay = (typeof OUT_DAYS)[number];

export type OutQuery = {
  city: string;
  day: OutDay;
};

/**
 * What a public caller is told about one lane.
 *
 * `status` is the reader-visible fact and the whole of it. The upstream error
 * text stays in the server log: this body is public and CDN-cacheable, and an
 * upstream diagnostic string is not something a stranger is owed.
 */
export type OutProviderStatus = "ready" | "degraded" | "not-configured";

export type OutProviderReport = {
  name: string;
  configured: boolean;
  rows: number;
  status: OutProviderStatus;
};

/**
 * A lane that was never ASKED cannot produce a ready answer, and a missing key
 * is never an empty-market claim - so "not-configured" is a body status of its
 * own, weaker than degraded (which means we looked and could not see).
 */
export type OutStatus = "ready" | "degraded" | "not-configured";

export type OutResponse = {
  status: OutStatus;
  events: WhatsOnRow[];
  openPlans: [];
  attribution: OutSourceCredit[];
  observedAt: Record<string, string>;
  providers: OutProviderReport[];
  /** Why a degraded answer is degraded, in words a reader can act on. */
  reason?: string;
};

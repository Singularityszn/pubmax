import type { EventsProviderReport } from "@/lib/events/provider";
import type { OutSourceCredit } from "@/lib/out/attribution";
import type { WhatsOnRow } from "@/lib/whatsOn";

export const MAX_OUT_EVENTS = 100;
export const OUT_DAYS = ["today", "tomorrow", "weekend"] as const;
export type OutDay = (typeof OUT_DAYS)[number];

export type OutQuery = {
  city: string;
  day: OutDay;
};

export type OutResponse = {
  status: "ready" | "degraded";
  events: WhatsOnRow[];
  openPlans: [];
  attribution: OutSourceCredit[];
  observedAt: Record<string, string>;
  providers: EventsProviderReport[];
};

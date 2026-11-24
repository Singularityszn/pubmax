import "server-only";

import { randomUUID } from "node:crypto";
import { matchesPriceAlert, type PriceAlertObservation, type PriceAlertPreference } from "@/lib/priceAlert";
import { formatGbp } from "@/lib/formatGbp";
import type { PushDispatchSummary } from "@/lib/pushSender";

export type PriceAlertRecipient = PriceAlertPreference & { userId: string; token: string };
export type PriceAlertEvent = PriceAlertObservation & {
  id: string;
  venueId: string;
  venueName: string;
  observedAt: string;
  sourceLabel: string;
  visibility: string;
  status: string;
  measure: string;
};
type PriceAlertPayload = { title: string; body: string; url: string };
export type PriceAlertDelivery = {
  claim: (userId: string, eventId: string, recipient: PriceAlertRecipient, recordedAt: string, attempt: string, event: PriceAlertEvent) => Promise<boolean>;
  settle: (userId: string, eventId: string, attempt: string, state: PriceAlertDeliveryOutcome) => Promise<void>;
  send: (token: string, payload: PriceAlertPayload, userId: string) => Promise<PriceAlertDeliveryOutcome>;
};
export type PriceAlertDeliveryOutcome = "retryable" | "delivered" | "terminal" | "unknown";
export function priceAlertDeliveryOutcome(result: PushDispatchSummary): PriceAlertDeliveryOutcome {
  const item = result.results[0];
  if (!item) return "unknown";
  if (item.status === "sent") return "delivered";
  if (item.status === "invalid") return "terminal";
  if (item.status === "skipped") return "retryable";
  const status = /^web_push_(\d{3})$/.exec(item.reason ?? "")?.[1];
  if (!status) return "unknown";
  const code = Number(status);
  return code === 429 || code >= 500 ? "retryable" : "terminal";
}
type Dependencies = PriceAlertDelivery & { list: (observation: PriceAlertObservation) => Promise<PriceAlertRecipient[]> };

export async function dispatchPriceAlert(event: PriceAlertEvent, deps: Dependencies, recordedAt: string): Promise<boolean> {
  const date = new Date(event.observedAt);
  if (!event.id || !event.venueId || !event.venueName.trim() || !event.sourceLabel.trim() || !Number.isFinite(date.getTime())) return false;
  if ((event.visibility !== "public" && event.visibility !== "anonymous") || event.status !== "visible" || event.measure !== "pint") return false;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(date);
  const payload = {
    title: "Pint price in your area",
    body: `${event.sourceLabel} reported ${formatGbp(event.pricePence / 100)} at ${event.venueName}, ${day}.`,
    url: `/map?sel=${encodeURIComponent(event.venueId)}`,
  };
  let claimed = false;
  const failures: unknown[] = [];
  for (const recipient of await deps.list(event)) {
    if (!matchesPriceAlert(recipient, event) || !recipient.token) continue;
    const attempt = randomUUID();
    try {
      if (await deps.claim(recipient.userId, event.id, recipient, recordedAt, attempt, event)) {
        claimed = true;
        let outcome: PriceAlertDeliveryOutcome = "unknown";
        try { outcome = await deps.send(recipient.token, payload, recipient.userId); } catch { /* delivery may have reached the provider */ }
        await deps.settle(recipient.userId, event.id, attempt, outcome);
      }
    } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Price alert recipients failed");
  return claimed;
}

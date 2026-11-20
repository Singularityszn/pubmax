import "server-only";

import { matchesPriceAlert, type PriceAlertObservation, type PriceAlertPreference } from "@/lib/priceAlert";
import { formatGbp } from "@/lib/formatGbp";

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
  claim: (userId: string, eventId: string, recipient: PriceAlertRecipient, recordedAt: string) => Promise<boolean>;
  send: (token: string, payload: PriceAlertPayload, userId: string) => Promise<unknown>;
};
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
  for (const recipient of await deps.list(event)) {
    if (!matchesPriceAlert(recipient, event) || !recipient.token) continue;
    try {
      if (await deps.claim(recipient.userId, event.id, recipient, recordedAt)) {
        claimed = true;
        await deps.send(recipient.token, payload, recipient.userId);
      }
    } catch {
      console.error("[price-alert] could not deliver an alert");
    }
  }
  return claimed;
}

import "server-only";

import { matchesPriceAlert, type PriceAlertObservation, type PriceAlertPreference } from "@/lib/priceAlert";
import { formatGbp } from "@/lib/formatGbp";

type Recipient = PriceAlertPreference & { userId: string; token: string };
export type PriceAlertEvent = PriceAlertObservation & {
  id: string;
  venueId: string;
  venueName: string;
  observedAt: string;
  visibility: string;
  status: string;
  measure: string;
};
type Payload = { title: string; body: string; url: string };
type Dependencies = {
  list: (observation: PriceAlertObservation) => Promise<Recipient[]>;
  claim: (userId: string, eventId: string, recipient: Recipient) => Promise<boolean>;
  send: (token: string, payload: Payload, userId: string) => Promise<unknown>;
};

export async function dispatchPriceAlert(event: PriceAlertEvent, deps: Dependencies): Promise<void> {
  const date = new Date(event.observedAt);
  if (!event.id || !event.venueId || !event.venueName.trim() || !Number.isFinite(date.getTime())) return;
  if ((event.visibility !== "public" && event.visibility !== "anonymous") || event.status !== "visible" || event.measure !== "pint") return;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(date);
  const payload = {
    title: "Pint Drop in your area",
    body: `Pint Drop reported ${formatGbp(event.pricePence / 100)} at ${event.venueName}, ${day}.`,
    url: `/map?sel=${encodeURIComponent(event.venueId)}`,
  };
  for (const recipient of await deps.list(event)) {
    if (!matchesPriceAlert(recipient, event) || !recipient.token) continue;
    try {
      if (await deps.claim(recipient.userId, event.id, recipient)) await deps.send(recipient.token, payload, recipient.userId);
    } catch {
      console.error("[price-alert] could not deliver an alert");
    }
  }
}

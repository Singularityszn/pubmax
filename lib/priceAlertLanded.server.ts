import "server-only";

import type { PintDrop } from "@/lib/pintDropShared";
import { measureIsPint } from "@/lib/drinkMeasure";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { dispatchPriceAlert, priceAlertDeliveryOutcome, type PriceAlertEvent } from "@/lib/priceAlertDispatch.server";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { priceAlertVenue } from "@/lib/priceAlertVenue.server";
import { fireAndForgetPush, sendPriceAlert } from "@/lib/pushSender";
import { getVenueIndexSnapshot } from "@/lib/venueIndex";
import { confirmedPriceDrop } from "@/lib/venues";

// An area alert speaks only for a confirmed pair (captain, 22 Nov 2026). A
// single unchecked Pint Drop would spend each subscriber's one alert for the
// day on a price nobody else has seen. The sender reads a pair member back
// after the write. Delivery eligibility uses the confirmation time, while
// the notification keeps that member's observation date.
export async function confirmedPriceAlertEvent(venueId: string, dropId?: string): Promise<{ event: PriceAlertEvent; recordedAt: string } | null> {
  const drops = await pintDropsStore().listConfirmationCandidates(venueId);
  const confirmed = confirmedPriceDrop(drops);
  const visible = dropId ? drops.find((item) => item.id === dropId) : confirmed;
  const confirmation = confirmed?.confirmation;
  if (!visible || !visible.priceGbp || confirmation?.basis !== "second_reporter") return null;
  if (visible.confirmation?.confirmationId !== confirmation.confirmationId) return null;
  const snapshot = await getVenueIndexSnapshot();
  if (!snapshot.loadedCities.has("london")) throw new Error("London venue data is unavailable");
  const venue = await priceAlertVenue(visible.venueId, snapshot.index);
  if (!venue || venue.retired) return null;
  return { event: {
    id: `pint-drop-confirmation:${confirmation.confirmationId}`,
    venueId: visible.venueId,
    venueName: venue.name,
    pricePence: Math.round(visible.priceGbp * 100),
    lat: venue.lat,
    lng: venue.lng,
    observedAt: visible.createdAt,
    sourceLabel: "Two drinkers",
    visibility: visible.visibility ?? "public",
    status: visible.status,
    measure: visible.measure ?? "pint",
  }, recordedAt: confirmation.confirmedAt };
}

export function signalPriceAlert(drop: PintDrop): void {
  const visibility = drop.visibility ?? "public";
  if (!drop.priceGbp || !measureIsPint(drop.measure) || drop.status !== "visible" || (visibility !== "public" && visibility !== "anonymous")) return;
  fireAndForgetPush(async () => {
    const current = await confirmedPriceAlertEvent(drop.venueId, drop.id);
    if (!current) return;
    const store = priceAlertStore();
    await dispatchPriceAlert(current.event, {
      list: (observation) => store.list(observation),
      claim: (userId, eventId, recipient, recordedAt, attempt, event) => store.claim(userId, eventId, recipient, recordedAt, attempt, event),
      settle: (userId, eventId, attempt, state) => store.settle(userId, eventId, attempt, state),
      send: async (token, payload, userId) => {
        const result = await sendPriceAlert(token, payload);
        if (result.results.some((item) => item.status === "invalid")) await store.removeIfToken(userId, token);
        return priceAlertDeliveryOutcome(result);
      },
    }, current.recordedAt);
  });
}

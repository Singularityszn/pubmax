import "server-only";

import type { PintDrop } from "@/lib/pintDropShared";
import { measureIsPint } from "@/lib/drinkMeasure";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { dispatchPriceAlert, priceAlertDeliveryOutcome } from "@/lib/priceAlertDispatch.server";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { priceAlertVenue } from "@/lib/priceAlertVenue.server";
import { fireAndForgetPush, sendPriceAlert } from "@/lib/pushSender";
import { getVenueIndex } from "@/lib/venueIndex";
import { confirmedPriceDrop } from "@/lib/venues";

// An area alert speaks only for a confirmed pair (captain, 22 Nov 2026). A
// single unchecked Pint Drop would spend each subscriber's one alert for the
// day on a price nobody else has seen. The sender reads a pair member back
// after the write. Delivery eligibility uses the confirmation time, while
// the notification keeps that member's observation date.
export function signalPriceAlert(drop: PintDrop): void {
  const visibility = drop.visibility ?? "public";
  if (!drop.priceGbp || !measureIsPint(drop.measure) || drop.status !== "visible" || (visibility !== "public" && visibility !== "anonymous")) return;
  fireAndForgetPush(async () => {
    const drops = await pintDropsStore().listConfirmationCandidates(drop.venueId);
    const visible = drops.find((item) => item.id === drop.id);
    const confirmation = confirmedPriceDrop(drops)?.confirmation;
    if (!visible || !visible.priceGbp || confirmation?.basis !== "second_reporter") return;
    if (visible.confirmation?.confirmationId !== confirmation.confirmationId) return;
    const venue = await priceAlertVenue(visible.venueId, await getVenueIndex());
    if (!venue || venue.retired) return;
    const store = priceAlertStore();
    await dispatchPriceAlert({
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
    }, {
      list: (observation) => store.list(observation),
      claim: (userId, eventId, recipient, recordedAt, attempt, event) => store.claim(userId, eventId, recipient, recordedAt, attempt, event),
      settle: (userId, eventId, attempt, state) => store.settle(userId, eventId, attempt, state),
      send: async (token, payload, userId) => {
        const result = await sendPriceAlert(token, payload);
        if (result.results.some((item) => item.status === "invalid")) await store.removeIfToken(userId, token);
        return priceAlertDeliveryOutcome(result);
      },
    }, confirmation.confirmedAt);
  });
}

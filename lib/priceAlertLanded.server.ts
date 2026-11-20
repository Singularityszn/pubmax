import "server-only";

import type { PintDrop } from "@/lib/pintDropShared";
import { measureIsPint } from "@/lib/drinkMeasure";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { dispatchPriceAlert } from "@/lib/priceAlertDispatch.server";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { priceAlertVenue } from "@/lib/priceAlertVenue.server";
import { fireAndForgetPush, sendPriceAlert } from "@/lib/pushSender";
import { getVenueIndex } from "@/lib/venueIndex";

export function signalPriceAlert(drop: PintDrop): void {
  const visibility = drop.visibility ?? "public";
  if (!drop.priceGbp || !measureIsPint(drop.measure) || drop.status !== "visible" || (visibility !== "public" && visibility !== "anonymous")) return;
  fireAndForgetPush(async () => {
    const visible = (await pintDropsStore().listVisible(drop.venueId)).find((item) => item.id === drop.id);
    if (!visible || !visible.priceGbp) return;
    const venue = await priceAlertVenue(visible.venueId, await getVenueIndex());
    if (!venue || venue.retired) return;
    const store = priceAlertStore();
    await dispatchPriceAlert({
      id: `pint-drop:${visible.id}`,
      venueId: visible.venueId,
      venueName: venue.name,
      pricePence: Math.round(visible.priceGbp * 100),
      lat: venue.lat,
      lng: venue.lng,
      observedAt: visible.createdAt,
      sourceLabel: "Pint Drop",
      visibility: visible.visibility ?? "public",
      status: visible.status,
      measure: visible.measure ?? "pint",
    }, {
      list: (observation) => store.list(observation),
      claim: (userId, eventId, recipient, recordedAt) => store.claim(userId, eventId, recipient, recordedAt),
      send: async (token, payload, userId) => {
        const result = await sendPriceAlert(token, payload);
        if (result.results.some((item) => item.status === "invalid")) await store.removeIfToken(userId, token);
      },
    });
  });
}

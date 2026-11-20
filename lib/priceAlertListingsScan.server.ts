import "server-only";

import { fingerprintedListedPriceRows, listedPriceAlertId, listedPriceAlertEvents, dispatchListedPriceAlerts } from "@/lib/priceAlertListings.server";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { priceAlertVenue } from "@/lib/priceAlertVenue.server";
import { sendPriceAlert } from "@/lib/pushSender";
import { admin, selectStore } from "@/lib/storeBackend";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { getVenueIndexSnapshot } from "@/lib/venueIndex";

const memorySeen = new Map<string, string>();
const memory = {
  async observe(ids: string[]) { const now = new Date().toISOString(); for (const id of ids) if (!memorySeen.has(id)) memorySeen.set(id, now); },
  async firstSeen(ids: string[]) { return new Map(ids.flatMap((id) => { const date = memorySeen.get(id); return date ? [[id, date] as const] : []; })); },
};
const durable = {
  async observe(ids: string[]) {
    const { error } = await admin().rpc("price_alert_observe_listings", { p_ids: ids });
    if (error) throw error;
  },
  async firstSeen(ids: string[]) {
    const seen = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await admin().from("price_alert_listing_seen").select("event_id, first_seen").in("event_id", ids.slice(i, i + 500));
      if (error) throw error;
      for (const row of data ?? []) seen.set(String(row.event_id), String(row.first_seen));
    }
    return seen;
  },
};

async function observeBundle() {
  const bundle = await ukPriceBundleRowsByVenue();
  if (bundle.status !== "ready") throw new Error("Listed prices are unavailable");
  const rows = fingerprintedListedPriceRows([...bundle.byVenue.values()].flat());
  const ids = [...new Set(rows.map(listedPriceAlertId))];
  const store = selectStore(memory, durable);
  await store.observe(ids);
  return { rows, ids, store };
}

export async function prepareListedPriceBaseline(): Promise<void> {
  await observeBundle();
}

export async function scanListedPriceAlerts(): Promise<void> {
  const { rows, ids, store: seenStore } = await observeBundle();
  const store = priceAlertStore();
  const recipients = await store.listAll();
  if (!recipients.length) return;
  const firstSeen = await seenStore.firstSeen(ids);
  const earliest = Math.min(...recipients.map((recipient) => Date.parse(recipient.enabledAt)));
  const candidates = rows.filter((row) => Date.parse(row.observedAt) > earliest && Date.parse(firstSeen.get(listedPriceAlertId(row)) ?? "") > earliest);
  if (!candidates.length) return;
  const snapshot = await getVenueIndexSnapshot();
  if (!snapshot.loadedCities.has("london")) throw new Error("London venue data is unavailable");
  const venues = new Map(snapshot.index);
  for (const id of new Set(candidates.map((row) => row.venueId))) {
    if (!venues.has(id)) {
      const venue = await priceAlertVenue(id, venues);
      if (venue) venues.set(id, venue);
    }
  }
  await dispatchListedPriceAlerts(listedPriceAlertEvents(candidates, venues), recipients, {
    claim: (userId, eventId, recipient, recordedAt) => store.claim(userId, eventId, recipient, recordedAt),
    send: async (token, payload, userId) => {
      const result = await sendPriceAlert(token, payload);
      if (result.results.some((item) => item.status === "invalid")) await store.removeIfToken(userId, token);
    },
  }, firstSeen);
}

import "server-only";

import { fingerprintedListedPriceRows, listedPriceAlertId, listedPriceAlertEvents, dispatchListedPriceAlerts } from "@/lib/priceAlertListings.server";
import { dispatchPriceAlert, priceAlertDeliveryOutcome, type PriceAlertDelivery } from "@/lib/priceAlertDispatch.server";
import { confirmedPriceAlertEvent } from "@/lib/priceAlertLanded.server";
import { matchesPriceAlert } from "@/lib/priceAlert";
import { listedPriceExpired } from "@/lib/priceTier";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { priceAlertVenue } from "@/lib/priceAlertVenue.server";
import { newPriceAlertSnapshotLease, priceAlertSnapshotStore, priceAlertSnapshotVersion } from "@/lib/priceAlertSnapshotJob.server";
import { sendPriceAlert } from "@/lib/pushSender";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { getVenueIndexSnapshot } from "@/lib/venueIndex";

const OBSERVATION_BATCH = 500;
const TIMESTAMP_BATCH = 100;
const RECIPIENT_BATCH = 25;
const JOB_BUDGET_MS = 20_000;

async function loadListingBaseline(complete: boolean) {
  const bundle = complete ? null : await ukPriceBundleRowsByVenue();
  if (bundle && bundle.status !== "ready") throw new Error("Listed prices are unavailable");
  const byId = new Map(bundle ? fingerprintedListedPriceRows([...bundle.byVenue.values()].flat()).map((row) => [listedPriceAlertId(row), row]) : []);
  const ids = [...byId.keys()].sort((a, b) => Date.parse(byId.get(b)!.observedAt) - Date.parse(byId.get(a)!.observedAt) || (a < b ? -1 : a > b ? 1 : 0));
  return { byId, ids };
}

export async function scanListedPriceAlerts(requestStartedAt: number = Date.now()) {
  const deadline = requestStartedAt + JOB_BUDGET_MS;
  const version = priceAlertSnapshotVersion();
  const lease = newPriceAlertSnapshotLease();
  const snapshots = priceAlertSnapshotStore();
  const store = priceAlertStore();
  if (Date.now() >= deadline) return { ...await store.backlog(), incomplete: true };
  const progress = await snapshots.claim(version, lease);
  if (!progress) return { ...await store.backlog(), incomplete: true };
  let { phase, observationOffset, eventOffset, recipientCursor } = progress;
  let { retryUser, retryEvent } = progress;
  let released = false;
  const delivery: PriceAlertDelivery = {
    claim: (userId, eventId, recipient, recordedAt, attempt, event) => store.claim(userId, eventId, recipient, recordedAt, attempt, event),
    settle: (userId, eventId, attempt, state) => store.settle(userId, eventId, attempt, state),
    send: async (token, payload, userId) => {
      const result = await sendPriceAlert(token, payload);
      if (result.results.some((item) => item.status === "invalid")) {
        try { await store.removeIfToken(userId, token); }
        catch (error) { console.error("[price-alert] token cleanup failed:", error); }
      }
      return priceAlertDeliveryOutcome(result);
    },
  };
  const release = async (complete: boolean) => {
    await snapshots.advance(version, lease, eventOffset, recipientCursor, complete, true);
    released = true;
  };
  const report = async (complete: boolean, incomplete: boolean) => {
    await release(complete);
    return { ...await store.backlog(), incomplete };
  };
  const retryQueuedAlerts = async () => {
    while (Date.now() < deadline) {
      const page = await store.retryPage(retryUser, retryEvent, RECIPIENT_BATCH);
      if (page.length === 0) {
        retryUser = null;
        retryEvent = null;
        await snapshots.advanceRetry(version, lease, null, null);
        return true;
      }
      for (const item of page) {
        if (Date.now() >= deadline) break;
        if (!item.event.id.startsWith("listed:")) {
          const current = await confirmedPriceAlertEvent(item.event.venueId);
          if (!current || current.event.id !== item.event.id) await store.dismissRetry(item.recipient.userId, item.event.id);
          else await dispatchPriceAlert({ ...item.event, venueName: current.event.venueName, lat: current.event.lat, lng: current.event.lng }, { ...delivery, list: async () => [item.recipient] }, item.recordedAt);
        } else {
          const membership = await snapshots.membership(version, item.event.id);
          if (membership === "missing" || listedPriceExpired(item.event.observedAt)) {
            await store.dismissRetry(item.recipient.userId, item.event.id);
          } else if (membership === "present") {
            const index = await getVenueIndexSnapshot();
            if (!index.loadedCities.has("london")) throw new Error("London venue data is unavailable");
            const venue = await priceAlertVenue(item.event.venueId, index.index);
            if (!venue) await store.dismissRetry(item.recipient.userId, item.event.id);
            else await dispatchPriceAlert({ ...item.event, venueName: venue.name, lat: venue.lat, lng: venue.lng }, { ...delivery, list: async () => [item.recipient] }, item.recordedAt);
          }
        }
        retryUser = item.recipient.userId;
        retryEvent = item.event.id;
        await snapshots.advanceRetry(version, lease, retryUser, retryEvent);
      }
    }
    return false;
  };
  try {
    const { byId, ids } = await loadListingBaseline(phase === "complete");

    while (phase === "indexing" && Date.now() < deadline) {
      const batch = ids.slice(observationOffset, observationOffset + OBSERVATION_BATCH);
      const last = observationOffset + batch.length >= ids.length;
      await snapshots.observe(version, lease, observationOffset, batch, last);
      observationOffset += batch.length;
      if (last) phase = "dispatch";
    }
    if (phase === "indexing") {
      return await report(false, true);
    }

    if (Date.now() >= deadline) {
      return await report(false, true);
    }
    const activated = await store.activatePending(version, lease, RECIPIENT_BATCH);
    const activationPending = activated === RECIPIENT_BATCH;

    const retryComplete = await retryQueuedAlerts();
    if (!retryComplete) {
      return await report(false, true);
    }
    if (phase === "complete") {
      return await report(true, activationPending);
    }

    const enabledAt = await store.earliestEnabledAt();
    const earliest = enabledAt === null ? Infinity : Date.parse(enabledAt);
    let firstSeen = new Map<string, string>();
    let timestampEnd = eventOffset;
    while (eventOffset < ids.length && Date.now() < deadline) {
      if (eventOffset >= timestampEnd) {
        const batch = ids.slice(eventOffset, eventOffset + TIMESTAMP_BATCH);
        firstSeen = await snapshots.firstSeen(batch);
        timestampEnd = eventOffset + batch.length;
      }
      const id = ids[eventOffset]!;
      const recordedAt = firstSeen.get(id);
      if (!recordedAt || !(Date.parse(recordedAt) > earliest)) {
        eventOffset++;
        recipientCursor = null;
        continue;
      }
      const recipients = await store.listAll(recipientCursor, RECIPIENT_BATCH);
      if (recipients.length === 0) {
        eventOffset = recipientCursor === null ? ids.length : eventOffset + 1;
        recipientCursor = null;
      } else {
        const row = byId.get(id)!;
        const snapshot = await getVenueIndexSnapshot();
        if (!snapshot.loadedCities.has("london")) throw new Error("London venue data is unavailable");
        const venues = new Map(snapshot.index);
        if (!venues.has(row.venueId)) {
          const venue = await priceAlertVenue(row.venueId, venues);
          if (venue) venues.set(row.venueId, venue);
        }
        const events = listedPriceAlertEvents([row], venues);
        if (events.length === 0) {
          eventOffset++;
          recipientCursor = null;
          continue;
        }
        for (const recipient of recipients) {
          if (Date.now() >= deadline) break;
          if (!(Date.parse(recordedAt) > Date.parse(recipient.enabledAt)) || !events.some((event) => matchesPriceAlert(recipient, event))) {
            recipientCursor = recipient.userId;
            continue;
          }
          if (!await dispatchListedPriceAlerts(events, [recipient], delivery, firstSeen, deadline)) break;
          recipientCursor = recipient.userId;
          await snapshots.advance(version, lease, eventOffset, recipientCursor, false, false);
        }
      }
    }
    const complete = eventOffset >= ids.length;
    return await report(complete, !complete || activationPending);
  } finally {
    if (!released) await snapshots.advance(version, lease, eventOffset, recipientCursor, false, true);
  }
}

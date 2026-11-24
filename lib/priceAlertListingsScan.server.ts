import "server-only";

import { fingerprintedListedPriceRows, listedPriceAlertId, listedPriceAlertEvents, dispatchListedPriceAlerts } from "@/lib/priceAlertListings.server";
import { dispatchPriceAlert, priceAlertDeliveryOutcome, type PriceAlertDelivery } from "@/lib/priceAlertDispatch.server";
import { confirmedPriceAlertEvent } from "@/lib/priceAlertLanded.server";
import { listedPriceExpired } from "@/lib/priceTier";
import { priceAlertStore } from "@/lib/priceAlertStore";
import { priceAlertVenue } from "@/lib/priceAlertVenue.server";
import { newPriceAlertSnapshotLease, priceAlertSnapshotStore, priceAlertSnapshotVersion } from "@/lib/priceAlertSnapshotJob.server";
import { sendPriceAlert } from "@/lib/pushSender";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { getVenueIndexSnapshot } from "@/lib/venueIndex";

const OBSERVATION_BATCH = 500;
const EVENT_BATCH = 250;
const RECIPIENT_BATCH = 25;
const JOB_BUDGET_MS = 20_000;

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
      if (result.results.some((item) => item.status === "invalid")) await store.removeIfToken(userId, token);
      return priceAlertDeliveryOutcome(result);
    },
  };
  const release = async (complete: boolean) => {
    await snapshots.advance(version, lease, eventOffset, recipientCursor, complete, true);
    released = true;
  };
  try {
    const bundle = phase === "complete" ? null : await ukPriceBundleRowsByVenue();
    if (bundle && bundle.status !== "ready") throw new Error("Listed prices are unavailable");
    const byId = new Map(bundle ? fingerprintedListedPriceRows([...bundle.byVenue.values()].flat()).map((row) => [listedPriceAlertId(row), row]) : []);
    const ids = [...byId.keys()].sort((a, b) => Date.parse(byId.get(b)!.observedAt) - Date.parse(byId.get(a)!.observedAt) || (a < b ? -1 : a > b ? 1 : 0));

    while (phase === "indexing" && Date.now() < deadline) {
      const batch = ids.slice(observationOffset, observationOffset + OBSERVATION_BATCH);
      const last = observationOffset + batch.length >= ids.length;
      await snapshots.observe(version, lease, observationOffset, batch, last);
      observationOffset += batch.length;
      if (last) phase = "dispatch";
    }
    if (phase === "indexing") {
      await release(false);
      return { ...await store.backlog(), incomplete: true };
    }

    if (Date.now() >= deadline) {
      await release(false);
      return { ...await store.backlog(), incomplete: true };
    }
    const activated = await store.activatePending(version, lease, RECIPIENT_BATCH);
    const activationPending = activated === RECIPIENT_BATCH;

    let retryComplete = false;
    while (Date.now() < deadline) {
      const page = await store.retryPage(retryUser, retryEvent, RECIPIENT_BATCH);
      if (page.length === 0) {
        retryUser = null;
        retryEvent = null;
        await snapshots.advanceRetry(version, lease, null, null);
        retryComplete = true;
        break;
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
    if (!retryComplete) {
      await release(false);
      return { ...await store.backlog(), incomplete: true };
    }
    if (phase === "complete") {
      await release(true);
      return { ...await store.backlog(), incomplete: activationPending };
    }

    while (eventOffset < ids.length && Date.now() < deadline) {
      const eventIds = ids.slice(eventOffset, eventOffset + EVENT_BATCH);
      const firstSeen = await snapshots.firstSeen(eventIds);
      const recipients = await store.listAll(recipientCursor, RECIPIENT_BATCH);
      if (recipients.length === 0) {
        eventOffset += eventIds.length;
        recipientCursor = null;
        await snapshots.advance(version, lease, eventOffset, recipientCursor, false, false);
      } else {
        const earliest = Math.min(...recipients.map((recipient) => Date.parse(recipient.enabledAt)));
        const candidates = eventIds.flatMap((id) => {
          const row = byId.get(id);
          return row && Date.parse(firstSeen.get(id) ?? "") > earliest ? [row] : [];
        });
        let events: ReturnType<typeof listedPriceAlertEvents> = [];
        if (candidates.length) {
          const snapshot = await getVenueIndexSnapshot();
          if (!snapshot.loadedCities.has("london")) throw new Error("London venue data is unavailable");
          const venues = new Map(snapshot.index);
          for (const id of new Set(candidates.map((row) => row.venueId))) {
            if (!venues.has(id)) {
              const venue = await priceAlertVenue(id, venues);
              if (venue) venues.set(id, venue);
            }
          }
          events = listedPriceAlertEvents(candidates, venues);
        }
        for (const recipient of recipients) {
          if (Date.now() >= deadline) break;
          await dispatchListedPriceAlerts(events, [recipient], delivery, firstSeen);
          recipientCursor = recipient.userId;
          await snapshots.advance(version, lease, eventOffset, recipientCursor, false, false);
        }
      }
    }
    const complete = eventOffset >= ids.length;
    await release(complete);
    return { ...await store.backlog(), incomplete: !complete || activationPending };
  } finally {
    if (!released) await snapshots.advance(version, lease, eventOffset, recipientCursor, false, true);
  }
}

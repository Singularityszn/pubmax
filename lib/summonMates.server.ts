import "server-only";

// WHO A SUMMON MAY REACH, AND HOW IT GETS THERE. A summon names a pub and a
// time and lands in each chosen mate's direct messages with the pub attached,
// so it reaches the same inbox, unread badge and realtime nudge a message does.
//
// A mate here is a live mutual follow with no block or mute either way.
// A mute requests fewer interactions, so a summon never crosses one. The send
// asks the same question again for every handle it is given, so a list read a
// minute ago, or a hand-made request, cannot reach somebody the check refuses.
//
// The message may carry one dated price. It comes from a fresh read of the
// price rows the pub's public detail serves (lib/venueDetailArtifact.server.ts)
// at send time, judged by lib/summonPrice.ts, never from the request. A failed,
// slow or incomplete read sends the invite without a price. The reader takes no
// signal, so a read past the bound is not cancelled: its answer is ignored. The mutual list and every consent check run again
// after the read, so the wait cannot carry a stale answer into delivery. The
// final check and each write are still separate store calls, not one atomic step.

import { followStore } from "@/lib/followStore";
import { cleanBody } from "@/lib/messages";
import { broadcastMessageSent, deferMessagesSignal } from "@/lib/messagesBroadcast.server";
import { messagesStore } from "@/lib/messagesStore";
import { notifyMessageRecipients } from "@/lib/messageNotifications.server";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { eitherMutes, isUnmutedMate, type MateViewer } from "@/lib/socialMutual.server";
import { SUMMON_MAX_MATES, summonText } from "@/lib/summonMates";
import { selectSummonPrice, type SummonPriceEvidence } from "@/lib/summonPrice";
import { lookupPricedVenue } from "@/lib/venueDetailArtifact.server";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

/** The verified Social account summoning. */
export type SummonViewer = MateViewer;

/** How long a send waits for the optional price before it goes without one. */
export const SUMMON_PRICE_READ_MS = 1_500;

/** The most mutuals one list read checks, so a large follow graph stays a bounded read. */
const SUMMON_MUTUALS_CHECKED = 60;

type SummonPub =
  | { status: "found"; venueId: string; name: string }
  | { status: "unknown" }
  | { status: "unavailable" };

export type SummonDependencies = {
  listMutuals(handle: string): Promise<string[]>;
  /** True when either side has muted the other. Throws when it cannot tell. */
  eitherMutes(viewer: SummonViewer, handle: string): Promise<boolean>;
  lookupPub(venueId: string): Promise<SummonPub>;
  /** The dated price for this canonical pub, or null. Never throws. */
  lookupPrice(venueId: string): Promise<SummonPriceEvidence | null>;
  /** One direct message with the pub attached. False when it did not land. */
  deliver(sender: string, mate: string, body: string, venueId: string): Promise<boolean>;
};

async function lookupPub(venueId: string): Promise<SummonPub> {
  const lookup = await lookupCanonicalVenue(venueId);
  if (lookup.status !== "found") return { status: lookup.status };
  if (!isPubVenueKind(lookup.slimVenue.kind ?? lookup.venue.kind)) return { status: "unknown" };
  return { status: "found", venueId: lookup.canonicalId, name: lookup.venue.name };
}

/** The optional price, or null once the bound passes. The timer never outlives the read. */
async function boundedPrice(read: Promise<SummonPriceEvidence | null>): Promise<SummonPriceEvidence | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SUMMON_PRICE_READ_MS);
  });
  try {
    return await Promise.race([read.catch(() => null), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function lookupPrice(venueId: string): Promise<SummonPriceEvidence | null> {
  try {
    const priced = await lookupPricedVenue(venueId);
    if (priced.status !== "found" || priced.venue.id !== venueId) return null;
    return selectSummonPrice(priced.venue, Date.now());
  } catch {
    return null;
  }
}

/** The invite with its price, unless the store would have to cut it to fit. */
function summonBody(pubName: string, time: string, price: SummonPriceEvidence | null): string {
  const priced = summonText(pubName, time, price);
  return price && cleanBody(priced) === priced ? priced : summonText(pubName, time);
}

async function deliver(sender: string, mate: string, body: string, venueId: string): Promise<boolean> {
  const store = messagesStore();
  const conversationId = await store.openConversation(sender, mate);
  if (!conversationId) return false;
  const sent = await store.send(conversationId, sender, body, { kind: "venue", venueId });
  if (!sent) return false;
  deferMessagesSignal(async () => {
    await Promise.allSettled([broadcastMessageSent(conversationId, [sender, mate]), notifyMessageRecipients(sent.message)]);
  });
  return true;
}

const defaultDependencies = (): SummonDependencies => ({
  listMutuals: (handle) => followStore().listMutuals(handle),
  eitherMutes,
  lookupPub,
  lookupPrice,
  deliver,
});

function summonable(viewer: SummonViewer, handle: string, deps: SummonDependencies): Promise<boolean> {
  return isUnmutedMate(viewer, handle, deps.eitherMutes);
}

/** The mates this viewer may summon, sorted by handle. */
export async function summonableMates(
  viewer: SummonViewer,
  dependencies: Partial<SummonDependencies> = {},
): Promise<string[]> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);
  const mutuals = [
    ...new Set((await deps.listMutuals(viewer.handle)).map(normalizeViewerHandle)),
  ]
    .filter((handle) => handle && handle !== self)
    .sort()
    .slice(0, SUMMON_MUTUALS_CHECKED);
  const allowed = await Promise.all(mutuals.map((handle) => summonable(viewer, handle, deps)));
  return mutuals.filter((_, index) => allowed[index]);
}

export type SummonSendResult =
  | { status: "sent"; sent: string[]; failed: string[] }
  | { status: "no_mates" }
  | { status: "unknown_pub" }
  | { status: "unavailable" };

/**
 * Send one summon to each handle that is still a summonable mate. A handle
 * the check refuses is dropped without a word, so the answer never says which
 * side blocked or muted. An unavailable eligibility read aborts before delivery.
 * `sent` names only the messages that landed.
 */
export async function sendSummon(
  viewer: SummonViewer,
  input: { venueId: string; time: string; mates: readonly string[] },
  dependencies: Partial<SummonDependencies> = {},
): Promise<SummonSendResult> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);
  const asked = [...new Set(input.mates.map(normalizeViewerHandle))]
    .filter((handle) => handle && handle !== self)
    .slice(0, SUMMON_MAX_MATES);
  if (asked.length === 0) return { status: "no_mates" };

  const pub = await deps.lookupPub(input.venueId);
  if (pub.status === "unknown") return { status: "unknown_pub" };
  if (pub.status === "unavailable") return { status: "unavailable" };

  const mutualsBefore = new Set((await deps.listMutuals(viewer.handle)).map(normalizeViewerHandle));
  if (!asked.some((handle) => mutualsBefore.has(handle))) return { status: "no_mates" };
  const price = await boundedPrice(Promise.resolve().then(() => deps.lookupPrice(pub.venueId)));
  // The read may have taken a while. Ask who is still a mate after it, not before.
  const mutuals = new Set((await deps.listMutuals(viewer.handle)).map(normalizeViewerHandle));
  const candidates = asked.filter((handle) => mutuals.has(handle));
  if (candidates.length === 0) return { status: "no_mates" };
  const allowed = await Promise.all(candidates.map((handle) => summonable(viewer, handle, deps)));
  const mates = candidates.filter((_, index) => allowed[index]);
  if (mates.length === 0) return { status: "no_mates" };

  const body = summonBody(pub.name, input.time, price);
  const sent: string[] = [];
  const failed: string[] = [];
  for (const mate of mates) {
    const landed = await deps.deliver(self, mate, body, pub.venueId).catch(() => false);
    (landed ? sent : failed).push(mate);
  }
  return { status: "sent", sent, failed };
}

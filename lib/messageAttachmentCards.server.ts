import "server-only";

// Resolving what a message POINTS AT, on the READ path.
//
// A message stores an id and nothing else — a venue id, a handle, a plan id —
// so this is the one place a card gets its name, its face and its figures.
// Resolving live rather than freezing the card at send time is the whole design
// (`lib/messageAttachments.ts` rule 5): a pub that was renamed reads correctly
// in a message from last month, a person who renamed themselves does too, and a
// plan that moved is never quoted back out of an old thread as though it were
// still tonight.
//
// THREE RULES, ONE PER KIND, AND EACH IS A PRIVACY RULE.
//
// 1. A PUB CARD SAYS WHAT THE PIN SAYS. The curated sourced lane alone, pub
//    kinds alone, no coordinate at any point.
//
// 2. A CONTACT CARD IS THE PUBLIC PROFILE AND NOTHING ELSE. The handle, the
//    display name somebody chose to publish, and the APPROVED OWNED avatar —
//    the face through `publicOwnedImageUrl`, the one door every other public
//    surface reads a face through, so a pending or refused avatar prints here
//    exactly as it prints on /u/<handle>: not at all.
//    Email, date of birth, full name and city sit behind the
//    owner-authenticated read, and passing a handle on in a message may not be
//    a way around it. A tombstoned or unknown handle resolves to null rather
//    than to the name it retired.
//
// 3. AN EVENT CARD IS THE PLAN'S ANONYMOUS PREVIEW. A message is NOT a
//    capability. The card carries exactly the fields `buildPlanPrivacyPreview`
//    carries — host, area, start, stop count, readiness — and never a venue, a
//    stop, the route or the crew. Whether the reader gets more than that is
//    their own capability's answer at /plan/<id>, decided by
//    `resolvePlanProjection` as it always was.
//
// A read that could not answer carries `card: null`, never a guess: an index we
// could not open may not read as a pub that does not exist, and a profile read
// that failed may not read as a person who left.

import {
  messageContactProfileUrl,
  messageEventPlanUrl,
  type MessageAttachment,
  type MessageContactCard,
  type MessageEventCard,
  isMessageVenueId,
  messageVenueMapUrl,
  type MessageVenueCard,
} from "@/lib/messageAttachments";
import type { MessageDTO } from "@/lib/messages";
import { buildPlanPrivacyPreview } from "@/lib/planPrivacy";
import { planStore } from "@/lib/planStore";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
} from "@/lib/profileStore";
import { normalizeHandle } from "@/lib/profiles";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

/**
 * One pub, resolved. Null when the index does not know it or could not answer.
 *
 * Resolving on the READ path rather than freezing the card at send time is the
 * whole design: a pub that was renamed reads correctly in a message from last
 * month, and a price that moved is never quoted back out of an old thread as
 * though it were tonight's.
 */
async function resolveMessageVenueCard(
  venueId: string,
): Promise<MessageVenueCard | null> {
  if (!isMessageVenueId(venueId)) return null;
  const lookup = await lookupCanonicalVenue(venueId);
  if (lookup.status !== "found") return null;
  const { venue, slimVenue, canonicalId } = lookup;
  // Pub kinds only, and only a real positive figure. Everything else prints its
  // name and its area and stops, which is the honest card for a pub nobody has
  // priced.
  const sayable =
    isPubVenueKind(slimVenue.kind ?? venue.kind) &&
    typeof slimVenue.cheapestPrice === "number" &&
    Number.isFinite(slimVenue.cheapestPrice) &&
    slimVenue.cheapestPrice > 0;
  return {
    venueId: canonicalId,
    name: venue.name,
    area: venue.borough ?? "",
    priceGbp: sayable ? slimVenue.cheapestPrice : null,
    mapUrl: messageVenueMapUrl(canonicalId),
  };
}

/**
 * One person, resolved. Null when nobody holds that handle, when the account
 * has been retired, or when the read could not be made.
 */
export async function resolveMessageContactCard(
  handle: string,
): Promise<MessageContactCard | null> {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;
  const profile = await profileStore().getByHandle(normalized);
  if (!profile || isProfileTombstoned(profile)) return null;
  const displayName =
    typeof profile.displayName === "string" && profile.displayName.trim()
      ? profile.displayName.trim()
      : null;
  return {
    handle: normalized,
    // The handle is already on the card, so repeating it as a display name adds
    // nothing and reads like a bug.
    displayName: displayName && displayName.toLowerCase() !== normalized ? displayName : null,
    // The MODERATED OWNED avatar, through the one door every public surface
    // reads a face through. `ProfileRecord.avatarUrl` is the LEGACY hotlinked
    // column and is internal: it crosses no other public wire, so reading it
    // here would print a pending or refused face in somebody's thread.
    avatarUrl: publicOwnedImageUrl(profile, "avatar") ?? null,
    profileUrl: messageContactProfileUrl(normalized),
  };
}

/**
 * One plan, resolved to its ANONYMOUS preview. Null when the plan is unknown or
 * the read could not be made.
 *
 * `buildPlanPrivacyPreview` is asked for the shape rather than the shape being
 * rebuilt here, so the card cannot drift past what an uninvited viewer is
 * already allowed to see anywhere else in the product.
 */
export async function resolveMessageEventCard(
  planId: string,
): Promise<MessageEventCard | null> {
  if (!planId) return null;
  const state = await planStore().get(planId);
  if (!state) return null;
  const preview = buildPlanPrivacyPreview(state);
  return {
    planId,
    hostDisplayName: preview.hostDisplayName,
    areaName: preview.areaName,
    startLabel: preview.startLabel,
    stopCount: preview.stopCount,
    routeReady: preview.routeReady,
    planUrl: messageEventPlanUrl(planId),
  };
}

type CardCaches = {
  venues: Map<string, MessageVenueCard | null>;
  contacts: Map<string, MessageContactCard | null>;
  events: Map<string, MessageEventCard | null>;
};

async function resolveOnce<T>(
  cache: Map<string, T | null>,
  key: string,
  resolve: () => Promise<T | null>,
): Promise<void> {
  if (cache.has(key)) return;
  try {
    cache.set(key, await resolve());
  } catch {
    // A lookup that threw is a read we could not make. `null` says so, and the
    // card says it in words rather than inventing the thing it pointed at.
    cache.set(key, null);
  }
}

/**
 * Fill in every resolved card in one thread.
 *
 * Distinct ids are resolved ONCE per kind, because a thread where two people
 * swapped the same pub six times is one lookup rather than six; the venue index
 * is memoised and the profile read is a point read, so the cost after the first
 * is a map get.
 */
export async function attachMessageAttachmentCards(
  messages: readonly MessageDTO[],
): Promise<MessageDTO[]> {
  const venueIds = new Set<string>();
  const contactHandles = new Set<string>();
  const planIds = new Set<string>();
  for (const message of messages) {
    const attachment = message.attachment;
    if (attachment?.kind === "venue") venueIds.add(attachment.venueId);
    else if (attachment?.kind === "contact") contactHandles.add(attachment.handle);
    else if (attachment?.kind === "event") planIds.add(attachment.planId);
  }
  if (venueIds.size === 0 && contactHandles.size === 0 && planIds.size === 0) {
    return [...messages];
  }

  const caches: CardCaches = { venues: new Map(), contacts: new Map(), events: new Map() };
  await Promise.all([
    ...[...venueIds].map((id) =>
      resolveOnce(caches.venues, id, () => resolveMessageVenueCard(id)),
    ),
    ...[...contactHandles].map((handle) =>
      resolveOnce(caches.contacts, handle, () => resolveMessageContactCard(handle)),
    ),
    ...[...planIds].map((id) =>
      resolveOnce(caches.events, id, () => resolveMessageEventCard(id)),
    ),
  ]);

  return messages.map((message) => {
    const attachment = message.attachment;
    if (!attachment) return message;
    let resolved: MessageAttachment | null = null;
    if (attachment.kind === "venue") {
      resolved = { ...attachment, card: caches.venues.get(attachment.venueId) ?? null };
    } else if (attachment.kind === "contact") {
      resolved = { ...attachment, card: caches.contacts.get(attachment.handle) ?? null };
    } else if (attachment.kind === "event") {
      resolved = { ...attachment, card: caches.events.get(attachment.planId) ?? null };
    }
    return resolved ? { ...message, attachment: resolved } : message;
  });
}

"use client";

// The face and the name on an account card, from the account's own public
// profile. ONE reader, because the nav card and the account switcher both name
// people and a second copy of this read is a second answer.
//
// It is the ordinary public profile GET, so it discloses nothing a visitor could
// not already read, and a failure is silence rather than a wrong name.

import { handleOnly } from "@/lib/handleDisplay";
import { loadSurfaceJson, readSurfaceSnapshot } from "@/lib/surfaceDataCache";

export type PublicProfileCard = { displayName?: string; avatarUrl?: string };

type PublicProfileBody = {
  profile?: { displayName?: string; avatarUrl?: string } | null;
};

function cardFromBody(body: PublicProfileBody): PublicProfileCard {
  return {
    ...(body.profile?.displayName ? { displayName: body.profile.displayName } : {}),
    ...(body.profile?.avatarUrl ? { avatarUrl: body.profile.avatarUrl } : {}),
  };
}

function cardKey(handle: string): string {
  return `/api/profiles/${encodeURIComponent(handleOnly(handle))}`;
}

/**
 * The card this tab read within `maxAgeMs`, or undefined when none is held. The
 * nav asks for it on every page, so a card read a moment ago is answered here
 * instead of by another request.
 */
export function heldPublicProfileCard(
  handle: string,
  maxAgeMs: number,
): PublicProfileCard | undefined {
  const held = readSurfaceSnapshot<PublicProfileBody>(cardKey(handle), maxAgeMs);
  return held && typeof held === "object" && "profile" in held ? cardFromBody(held) : undefined;
}

/** Window event: this handle's own face or name just changed. */
export const PROFILE_CARD_CHANGED_EVENT = "pubmax:profile-card-changed";

/** Tell every card reader the owner's face or name changed, so none shows the old one. */
export function announceProfileCardChanged(handle: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROFILE_CARD_CHANGED_EVENT, { detail: { handle } }));
}

/** The public card for a handle, or null when the read did not answer. */
export async function loadPublicProfileCard(
  handle: string,
  signal?: AbortSignal,
  options: { fresh?: boolean } = {},
): Promise<PublicProfileCard | null> {
  let card: PublicProfileCard | null = null;
  let answered = false;
  const outcome = await loadSurfaceJson<PublicProfileBody>(
    cardKey(handle),
    {
      signal,
      ...(options.fresh ? { fresh: true } : {}),
      validate: (body) => Boolean(body && typeof body === "object" && "profile" in body),
    },
    (body) => {
      answered = true;
      card = cardFromBody(body);
    },
  );
  return outcome === "failed" && !answered ? null : card;
}

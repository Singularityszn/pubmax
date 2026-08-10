"use client";

// The face and the name on an account card, from the account's own public
// profile. ONE reader, because the nav card and the account switcher both name
// people and a second copy of this read is a second answer.
//
// It is the ordinary public profile GET, so it discloses nothing a visitor could
// not already read, and a failure is silence rather than a wrong name.

import { handleOnly } from "@/lib/handleDisplay";
import { discardBody } from "@/lib/responseBody";

export type PublicProfileCard = { displayName?: string; avatarUrl?: string };

/** The public card for a handle, or null when the read did not answer. */
export async function loadPublicProfileCard(
  handle: string,
  signal?: AbortSignal,
): Promise<PublicProfileCard | null> {
  const response = await fetch(
    `/api/profiles/${encodeURIComponent(handleOnly(handle))}`,
    signal ? { signal } : {},
  ).catch(() => null);
  if (!response) return null;
  if (!response.ok) {
    discardBody(response);
    return null;
  }
  const body = (await response.json().catch(() => null)) as {
    profile?: { displayName?: string; avatarUrl?: string } | null;
  } | null;
  return {
    ...(body?.profile?.displayName ? { displayName: body.profile.displayName } : {}),
    ...(body?.profile?.avatarUrl ? { avatarUrl: body.profile.avatarUrl } : {}),
  };
}

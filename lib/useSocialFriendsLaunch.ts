"use client";

import { useSyncExternalStore } from "react";

import {
  readSocialFriendsLaunchFromDocument,
  socialNavShowsPreviewBadge,
  socialSurfaceName,
  subscribeSocialFriendsLaunchFromDocument,
} from "@/lib/socialLaunch";

/**
 * The ONE browser read of the friends-launch flag, so the nav bar, the phone
 * tab bar and the command palette cannot disagree about what Social is called.
 *
 * The server snapshot is `false` on purpose: the flag is only knowable from the
 * body dataset the root layout writes, and React uses this snapshot for the
 * hydration render as well, so a deployment with the flag on paints the launch
 * label on the first store read rather than through a text mismatch.
 */
function serverSnapshot(): boolean {
  return false;
}

export function useSocialFriendsLaunch(): boolean {
  return useSyncExternalStore(
    subscribeSocialFriendsLaunchFromDocument,
    readSocialFriendsLaunchFromDocument,
    serverSnapshot,
  );
}

/** Desktop nav and command palette surface name (Social preview when gated). */
export function useSocialSurfaceName(): string {
  return socialSurfaceName(useSocialFriendsLaunch());
}

/** Whether the mobile Social tab should wear the preview badge. */
export function useSocialNavShowsPreviewBadge(): boolean {
  return socialNavShowsPreviewBadge(useSocialFriendsLaunch());
}

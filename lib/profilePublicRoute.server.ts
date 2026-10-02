import "server-only";

import { isPubmaxxHandleImpersonationBlock } from "@/lib/pubmaxxIdentity";
import { normalizeHandle } from "@/lib/profiles";

const YOU_SENTINEL = "you";

/**
 * /u/[handle] answers 404 for identity blocks only. A moderation-withdrawn
 * handle renders the same shell as a handle nobody owns, so the page cannot
 * tell a reader that the account existed.
 */
export function publicProfileRouteWithholdsNotFound(rawHandle: string): boolean {
  const handle = normalizeHandle(rawHandle);
  if (!handle || handle === YOU_SENTINEL) return false;
  return isPubmaxxHandleImpersonationBlock(handle);
}

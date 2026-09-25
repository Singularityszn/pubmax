import "server-only";

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { assessPubmaxxHandle } from "@/lib/pubmaxxIdentity";
import { normalizeHandle } from "@/lib/profiles";

const YOU_SENTINEL = "you";

/** /u/[handle] answers 404 for identity blocks and moderation-withdrawn handles. */
export async function publicProfileRouteWithholdsNotFound(rawHandle: string): Promise<boolean> {
  const handle = normalizeHandle(rawHandle);
  if (!handle || handle === YOU_SENTINEL) return false;

  const assessment = assessPubmaxxHandle(handle);
  if (!assessment.ok && assessment.reason === "reserved") return true;

  const withdrawn = await withdrawnHandles([handle]);
  return withdrawn.has(handle);
}

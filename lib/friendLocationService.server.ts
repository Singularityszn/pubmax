import "server-only";

import { coarsenViewerPoint, coarsenedViewerAccuracy } from "@/lib/geo";
import type { FriendLocationRead, FriendLocationWrite } from "@/lib/friendLocation";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type FriendLocationOperation = "read" | "start" | "reconcile" | "update" | "revoke";
export class FriendLocationError extends Error {
  constructor(readonly code: "conflict" | "recipient_refused" | "invalid" | "actor_refused" | "unavailable") {
    super(code);
  }
}
export async function friendLocationOperation(
  actor: SocialPostActor,
  operation: FriendLocationOperation,
  input: Record<string, unknown> = {},
): Promise<FriendLocationRead | FriendLocationWrite> {
  const body = { ...input };
  if (operation === "start" || operation === "update") {
    const point = coarsenViewerPoint({ lat: Number(body.latitude), lng: Number(body.longitude) });
    body.accuracy = coarsenedViewerAccuracy({ lat: Number(body.latitude), lng: Number(body.longitude) }, point, Number(body.accuracy));
    body.latitude = point.lat;
    body.longitude = point.lng;
  }
  try {
    const { data, error } = await requireSupabaseAdmin().rpc("friend_location_operation", {
      p_actor_account_id: actor.accountId, p_operation: operation, p_input: body,
    });
    if (error || !data || typeof data !== "object") throw new FriendLocationError("unavailable");
    if (data.ok !== true) {
      const code = ["conflict", "recipient_refused", "invalid", "actor_refused"].includes(data.code)
        ? data.code : "unavailable";
      throw new FriendLocationError(code);
    }
    if (!Number.isSafeInteger(data.generation) || data.generation < 0) throw new FriendLocationError("unavailable");
    return data as FriendLocationRead | FriendLocationWrite;
  } catch (error) {
    if (error instanceof FriendLocationError) throw error;
    throw new FriendLocationError("unavailable");
  }
}

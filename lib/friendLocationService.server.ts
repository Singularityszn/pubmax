import "server-only";

import { coarsenViewerPoint, coarsenedViewerAccuracy } from "@/lib/geo";
import type { FriendLocationRead, FriendLocationWrite } from "@/lib/friendLocation";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import type { Json } from "@/types/database";

export type FriendLocationOperation = "read" | "start" | "reconcile" | "update" | "revoke";
export class FriendLocationError extends Error {
  constructor(readonly code: "conflict" | "recipient_refused" | "invalid" | "actor_refused" | "unavailable") {
    super(code);
  }
}
function isJsonValue(value: unknown, ancestors = new Set<object>()): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}
export async function friendLocationOperation(
  actor: SocialPostActor,
  operation: FriendLocationOperation,
  input: Record<string, unknown> = {},
): Promise<FriendLocationRead | FriendLocationWrite> {
  try {
    const body = { ...input };
    if (operation === "start" || operation === "update") {
      const point = coarsenViewerPoint({ lat: Number(body.latitude), lng: Number(body.longitude) });
      body.accuracy = coarsenedViewerAccuracy({ lat: Number(body.latitude), lng: Number(body.longitude) }, point, Number(body.accuracy));
      body.latitude = point.lat;
      body.longitude = point.lng;
    }
    if (!isJsonValue(body)) throw new FriendLocationError("invalid");
    const { data, error } = await requireSupabaseAdmin().rpc("friend_location_operation", {
      p_actor_account_id: actor.accountId, p_operation: operation, p_input: body,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new FriendLocationError("unavailable");
    if (data.ok !== true) {
      const code = data.code;
      throw new FriendLocationError(code === "conflict" || code === "recipient_refused" || code === "invalid" || code === "actor_refused"
        ? code : "unavailable");
    }
    if (typeof data.generation !== "number" || !Number.isSafeInteger(data.generation) || data.generation < 0) throw new FriendLocationError("unavailable");
    return data as FriendLocationRead | FriendLocationWrite;
  } catch (error) {
    if (error instanceof FriendLocationError) throw error;
    throw new FriendLocationError("unavailable");
  }
}

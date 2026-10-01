import { publicApiErrorFromStatus } from "@/lib/apiError";
import { requireLinkedActor } from "@/lib/messageAuth";
import { gateHandleAction } from "@/lib/profileOwnership";
import { publicProfileSearchResponse } from "@/lib/publicProfileSearch.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

/** DMs remain available during Social rollback; the directory stays private to signed-in actors. */
export async function GET(request: Request): Promise<Response> {
  const actor = await requireLinkedActor(request, "");
  if (!actor.ok) return publicApiErrorFromStatus(actor.error, actor.status);
  const ownership = await gateHandleAction(request, actor.handle, actor.userId);
  if (!ownership.allowed) return publicApiErrorFromStatus(ownership.error, ownership.status);
  return publicProfileSearchResponse(request);
}

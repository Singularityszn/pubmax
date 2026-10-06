import { authUnavailableError, publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { createNightMemory, listNightMemories } from "@/lib/nightMemoryStore";

export async function GET(request: Request): Promise<Response> {
  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") {
    return authUnavailableError();
  }
  const ownerId = verification.status === "verified" ? verification.identity.id : null;
  return ownerId
    ? jsonNoStore({ memories: await listNightMemories(ownerId) })
    : publicApiError("Sign in to view Night Memories.", "UNAUTHENTICATED", 401);
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `night-memory-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") {
    return authUnavailableError();
  }
  const ownerId = verification.status === "verified" ? verification.identity.id : null;
  if (!ownerId) return publicApiError("Sign in to create a Night Memory.", "UNAUTHENTICATED", 401);
  let body: unknown;
  try { body = await request.json(); } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const memory = await createNightMemory(ownerId, body);
  return memory
    ? jsonNoStore({ memory }, { status: 201 })
    : publicApiError("Add a title to create this Night Memory.", "INVALID_REQUEST", 400);
}

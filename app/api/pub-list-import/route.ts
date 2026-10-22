import { randomUUID } from "node:crypto";

import { z } from "zod";

import { authUnavailableError, publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { importPubList } from "@/lib/pubListImport.server";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

const inputSchema = z.object({
  text: z.string().max(4000).refine((text) => text.trim().length > 0),
  sourceUrl: z.string().max(2048).optional(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const ipKey = `pub-list-import:ip:${hashIp(clientIp(request))}`;
  if (await isLimited(ipKey, ipKey, 30, 60_000, { failClosed: true })) {
    return publicApiError("Too many imports. Try again in a minute.", "RATE_LIMITED", 429, { retryable: true });
  }

  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") return authUnavailableError();
  if (verification.status !== "verified") {
    return publicApiError("Sign in to import a pub list.", "UNAUTHENTICATED", 401);
  }
  const userKey = `pub-list-import:user:${hashActor(verification.identity.id)}`;
  if (await isLimited(userKey, userKey, 10, 60_000, { failClosed: true })) {
    return publicApiError("Too many imports. Try again in a minute.", "RATE_LIMITED", 429, { retryable: true });
  }

  let body: unknown;
  try {
    body = await boundedJson(request, 48_000);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return publicApiError("The pasted list is too large.", "PAYLOAD_TOO_LARGE", 413);
    }
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const input = inputSchema.safeParse(body);
  if (!input.success) {
    return publicApiError("Paste up to 4,000 characters and an optional source link.", "INVALID_REQUEST", 400);
  }

  try {
    const result = await importPubList(input.data);
    return jsonNoStore({ importId: randomUUID(), ...result });
  } catch (error) {
    if (error instanceof RangeError) return publicApiError(error.message, "INVALID_REQUEST", 400);
    return publicApiError("The import is unavailable. Try again.", "IMPORT_UNAVAILABLE", 503, { retryable: true });
  }
}

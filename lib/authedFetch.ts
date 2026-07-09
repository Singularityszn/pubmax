// Browser fetch helper that attaches the Supabase access token when signed in.
// Wave I2: ownership-sensitive social reads/writes (messages, notifications)
// must send `Authorization: Bearer` so gateHandleAction / resolveMessageHandle
// can verify the caller. Anonymous requests remain valid for unlinked demo
// handles — matching ProfileEditor's pattern.

import { getAccessToken } from "@/lib/authClient";

/**
 * Like `fetch`, but merges `Authorization: Bearer <jwt>` when a session exists.
 * Never throws on token lookup failure — falls through to an anonymous request.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  try {
    const token = await getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  } catch {
    // Signed-out / storage blocked — proceed anonymously.
  }
  return fetch(input, { ...init, headers });
}

"use client";

import { authedActionFetch } from "@/lib/authedFetch";
import { LEAGUES_COPY } from "@/lib/leagues";
import { discardBody } from "@/lib/responseBody";

/** What a league request came back as, in the words the pages act on. */
export type LeagueReply =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "signed-out" }
  /** Signed in but not let in: no handle, the adult check, a suspension. */
  | { kind: "closed"; message: string }
  /** Migration 0239 is not applied yet. */
  | { kind: "not-open" }
  | { kind: "refused"; status: number; code: string; message: string }
  | { kind: "error" };

/** One /api/leagues request as the signed-in reader. Never throws, except an abort. */
export async function leagueRequest(path: string, init: RequestInit = {}): Promise<LeagueReply> {
  let response: Response;
  try {
    response = await authedActionFetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    }, { requiresIdentity: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { kind: "error" };
  }
  if (response.status === 401) {
    discardBody(response);
    return { kind: "signed-out" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return { kind: "ok", status: response.status, body };
  const envelope = body && typeof body === "object" ? (body as { code?: unknown; error?: unknown }) : {};
  const code = typeof envelope.code === "string" ? envelope.code : "";
  const message = typeof envelope.error === "string" ? envelope.error : LEAGUES_COPY.error;
  if (response.status === 403) return { kind: "closed", message };
  if (code === "LEAGUES_NOT_OPEN") return { kind: "not-open" };
  if (response.status >= 500) return { kind: "error" };
  return { kind: "refused", status: response.status, code, message };
}

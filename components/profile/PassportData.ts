"use client";

// One fetch per passport read per account, shared by the cover and the
// sections, so the head and the Been list cannot show two different counts.
// Keyed to the signed-in account: a sign-out or a switch reads again rather
// than painting the last account's private list.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { beenHereRevision, subscribeBeenHere } from "@/lib/beenHere";
import type { BeenCompare, BeenVenue, ComparedVenue, PassportVenue, TasteFact } from "@/lib/profilePassport";

export type PassportBeenRead = {
  access: "full" | "shared";
  status: "ready" | "degraded";
  count: number;
  venues: BeenVenue[];
  wantToTryCount: number | null;
  cover: { patch: string | null } | null;
};
export type PassportOverlapRead = {
  topFive: PassportVenue[];
  wantToTry: PassportVenue[];
  /** Absent from an older server, null when either Been list was short. */
  been?: BeenCompare<ComparedVenue> | null;
};
export type PassportTasteRead = { facts: TasteFact[] };

type Kind = "been" | "overlap" | "taste" | "points";

type PassportResult<T> =
  | { status: "ready"; body: T }
  | { status: "unavailable" | "refused"; body: null };

const inflight = new Map<string, Promise<PassportResult<unknown>>>();

function wellFormed(kind: Kind, body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  if (kind === "been") return Array.isArray(record.venues) && typeof record.count === "number";
  if (kind === "overlap") {
    const been = record.been as Record<string, unknown> | null | undefined;
    const beenOk =
      been == null ||
      (Array.isArray(been.both) && Array.isArray(been.onlyYou) && Array.isArray(been.onlyThem));
    return Array.isArray(record.topFive) && Array.isArray(record.wantToTry) && beenOk;
  }
  if (kind === "points") return typeof record.total === "number" && Array.isArray(record.lines);
  return Array.isArray(record.facts);
}

function readOnce<T>(kind: Kind, handle: string, account: string, revision: string): Promise<PassportResult<T>> {
  const key = `${kind}:${handle}:${account}:${revision}`;
  const held = inflight.get(key);
  if (held) return held as Promise<PassportResult<T>>;
  const read = authedFetch(
    `/api/profiles/${encodeURIComponent(handle)}/${kind}`,
    {},
    { requiresIdentity: true },
  )
    .then(async (response): Promise<PassportResult<T>> => {
      if (!response.ok) {
        discardBody(response);
        return { status: [401, 403, 404].includes(response.status) ? "refused" : "unavailable", body: null };
      }
      const body = (await response.json()) as unknown;
      if (!wellFormed(kind, body) || (body as { status?: string }).status === "degraded" ||
          (body as { status?: string }).status === "unavailable") {
        return { status: "unavailable", body: null };
      }
      return { status: "ready", body: body as T };
    })
    .catch((): PassportResult<T> => ({ status: "unavailable", body: null }))
    .finally(() => {
      setTimeout(() => inflight.delete(key), 0);
    });
  inflight.set(key, read);
  return read;
}

export function usePassportRead<T>(kind: Kind, handle: string, enabled = true) {
  const { user } = useAuth();
  const account = user?.id ?? "anon";
  const beenHereMoves = useSyncExternalStore(subscribeBeenHere, beenHereRevision, () => 0);
  const asksAgain = kind === "been" || kind === "points" ? beenHereMoves : 0;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const key = `${kind}:${handle}:${account}`;
  const [state, setState] = useState<{ key: string; result: PassportResult<T> } | null>(null);

  useEffect(() => {
    if (!enabled || !handle || handle === "you") return;
    let live = true;
    void readOnce<T>(kind, handle, account, `${asksAgain}:${attempt}`).then((result) => {
      if (live) setState({ key, result });
    });
    return () => { live = false; };
  }, [kind, handle, account, key, enabled, asksAgain, attempt]);

  const result = enabled && handle && handle !== "you" && state?.key === key
    ? state.result
    : { status: "loading" as const, body: null };
  return { ...result, retry };
}

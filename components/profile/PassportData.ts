"use client";

// One fetch per passport read per account, shared by the cover and the
// sections, so the head and the Been list cannot show two different counts.
// Keyed to the signed-in account: a sign-out or a switch reads again rather
// than painting the last account's private list.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedFetch } from "@/lib/authedFetch";
import type { BeenVenue, PassportVenue, TasteFact } from "@/lib/profilePassport";

export type PassportBeenRead = {
  access: "full" | "shared";
  status: "ready" | "degraded";
  count: number;
  venues: BeenVenue[];
  wantToTryCount: number | null;
  cover: { fairPintPence: number | null; patch: string | null } | null;
};
export type PassportOverlapRead = { topFive: PassportVenue[]; wantToTry: PassportVenue[] };
export type PassportTasteRead = { facts: TasteFact[] };

type Kind = "been" | "overlap" | "taste";

const inflight = new Map<string, Promise<unknown | null>>();

/** A body that is not the read's own shape paints nothing rather than throwing. */
function wellFormed(kind: Kind, body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  if (kind === "been") return Array.isArray(record.venues) && typeof record.count === "number";
  if (kind === "overlap") return Array.isArray(record.topFive) && Array.isArray(record.wantToTry);
  return Array.isArray(record.facts);
}

function readOnce<T>(kind: Kind, handle: string, account: string): Promise<T | null> {
  const key = `${kind}:${handle}:${account}`;
  const held = inflight.get(key);
  if (held) return held as Promise<T | null>;
  const read = authedFetch(
    `/api/profiles/${encodeURIComponent(handle)}/${kind}`,
    {},
    { requiresIdentity: true },
  )
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as unknown;
      return wellFormed(kind, body) ? (body as T) : null;
    })
    .catch(() => null)
    .finally(() => {
      // Keep the answer only for this paint; a later mount reads afresh.
      setTimeout(() => inflight.delete(key), 0);
    });
  inflight.set(key, read);
  return read;
}

/** The read's body, null while loading, refused or failed. */
export function usePassportRead<T>(kind: Kind, handle: string, enabled = true): T | null {
  const { user } = useAuth();
  const account = user?.id ?? "anon";
  const key = `${kind}:${handle}:${account}`;
  const [state, setState] = useState<{ key: string; body: T | null } | null>(null);

  useEffect(() => {
    if (!enabled || !handle || handle === "you") return;
    let live = true;
    void readOnce<T>(kind, handle, account).then((body) => {
      if (live) setState({ key, body });
    });
    return () => {
      live = false;
    };
  }, [kind, handle, account, key, enabled]);

  return state?.key === key ? state.body : null;
}

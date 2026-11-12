"use client";

// The signed-in viewer's mates of mates, read once per account. A failed or
// refused read is an empty list: the panel then shows nothing rather than a
// guess.

import { useEffect, useState } from "react";

import { authedFetch } from "@/lib/authedFetch";
import { isFollowRelation, type FollowRelation } from "@/lib/followRelation";
import { normalizeHandle } from "@/lib/profiles";

export type MayKnowRow = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  via: string[];
  relation: FollowRelation;
};

function parse(body: unknown): MayKnowRow[] {
  const people = (body as { people?: unknown } | null)?.people;
  if (!Array.isArray(people)) return [];
  return people.flatMap((raw): MayKnowRow[] => {
    const row = raw as Record<string, unknown>;
    const handle = normalizeHandle(typeof row.handle === "string" ? row.handle : "");
    if (!handle || !Array.isArray(row.via)) return [];
    return [
      {
        handle,
        ...(typeof row.displayName === "string" ? { displayName: row.displayName } : {}),
        ...(typeof row.avatarUrl === "string" ? { avatarUrl: row.avatarUrl } : {}),
        via: row.via.filter((entry): entry is string => typeof entry === "string"),
        relation: isFollowRelation(row.relation) ? row.relation : "none",
      },
    ];
  });
}

/** `key` names the account; a new key reads afresh and never shows the last one's list. */
export function usePeopleYouMayKnow(key: string, enabled: boolean): MayKnowRow[] {
  const [read, setRead] = useState<{ key: string; rows: MayKnowRow[] } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void authedFetch("/api/profiles/may-know", { cache: "no-store", signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => (response.ok ? parse(await response.json()) : []))
      .catch(() => [] as MayKnowRow[])
      .then((rows) => {
        if (!controller.signal.aborted) setRead({ key, rows });
      });
    return () => controller.abort();
  }, [enabled, key]);

  return enabled && read?.key === key ? read.rows : [];
}

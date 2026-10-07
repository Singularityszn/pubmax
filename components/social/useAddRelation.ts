"use client";

// Where the viewer and the friend on an add link already stand, so a mate is
// never invited to add somebody they have already added.
//
// Both follow edges are public (`/following`, `/lot`), and `?viewer=` on the
// public profile read only decides what a control says. A read that fails
// leaves the relation unknown and the add on offer: the write is idempotent,
// so a wrong offer costs nothing.

import { useEffect, useState } from "react";

import { resolveFollowRelation, type FollowRelation } from "@/lib/followRelation";
import { normalizeHandle } from "@/lib/profiles";
import { discardBody } from "@/lib/responseBody";

async function readRelation(
  target: string,
  viewer: string,
  signal: AbortSignal,
): Promise<FollowRelation | null> {
  try {
    const res = await fetch(
      `/api/profiles/${encodeURIComponent(target)}?viewer=${encodeURIComponent(viewer)}`,
      { cache: "no-store", signal },
    );
    if (!res.ok) {
      discardBody(res);
      return null;
    }
    const body = (await res.json()) as {
      viewerFollowing?: unknown;
      followsViewer?: unknown;
    };
    return resolveFollowRelation({
      viewerFollowing: body.viewerFollowing === true,
      followsViewer: body.followsViewer === true,
    });
  } catch {
    return null;
  }
}

type RelationRead = { key: string; relation: FollowRelation | null };

/**
 * `loading` is true from the moment an account and a friend are both known
 * until the read answers, so the add control can wait for it. The answer is
 * held against its own key, so a switch of account or friend never shows the
 * previous pair's relation.
 */
export function useAddRelation(input: {
  accountId: string | null;
  viewerHandle: string | null;
  target: string;
  enabled: boolean;
}): { relation: FollowRelation | null; loading: boolean } {
  const { accountId, viewerHandle, target, enabled } = input;
  const [answer, setAnswer] = useState<RelationRead | null>(null);
  const viewer = viewerHandle ? normalizeHandle(viewerHandle) : "";
  const key = enabled && accountId && viewer && target ? `${accountId}:${viewer}:${target}` : null;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    void readRelation(target, viewer, controller.signal).then((relation) => {
      if (!controller.signal.aborted) setAnswer({ key, relation });
    });
    return () => controller.abort();
  }, [key, target, viewer]);

  const read = answer?.key === key ? answer : null;
  return { relation: read?.relation ?? null, loading: Boolean(key) && !read };
}

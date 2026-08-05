"use client";

// Wave I1 — Memory Timeline on /u/[handle]. Reuses FeedCard + normalizePintDrop
// so a profile's drops read as the same Spill timeline as /feed, not a separate
// photo grid. Reaction toggles mirror the feed page (batch summarize + optimistic).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FeedCard from "@/components/feed/FeedCard";
import { getAnonId } from "@/lib/anonId";
import type { Provenance } from "@/lib/curation";
import {
  normalizePintDrop,
  type FeedItem,
  type PintDropDTO,
} from "@/lib/feed";
import {
  REACTION_KEYS,
  type ReactionKey,
  type ReactionSummary,
} from "@/lib/reactions";

const EMPTY_SUMMARY: ReactionSummary = { counts: {}, mine: [] };

type SummaryMap = Record<string, ReactionSummary>;

const REACTION_SUMMARY_BATCH_SIZE = 100;

type ProfileReactionSummaryLoad = {
  summaries: SummaryMap;
  localOnlyIds: Set<string>;
  aborted: boolean;
};

const LOCAL_PREFIX = "pubmax:profile:reactions:";

function readLocalMine(id: string): ReactionKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFIX + id);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is ReactionKey =>
      (REACTION_KEYS as readonly string[]).includes(String(v)),
    );
  } catch {
    return [];
  }
}

function writeLocalMine(id: string, mine: ReactionKey[]): void {
  try {
    window.localStorage.setItem(LOCAL_PREFIX + id, JSON.stringify(mine));
  } catch {
    // Storage full / disabled — reaction still flips in memory this session.
  }
}

function localSummary(mine: ReactionKey[]): ReactionSummary {
  const counts: Partial<Record<ReactionKey, number>> = {};
  for (const key of mine) counts[key] = 1;
  return { counts, mine };
}

function toggleMine(mine: ReactionKey[], reaction: ReactionKey): ReactionKey[] {
  return mine.includes(reaction) ? mine.filter((k) => k !== reaction) : [...mine, reaction];
}

export async function loadProfileReactionSummaries(
  ids: readonly string[],
  actorId: string,
  signal?: AbortSignal,
): Promise<ProfileReactionSummaryLoad> {
  const uniqueIds = Array.from(new Set(ids));
  const batches: string[][] = [];
  for (let start = 0; start < uniqueIds.length; start += REACTION_SUMMARY_BATCH_SIZE) {
    batches.push(uniqueIds.slice(start, start + REACTION_SUMMARY_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      if (signal?.aborted) return { batch, aborted: true } as const;
      const query = `ids=${encodeURIComponent(batch.join(","))}&actor=${encodeURIComponent(actorId)}`;
      try {
        const response = await fetch(`/api/pint-drops/reactions?${query}`, { signal });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { summaries?: SummaryMap };
        if (signal?.aborted) return { batch, aborted: true } as const;
        return { batch, summaries: data.summaries ?? {} } as const;
      } catch {
        if (signal?.aborted) return { batch, aborted: true } as const;
        return { batch, failed: true } as const;
      }
    }),
  );

  if (signal?.aborted || results.some((result) => "aborted" in result)) {
    return { summaries: {}, localOnlyIds: new Set(), aborted: true };
  }

  const summaries: SummaryMap = {};
  const localOnlyIds = new Set<string>();
  for (const result of results) {
    if ("failed" in result) {
      for (const id of result.batch) {
        localOnlyIds.add(id);
        summaries[id] = localSummary(readLocalMine(id));
      }
      continue;
    }
    Object.assign(summaries, result.summaries);
  }

  return { summaries, localOnlyIds, aborted: false };
}

const PROVENANCE_OK = new Set<Provenance>(["demo", "contributor", "sourced", "anecdote"]);

function toPintDropDTO(drop: Record<string, unknown>): PintDropDTO | null {
  const id = typeof drop.id === "string" ? drop.id : "";
  const handle = typeof drop.handle === "string" ? drop.handle : "";
  const venueId = typeof drop.venueId === "string" ? drop.venueId : "";
  if (!id || !handle || !venueId) return null;

  const provenanceRaw = typeof drop.provenance === "string" ? drop.provenance : "contributor";
  const provenance: Provenance = PROVENANCE_OK.has(provenanceRaw as Provenance)
    ? (provenanceRaw as Provenance)
    : "contributor";

  const price =
    typeof drop.priceGbp === "number" && Number.isFinite(drop.priceGbp) ? drop.priceGbp : null;

  return {
    id,
    handle,
    priceGbp: price,
    drink: typeof drop.drink === "string" ? drop.drink : "",
    passedDownNote: typeof drop.passedDownNote === "string" ? drop.passedDownNote : "",
    era: typeof drop.era === "string" ? drop.era : "",
    provenance,
    venueId,
    createdAt:
      typeof drop.createdAt === "string" && drop.createdAt
        ? drop.createdAt
        : new Date(0).toISOString(),
    vibeTags: Array.isArray(drop.vibeTags)
      ? drop.vibeTags.filter((t): t is string => typeof t === "string")
      : [],
    pintPhotoUrl: typeof drop.pintPhotoUrl === "string" ? drop.pintPhotoUrl : null,
    venuePhotoUrl: typeof drop.venuePhotoUrl === "string" ? drop.venuePhotoUrl : null,
    venueName: typeof drop.venueName === "string" ? drop.venueName : undefined,
    venueMapUrl: typeof drop.venueMapUrl === "string" ? drop.venueMapUrl : undefined,
  };
}

export default function ProfileTimeline({
  drops,
}: {
  drops: Array<Record<string, unknown>>;
}): React.JSX.Element {
  const items = useMemo(() => {
    const out: FeedItem[] = [];
    for (const raw of drops) {
      const dto = toPintDropDTO(raw);
      if (!dto) continue;
      out.push(normalizePintDrop(dto));
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [drops]);

  const [summaries, setSummaries] = useState<SummaryMap>({});
  const localOnly = useRef<Set<string>>(new Set());
  const summarizedIds = useRef<Set<string>>(new Set());
  const [actorId] = useState<string>(() => getAnonId());

  const visibleIds = useMemo(() => items.map((i) => i.id), [items]);

  useEffect(() => {
    const loadedIds = summarizedIds.current;
    const fresh = visibleIds.filter((id) => !loadedIds.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) loadedIds.add(id);

    const controller = new AbortController();
    let settled = false;
    loadProfileReactionSummaries(fresh, actorId, controller.signal)
      .then((result) => {
        if (result.aborted) return;
        settled = true;
        for (const id of result.localOnlyIds) localOnly.current.add(id);
        setSummaries((prev) => {
          return { ...prev, ...result.summaries };
        });
      })
      .catch(() => {
        for (const id of fresh) loadedIds.delete(id);
      });

    return () => {
      controller.abort();
      if (!settled) {
        for (const id of fresh) loadedIds.delete(id);
      }
    };
  }, [visibleIds, actorId]);

  const toggleReaction = useCallback(async (dropId: string, reaction: ReactionKey) => {
    if (localOnly.current.has(dropId)) {
      setSummaries((prev) => {
        const current = prev[dropId] ?? EMPTY_SUMMARY;
        const mine = toggleMine(current.mine, reaction);
        writeLocalMine(dropId, mine);
        return { ...prev, [dropId]: localSummary(mine) };
      });
      return;
    }

    setSummaries((prev) => {
      const current = prev[dropId] ?? EMPTY_SUMMARY;
      const on = current.mine.includes(reaction);
      const mine = toggleMine(current.mine, reaction);
      const counts = { ...current.counts };
      counts[reaction] = Math.max(0, (counts[reaction] ?? 0) + (on ? -1 : 1));
      if (counts[reaction] === 0) delete counts[reaction];
      return { ...prev, [dropId]: { counts, mine } };
    });

    try {
      const res = await fetch("/api/pint-drops/reactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: dropId, reaction, actor: actorId }),
      });
      if (res.status === 404) {
        localOnly.current.add(dropId);
        setSummaries((prev) => {
          const current = prev[dropId] ?? EMPTY_SUMMARY;
          writeLocalMine(dropId, current.mine);
          return { ...prev, [dropId]: localSummary(current.mine) };
        });
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { summary?: ReactionSummary };
      if (data.summary) {
        setSummaries((prev) => ({ ...prev, [dropId]: data.summary! }));
      }
    } catch {
      // Keep optimistic flip; next load reconciles.
    }
  }, [actorId]);

  return (
    <div className="profileTimeline feedList" role="feed" aria-label="Memory timeline">
      {items.map((item) => (
        <FeedCard
          key={item.id}
          item={item}
          summary={summaries[item.id] ?? EMPTY_SUMMARY}
          onToggleReaction={toggleReaction}
        />
      ))}
    </div>
  );
}

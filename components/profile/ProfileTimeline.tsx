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
    const fresh = visibleIds.filter((id) => !summarizedIds.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) summarizedIds.current.add(id);

    const controller = new AbortController();
    const query = `ids=${encodeURIComponent(fresh.join(","))}&actor=${encodeURIComponent(actorId)}`;
    fetch(`/api/pint-drops/reactions?${query}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { summaries?: SummaryMap }) => {
        if (controller.signal.aborted) return;
        const server = data.summaries ?? {};
        setSummaries((prev) => {
          const next = { ...prev };
          for (const id of fresh) {
            if (server[id]) next[id] = server[id];
            else {
              localOnly.current.add(id);
              next[id] = localSummary(readLocalMine(id));
            }
          }
          return next;
        });
      })
      .catch(() => {
        // Cleanup aborts must not permanently mark ids local-only / summarized.
        if (controller.signal.aborted) {
          for (const id of fresh) summarizedIds.current.delete(id);
          return;
        }
        setSummaries((prev) => {
          const next = { ...prev };
          for (const id of fresh) {
            localOnly.current.add(id);
            next[id] = localSummary(readLocalMine(id));
          }
          return next;
        });
      });

    return () => controller.abort();
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
        body: JSON.stringify({ dropId, reaction, actor: actorId }),
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

"use client";

// Wave I1 — Memory Timeline on /u/[handle]. Reuses FeedCard + normalizePintDrop
// so a profile's drops read as the same Spill timeline as /feed, not a separate
// photo grid. Reaction toggles mirror the feed page (batch summarize + optimistic).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Route } from "next";

import FeedCard from "@/components/feed/FeedCard";
import SampleSkeleton from "@/components/ui/sample-skeleton";
import { SAMPLE_PIXEL } from "@/components/ui/sample-skeleton-context";
import { getAnonId } from "@/lib/anonId";
import type { Provenance } from "@/lib/curation";
import {
  normalizePintDrop,
  type FeedItem,
  type PintDropDTO,
} from "@/lib/feed";
import { type ReactionKey, type ReactionSummary } from "@/lib/reactions";
import {
  loadReactionSummaries,
  localReactionSummary,
  toggleReactionMine,
  writeLocalReactions,
  type ReactionSummaryMap,
} from "@/lib/reactionClient";
import { postReactionToggle } from "@/lib/optimisticToggle";

const EMPTY_SUMMARY: ReactionSummary = { counts: {}, mine: [] };

/**
 * Two photo drops, the timeline's usual card, for the wait while this handle's
 * drops are read. SampleSkeleton paints them out, so the values only have to
 * lay the card out: no price, no real pub or person, and a date far enough
 * back that it prints the same on the server and in the browser.
 */
const SAMPLE_DROPS: readonly FeedItem[] = ["sample-drop-1", "sample-drop-2"].map((id) => ({
  type: "pint_drop",
  id,
  createdAt: "1970-01-15T12:00:00.000Z",
  handle: "handle",
  avatarUrl: SAMPLE_PIXEL,
  venueId: "sample",
  venueName: "Pub name",
  venueMapUrl: "/map" as Route,
  photoUrls: [SAMPLE_PIXEL],
  caption: "",
  priceGbp: null,
  vibeTags: [],
  provenance: "contributor",
  drink: "",
  era: "",
}));

function ignoreSampleReaction(): void {}

/** The timeline's wait: the real cards, sampled. */
function ProfileTimelineSample(): React.JSX.Element {
  return (
    <SampleSkeleton label="Loading the timeline" className="profileTimelineSkel feedList">
      {SAMPLE_DROPS.map((item) => (
        <FeedCard
          key={item.id}
          item={item}
          summary={EMPTY_SUMMARY}
          onToggleReaction={ignoreSampleReaction}
        />
      ))}
    </SampleSkeleton>
  );
}

type SummaryMap = ReactionSummaryMap;

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
  loading = false,
}: {
  drops: Array<Record<string, unknown>>;
  /**
   * The drops are still being read: draw the sampled cards. The page keeps
   * this one component in place from the wait to the answer, so the lazy
   * chunk is never asked for twice and no frame falls between the two.
   */
  loading?: boolean;
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
    loadReactionSummaries(fresh, actorId, controller.signal)
      .then((result) => {
        if (result.aborted || controller.signal.aborted) return;
        settled = true;
        for (const id of result.retryableIds) loadedIds.delete(id);
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
        const mine = toggleReactionMine(current.mine, reaction);
        writeLocalReactions(dropId, mine);
        return { ...prev, [dropId]: localReactionSummary(mine) };
      });
      return;
    }

    setSummaries((prev) => {
      const current = prev[dropId] ?? EMPTY_SUMMARY;
      const on = current.mine.includes(reaction);
      const mine = toggleReactionMine(current.mine, reaction);
      const counts = { ...current.counts };
      counts[reaction] = Math.max(0, (counts[reaction] ?? 0) + (on ? -1 : 1));
      if (counts[reaction] === 0) delete counts[reaction];
      return { ...prev, [dropId]: { counts, mine } };
    });

    const outcome = await postReactionToggle({ id: dropId, reaction, actor: actorId });
    if (outcome.kind === "unknown-drop") {
      localOnly.current.add(dropId);
      setSummaries((prev) => {
        const current = prev[dropId] ?? EMPTY_SUMMARY;
        writeLocalReactions(dropId, current.mine);
        return { ...prev, [dropId]: localReactionSummary(current.mine) };
      });
      return;
    }
    if (outcome.kind === "confirmed" && outcome.summary) {
      setSummaries((prev) => ({
        ...prev,
        [dropId]: outcome.summary as ReactionSummary,
      }));
      return true;
    }

    if (outcome.kind === "confirmed") return true;

    // Network/503. Reverse the optimistic flip against the latest local state
    // and report failure so FeedCard can show its save-failure prompt. Keeping
    // the optimistic state here makes a failed reaction look durable.
    setSummaries((prev) => {
      const current = prev[dropId] ?? EMPTY_SUMMARY;
      const on = current.mine.includes(reaction);
      const mine = toggleReactionMine(current.mine, reaction);
      const counts = { ...current.counts };
      counts[reaction] = Math.max(0, (counts[reaction] ?? 0) + (on ? -1 : 1));
      if (counts[reaction] === 0) delete counts[reaction];
      return { ...prev, [dropId]: { counts, mine } };
    });
    return false;
  }, [actorId]);

  if (loading) return <ProfileTimelineSample />;

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

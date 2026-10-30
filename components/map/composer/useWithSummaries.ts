"use client";

import { useEffect, useMemo, useState } from "react";

import { authedFetch } from "@/lib/authedFetch";
import { parseWithSummary, type PintDropWithSummary } from "@/lib/pintDropWithTags";

// The "with" line on a list of drops: ONE read for the whole list, never one
// per card. The list paints its drops first and the lines arrive after, so a
// slow or failed read costs the lines and nothing else. A signed-out reader
// gets the public answer (approved handles only); a signed-in one also reads
// their own drops' tags (app/api/social/tags/with/route.ts).

/** The route's cap on one read (MAX_SUMMARY_DROPS in the store). */
export const WITH_SUMMARY_BATCH = 60;

const DROP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WithSummaryMap = ReadonlyMap<string, PintDropWithSummary>;

const EMPTY: WithSummaryMap = new Map();

/**
 * The ids worth asking about: stored drops only (an optimistic row has no id
 * the server knows), each once, in list order, at most one batch.
 */
export function withSummaryIds(drops: ReadonlyArray<{ id: string; optimistic?: unknown }>): string[] {
  const ids: string[] = [];
  for (const drop of drops) {
    if (drop.optimistic || !DROP_ID.test(drop.id) || ids.includes(drop.id)) continue;
    ids.push(drop.id);
    if (ids.length >= WITH_SUMMARY_BATCH) break;
  }
  return ids;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const defaultFetcher: Fetcher = (url, init) => authedFetch(url, init, { requiresIdentity: false });

/** Read the summaries for these drops in one request. Any failure is no lines. */
export async function fetchWithSummaries(
  ids: readonly string[],
  fetcher: Fetcher = defaultFetcher,
  signal?: AbortSignal,
): Promise<Map<string, PintDropWithSummary>> {
  const out = new Map<string, PintDropWithSummary>();
  if (ids.length === 0) return out;
  try {
    const url = `/api/social/tags/with?drops=${ids.map(encodeURIComponent).join(",")}`;
    const response = await fetcher(url, { signal, cache: "no-store" });
    if (!response.ok) return out;
    const body = (await response.json().catch(() => null)) as { drops?: unknown } | null;
    const drops = body && typeof body.drops === "object" && body.drops ? (body.drops as Record<string, unknown>) : {};
    for (const id of ids) {
      const summary = parseWithSummary(drops[id]);
      if (summary.approved.length > 0 || summary.pending > 0) out.set(id, summary);
    }
  } catch {
    // A read that failed prints no lines; the drops are already on screen.
  }
  return out;
}

/** The summaries for the drops on screen, keyed by drop id. Empty until read. */
export function useWithSummaries(drops: ReadonlyArray<{ id: string; optimistic?: unknown }>): WithSummaryMap {
  const key = withSummaryIds(drops).join(",");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);
  const [read, setRead] = useState<{ key: string; summaries: WithSummaryMap } | null>(null);

  useEffect(() => {
    if (ids.length === 0) return;
    const controller = new AbortController();
    void fetchWithSummaries(ids, defaultFetcher, controller.signal).then((summaries) => {
      if (!controller.signal.aborted) setRead({ key, summaries });
    });
    return () => controller.abort();
  }, [ids, key]);

  // Keep the last answer while a new list is read, so a line does not blink
  // off when one drop is added; a drop the old answer did not cover has none.
  return read ? read.summaries : EMPTY;
}

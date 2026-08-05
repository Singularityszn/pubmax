import {
  REACTION_KEYS,
  type ReactionKey,
  type ReactionSummary,
} from "@/lib/reactions";

export type ProfileReactionSummaryMap = Record<string, ReactionSummary>;

export type ProfileReactionSummaryLoad = {
  summaries: ProfileReactionSummaryMap;
  localOnlyIds: Set<string>;
  aborted: boolean;
};

const REACTION_SUMMARY_BATCH_SIZE = 100;
const LOCAL_PREFIX = "pubmax:profile:reactions:";

export function readProfileLocalReactions(id: string): ReactionKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFIX + id);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ReactionKey =>
      (REACTION_KEYS as readonly string[]).includes(String(value)),
    );
  } catch {
    return [];
  }
}

export function writeProfileLocalReactions(id: string, mine: ReactionKey[]): void {
  try {
    window.localStorage.setItem(LOCAL_PREFIX + id, JSON.stringify(mine));
  } catch {
    // Storage full or disabled. Reaction still flips in memory this session.
  }
}

export function profileLocalReactionSummary(mine: ReactionKey[]): ReactionSummary {
  const counts: Partial<Record<ReactionKey, number>> = {};
  for (const key of mine) counts[key] = 1;
  return { counts, mine };
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
        const data = (await response.json()) as { summaries?: ProfileReactionSummaryMap };
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

  const summaries: ProfileReactionSummaryMap = {};
  const localOnlyIds = new Set<string>();
  for (const result of results) {
    if ("failed" in result) {
      for (const id of result.batch) {
        localOnlyIds.add(id);
        summaries[id] = profileLocalReactionSummary(readProfileLocalReactions(id));
      }
      continue;
    }
    Object.assign(summaries, result.summaries);
  }

  return { summaries, localOnlyIds, aborted: false };
}

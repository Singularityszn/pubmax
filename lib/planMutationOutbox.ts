// Client-only Night Crawl mutation outbox (WAYFINDER 4.4 / Lane B).
// Bounded localStorage queue that persists arrive/skip intent across reload and
// replays with the stored idempotency key. Server exact-once already exists;
// this catches the phone up when signal returns.
//
// Never stores raw member tokens - body uses PLAN_HTTP_ONLY_SESSION only.
// Never throws on storage failure (degrade like analytics outbox).

import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import type { NightCrawlActionType } from "@/lib/nightCrawl";
import { nightCrawlIdempotencyScope } from "@/lib/nightCrawl";
import type { PlanState, PlanStopDTO } from "@/lib/plan";
import { classifyActionOutcome, type NightCrawlOutcome } from "@/lib/nightCrawl";

export const PLAN_MUTATION_OUTBOX_KEY = "pubmaxx:plan-mutation-outbox:v1";
export const PLAN_MUTATION_OUTBOX_EVENT = "pubmaxx:plan-mutation-outbox";
const MAX_ENTRIES = 50;

export type PlanMutationOutboxStatus =
  | "pending"
  | "conflict"
  | "forbidden"
  | "rejected"
  | "failed";

export type PlanMutationOutboxEntry = {
  version: 1;
  id: string;
  planId: string;
  scope: string;
  idempotencyKey: string;
  method: "POST";
  path: string;
  body: { type: NightCrawlActionType; stopPosition: number; memberToken: string };
  fingerprint: string;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  status: PlanMutationOutboxStatus;
  lastHttpStatus?: number;
};

export type PlanMutationFlushResult = {
  planId: string;
  entryId: string;
  outcome: NightCrawlOutcome | "conflict";
  plan?: PlanState;
};

const inMemory = new Map<string, PlanMutationOutboxEntry>();
let flushPromise: Promise<PlanMutationFlushResult[]> | null = null;

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(PLAN_MUTATION_OUTBOX_EVENT));
  } catch {
    // Event unavailable - storage remains authoritative.
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    const rows = [...inMemory.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_ENTRIES);
    window.localStorage.setItem(PLAN_MUTATION_OUTBOX_KEY, JSON.stringify(rows));
  } catch {
    // Keep in-memory mirror when storage is restricted.
  }
}

function hydrate(): void {
  if (typeof window === "undefined") return;
  if (inMemory.size > 0) return;
  try {
    const raw = window.localStorage.getItem(PLAN_MUTATION_OUTBOX_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const row of parsed) {
      if (!isEntry(row)) continue;
      inMemory.set(row.id, row);
    }
  } catch {
    inMemory.clear();
  }
}

function isEntry(value: unknown): value is PlanMutationOutboxEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as PlanMutationOutboxEntry;
  return (
    row.version === 1 &&
    typeof row.id === "string" &&
    typeof row.planId === "string" &&
    typeof row.scope === "string" &&
    typeof row.idempotencyKey === "string" &&
    typeof row.path === "string" &&
    row.body?.memberToken === PLAN_HTTP_ONLY_SESSION &&
    (row.body.type === "arrived" || row.body.type === "skipped") &&
    typeof row.body.stopPosition === "number"
  );
}

export function listPlanMutationOutbox(planId?: string): PlanMutationOutboxEntry[] {
  hydrate();
  const rows = [...inMemory.values()].sort((a, b) => a.createdAt - b.createdAt);
  return planId ? rows.filter((row) => row.planId === planId) : rows;
}

export function hasPendingPlanMutation(planId: string, scope?: string): boolean {
  return listPlanMutationOutbox(planId).some(
    (row) => row.status === "pending" && (!scope || row.scope === scope),
  );
}

export function removePlanMutationOutboxEntry(id: string): void {
  hydrate();
  if (!inMemory.delete(id)) return;
  persist();
  notify();
}

export function subscribePlanMutationOutbox(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  hydrate();
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== PLAN_MUTATION_OUTBOX_KEY) return;
    inMemory.clear();
    hydrate();
    listener();
  };
  const onLocal = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(PLAN_MUTATION_OUTBOX_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PLAN_MUTATION_OUTBOX_EVENT, onLocal);
  };
}

export async function enqueuePlanMutation(input: {
  planId: string;
  scope: string;
  idempotencyKey: string;
  path: string;
  body: { type: NightCrawlActionType; stopPosition: number };
  fingerprint: string;
}): Promise<PlanMutationOutboxEntry> {
  hydrate();
  const existing = [...inMemory.values()].find(
    (row) => row.scope === input.scope && row.status === "pending",
  );
  if (existing && existing.fingerprint === input.fingerprint) {
    return existing;
  }
  const entry: PlanMutationOutboxEntry = {
    version: 1,
    id: input.scope,
    planId: input.planId,
    scope: input.scope,
    idempotencyKey: input.idempotencyKey,
    method: "POST",
    path: input.path,
    body: {
      type: input.body.type,
      stopPosition: input.body.stopPosition,
      memberToken: PLAN_HTTP_ONLY_SESSION,
    },
    fingerprint: input.fingerprint,
    createdAt: Date.now(),
    attempts: 0,
    status: "pending",
  };
  inMemory.set(entry.id, entry);
  // Bound the queue.
  if (inMemory.size > MAX_ENTRIES) {
    const ordered = [...inMemory.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const drop of ordered.slice(0, ordered.length - MAX_ENTRIES)) {
      inMemory.delete(drop.id);
    }
  }
  persist();
  notify();
  return entry;
}

export async function enqueueNightCrawlAction(input: {
  planId: string;
  type: NightCrawlActionType;
  stop: PlanStopDTO;
  idempotencyKey: string;
  fingerprint: string;
}): Promise<PlanMutationOutboxEntry> {
  const scope = nightCrawlIdempotencyScope(input.planId, input.type, input.stop.position);
  return enqueuePlanMutation({
    planId: input.planId,
    scope,
    idempotencyKey: input.idempotencyKey,
    path: `/api/plans/${input.planId}/actions`,
    body: { type: input.type, stopPosition: input.stop.position },
    fingerprint: input.fingerprint,
  });
}

function markEntry(
  entry: PlanMutationOutboxEntry,
  patch: Partial<PlanMutationOutboxEntry>,
): void {
  const next = { ...entry, ...patch };
  inMemory.set(next.id, next);
  persist();
  notify();
}

export function flushPlanMutationOutbox(options?: {
  planId?: string;
  signal?: AbortSignal;
}): Promise<PlanMutationFlushResult[]> {
  if (flushPromise) return flushPromise;
  const run = (async (): Promise<PlanMutationFlushResult[]> => {
    hydrate();
    const pending = listPlanMutationOutbox(options?.planId).filter((row) => row.status === "pending");
    const results: PlanMutationFlushResult[] = [];
    for (const entry of pending) {
      if (options?.signal?.aborted) break;
      markEntry(entry, { attempts: entry.attempts + 1, lastAttemptAt: Date.now() });
      try {
        const response = await fetch(entry.path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": entry.idempotencyKey,
          },
          body: JSON.stringify(entry.body),
          keepalive: true,
          signal: options?.signal,
        });
        const status = response.status;
        const body = (await response.json().catch(() => null)) as PlanState | null;
        if (status === 409) {
          markEntry(entry, { status: "conflict", lastHttpStatus: status });
          results.push({ planId: entry.planId, entryId: entry.id, outcome: "conflict" });
          continue;
        }
        const outcome = classifyActionOutcome(status);
        if (outcome === "confirmed") {
          removePlanMutationOutboxEntry(entry.id);
          results.push({
            planId: entry.planId,
            entryId: entry.id,
            outcome: "confirmed",
            plan: body && Array.isArray(body.stops) ? body : undefined,
          });
          continue;
        }
        if (outcome === "forbidden") {
          markEntry(entry, { status: "forbidden", lastHttpStatus: status });
          results.push({ planId: entry.planId, entryId: entry.id, outcome: "forbidden" });
          continue;
        }
        if (outcome === "rejected") {
          markEntry(entry, { status: "rejected", lastHttpStatus: status });
          results.push({ planId: entry.planId, entryId: entry.id, outcome: "rejected" });
          continue;
        }
        // offline / 5xx - keep pending
        markEntry(entry, { lastHttpStatus: status });
        results.push({ planId: entry.planId, entryId: entry.id, outcome: "offline" });
      } catch {
        results.push({ planId: entry.planId, entryId: entry.id, outcome: "offline" });
      }
    }
    return results;
  })();
  flushPromise = run;
  void run.finally(() => {
    if (flushPromise === run) flushPromise = null;
  });
  return run;
}

/** Test helper: replace in-memory + storage state. */
export function __resetPlanMutationOutboxForTests(): void {
  inMemory.clear();
  flushPromise = null;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(PLAN_MUTATION_OUTBOX_KEY);
    } catch {
      // ignore
    }
  }
}

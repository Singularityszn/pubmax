// Operator facts store - dual backend (process-memory + Supabase
// public.operator_facts, migration 0217).
//
// This store holds what a moderator's ACCEPTANCE of a verified operator's
// proposal publishes: one fact per proposal, keyed on the proposal id, so a
// second accept of the same proposal republishes the one row rather than
// adding a twin. A later decline WITHDRAWS it, and a withdrawn fact is never
// read. The only writer is the moderator branch of
// app/api/operator-proposals/route.ts; browser roles may read the public
// columns of a published row and write nothing (0217).
//
// It NEVER writes a venue fact, a price, hours or a pin. Nothing that ranks,
// colours or orders a venue may import this module
// (__tests__/operatorFactsFence.test.ts).
//
// Reads are fail-soft. A HARD durable publish failure THROWS so the route
// answers 503 rather than a fake success. A missing table in production is
// refused on the publish path (onMissingDurableWrite); a withdrawal from a
// table that does not exist has nothing to take down.

import "server-only";

import { randomUUID } from "crypto";

import {
  isPublishedOperatorFact,
  operatorFactFromProposal,
  type OperatorFact,
  type OperatorFactKind,
} from "@/lib/operatorFacts";
import type { OperatorProposal } from "@/lib/operatorProposals";
import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
  whereVenueIdIn,
} from "@/lib/storeBackend";
import { storedVenueIds } from "@/lib/venueAliases";

const TABLE = "operator_facts";
const MIGRATION_HINT = "apply migration 0217";
const STORE_TAG = "operator-facts";

/** Bounded reads: never return more than this many rows for one query. */
const MAX_FACT_ROWS = 50;

const FACT_KINDS: readonly OperatorFactKind[] = ["correction", "event", "offer", "response"];
const NIGHT_KINDS: readonly OperatorFactKind[] = ["event", "offer"];

type OperatorFactsRead = { status: "ready" | "degraded"; facts: OperatorFact[] };

type PublishableProposal = Pick<OperatorProposal, "id" | "venueId" | "accountId" | "type" | "payload">;

export type OperatorFactsStore = {
  /** Publish the fact for an accepted proposal. Idempotent on the proposal id. THROWS on a hard failure. */
  publish(proposal: PublishableProposal, now?: number): Promise<OperatorFact>;
  /** Take down the published fact for a proposal. False when none was published. THROWS on a hard failure. */
  withdraw(proposalId: string, now?: number): Promise<boolean>;
  /** Published facts stored under any of a venue's ids, newest first. Fail-soft (degraded, []). */
  listPublishedForVenue(venueId: string): Promise<OperatorFactsRead>;
  /** Published events and offers dated for one London day, newest first. Fail-soft (degraded, []). */
  listPublishedForDay(serviceDay: string): Promise<OperatorFactsRead>;
};

function byNewest(left: OperatorFact, right: OperatorFact): number {
  return right.publishedAt.localeCompare(left.publishedAt);
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byProposalId = new Map<string, OperatorFact>();

export const memoryOperatorFactsStore: OperatorFactsStore = {
  async publish(proposal, now = Date.now()) {
    const existing = byProposalId.get(proposal.id);
    const fact = operatorFactFromProposal(proposal, {
      id: existing?.id ?? randomUUID(),
      publishedAt: new Date(now).toISOString(),
    });
    byProposalId.set(proposal.id, fact);
    return { ...fact };
  },

  async withdraw(proposalId, now = Date.now()) {
    const hit = byProposalId.get(proposalId);
    if (!hit || !isPublishedOperatorFact(hit)) return false;
    hit.withdrawnAt = new Date(now).toISOString();
    return true;
  },

  async listPublishedForVenue(venueId) {
    const venueIds = await storedVenueIds(venueId);
    const facts = [...byProposalId.values()]
      .filter((fact) => venueIds.includes(fact.venueId) && isPublishedOperatorFact(fact))
      .sort(byNewest)
      .slice(0, MAX_FACT_ROWS)
      .map((fact) => ({ ...fact }));
    return { status: "ready", facts };
  },

  async listPublishedForDay(serviceDay) {
    const facts = [...byProposalId.values()]
      .filter(
        (fact) =>
          isPublishedOperatorFact(fact) &&
          fact.onDate === serviceDay &&
          NIGHT_KINDS.includes(fact.kind),
      )
      .sort(byNewest)
      .slice(0, MAX_FACT_ROWS)
      .map((fact) => ({ ...fact }));
    return { status: "ready", facts };
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard, resetWarnings } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: [TABLE],
  migrationHint: MIGRATION_HINT,
});

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readKind(value: unknown): OperatorFactKind | null {
  return typeof value === "string" && (FACT_KINDS as readonly string[]).includes(value)
    ? (value as OperatorFactKind)
    : null;
}

function fromRow(row: Record<string, unknown>): OperatorFact | null {
  const id = readText(row.id);
  const proposalId = readText(row.proposal_id);
  const venueId = readText(row.venue_id);
  const accountId = readText(row.account_id);
  const publishedAt = readText(row.published_at);
  const kind = readKind(row.kind);
  if (!id || !proposalId || !venueId || !accountId || !publishedAt || !kind) return null;
  const onDate = readText(row.on_date);
  return {
    id,
    proposalId,
    venueId,
    accountId,
    kind,
    title: readText(row.title),
    body: readText(row.body),
    field: readText(row.field),
    when: readText(row.when_text),
    // PostgREST answers a date column as YYYY-MM-DD; anything longer is cut to the day.
    onDate: onDate ? onDate.slice(0, 10) : null,
    publishedAt,
    withdrawnAt: readText(row.withdrawn_at),
  };
}

/** The filter in each query is the rule; this is the same rule again, so a row a query let through by mistake still never reaches a reader. */
function publishedRows(data: unknown): OperatorFact[] {
  return (Array.isArray(data) ? data : [])
    .map((row) => fromRow(row as Record<string, unknown>))
    .filter((fact): fact is OperatorFact => fact !== null && isPublishedOperatorFact(fact));
}

function toRow(fact: OperatorFact) {
  return {
    proposal_id: fact.proposalId,
    venue_id: fact.venueId,
    account_id: fact.accountId,
    kind: fact.kind,
    title: fact.title,
    body: fact.body,
    field: fact.field,
    when_text: fact.when,
    on_date: fact.onDate,
    published_at: fact.publishedAt,
    withdrawn_at: null,
  };
}

export const supabaseOperatorFactsStore: OperatorFactsStore = {
  async publish(proposal, now = Date.now()) {
    return guard({
      context: "publish",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryOperatorFactsStore.publish(proposal, now),
        }),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        const fact = operatorFactFromProposal(proposal, {
          id: randomUUID(),
          publishedAt: new Date(now).toISOString(),
        });
        // One row per proposal: a second accept republishes it in place and
        // keeps the row's own id (the id column is not in the upsert).
        const { data, error } = await admin()
          .from(TABLE)
          .upsert(toRow(fact), { onConflict: "proposal_id" })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        const stored = fromRow(data as Record<string, unknown>);
        if (!stored) throw new Error("operator fact upsert returned an unreadable row");
        return stored;
      },
    });
  },

  async withdraw(proposalId, now = Date.now()) {
    return guard({
      context: "withdraw",
      // A table that does not exist holds no published fact to take down.
      onSchemaMiss: () => memoryOperatorFactsStore.withdraw(proposalId, now),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({ withdrawn_at: new Date(now).toISOString() })
          .eq("proposal_id", proposalId)
          .is("withdrawn_at", null)
          .select("id");
        if (error) throw new Error(error.message);
        return (Array.isArray(data) ? data : []).length > 0;
      },
    });
  },

  async listPublishedForVenue(venueId) {
    return guard({
      context: "list-venue",
      onSchemaMiss: () => memoryOperatorFactsStore.listPublishedForVenue(venueId),
      onError: async () => ({ status: "degraded" as const, facts: [] }),
      message: "venue read failed",
      run: async () => {
        const { data, error } = await whereVenueIdIn(
          admin().from(TABLE).select("*"),
          await storedVenueIds(venueId),
        )
          .is("withdrawn_at", null)
          .order("published_at", { ascending: false })
          .limit(MAX_FACT_ROWS);
        if (error) throw new Error(error.message);
        return { status: "ready" as const, facts: publishedRows(data) };
      },
    });
  },

  async listPublishedForDay(serviceDay) {
    return guard({
      context: "list-day",
      onSchemaMiss: () => memoryOperatorFactsStore.listPublishedForDay(serviceDay),
      onError: async () => ({ status: "degraded" as const, facts: [] }),
      message: "night read failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("on_date", serviceDay)
          .in("kind", [...NIGHT_KINDS])
          .is("withdrawn_at", null)
          .order("published_at", { ascending: false })
          .limit(MAX_FACT_ROWS);
        if (error) throw new Error(error.message);
        const facts = publishedRows(data).filter(
          (fact) => fact.onDate === serviceDay && NIGHT_KINDS.includes(fact.kind),
        );
        return { status: "ready" as const, facts };
      },
    });
  },
};

export const operatorFactsStore = createDualBackendStore(
  memoryOperatorFactsStore,
  supabaseOperatorFactsStore,
);

/** Test-only: clear the in-memory facts and the deduped warnings between cases. */
export function __resetOperatorFacts(): void {
  byProposalId.clear();
  resetWarnings();
}

import "server-only";

import { randomUUID } from "crypto";

import { admin, createFailSoftGuard, selectStore, whereVenueIdIn } from "@/lib/storeBackend";
import type { OperatorFact } from "@/lib/operatorFacts";
import { memoryOperatorFactsStore, operatorFactFromRow } from "@/lib/operatorFactsStore";
import { storedVenueIds } from "@/lib/venueAliases";
import {
  toOperatorProposalDTO,
  type OperatorProposal,
  type OperatorProposalDTO,
  type OperatorProposalFields,
  type OperatorProposalPayload,
  type OperatorProposalStatus,
  type OperatorProposalType,
} from "@/lib/operatorProposals";

const TABLE = "operator_proposals";

/** Bounded reads: never return more than this many rows for one query. */
const MAX_PROPOSAL_ROWS = 500;

export type OperatorProposalDecision =
  | { outcome: "missing" }
  | { outcome: "conflict" }
  | { outcome: "declined" }
  | { outcome: "accepted"; proposal: OperatorProposal; fact: OperatorFact };

export type OperatorProposalStore = {
  /** Persist a new pending proposal. Returns the DTO. THROWS on hard failure. */
  create(fields: OperatorProposalFields, now?: number): Promise<OperatorProposalDTO>;
  /** Moderator review queue: proposals in a status, newest-first. Fail-soft ([]). */
  listForReview(status: OperatorProposalStatus): Promise<OperatorProposal[]>;
  /** Accepted proposals for a venue (what a surface would fold into fact
   *  resolution). Fail-soft ([]). */
  listAcceptedForVenue(venueId: string): Promise<OperatorProposal[]>;
  decide(id: string, status: "accepted" | "declined", note?: string): Promise<OperatorProposalDecision>;
};

// ── In-memory implementation ─────────────────────────────────────────────────
const byId = new Map<string, OperatorProposal>();

function insert(fields: OperatorProposalFields, now: number): OperatorProposal {
  const proposal: OperatorProposal = {
    id: randomUUID(),
    venueId: fields.venueId,
    accountId: fields.accountId,
    type: fields.type,
    payload: fields.payload,
    status: "pending",
    createdAt: new Date(now).toISOString(),
  };
  byId.set(proposal.id, proposal);
  return proposal;
}

export const memoryOperatorProposalStore: OperatorProposalStore = {
  async create(fields, now = Date.now()) {
    return toOperatorProposalDTO(insert(fields, now));
  },

  async listForReview(status) {
    return Array.from(byId.values())
      .filter((p) => p.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_PROPOSAL_ROWS);
  },

  async listAcceptedForVenue(venueId) {
    const venueIds = await storedVenueIds(venueId);
    return Array.from(byId.values())
      .filter((p) => venueIds.includes(p.venueId) && p.status === "accepted")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_PROPOSAL_ROWS);
  },

  async decide(id, status, note) {
    const hit = byId.get(id);
    if (!hit) return { outcome: "missing" };
    if (!decidableFrom(status).includes(hit.status)) return { outcome: "conflict" };
    const now = Date.now();
    const fact = status === "accepted" ? memoryOperatorFactsStore.publish(hit, now) : null;
    if (status === "declined") memoryOperatorFactsStore.withdraw(id, now);
    hit.status = status;
    hit.reviewedAt = new Date(now).toISOString();
    if (note) hit.reviewerNote = note;
    return fact
      ? { outcome: "accepted", proposal: { ...hit }, fact }
      : { outcome: "declined" };
  },
};

/**
 * The states a decision may move from. Accept takes only a pending proposal, so
 * a stale tab cannot accept a declined one. Decline also takes an accepted one:
 * that is the moderator's undo, and a second decline changes nothing.
 */
function decidableFrom(status: "accepted" | "declined"): readonly OperatorProposalStatus[] {
  return status === "accepted" ? ["pending"] : ["pending", "accepted"];
}

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "operator-proposals",
  tables: TABLE,
  migrationHint: "apply migration 0048",
});

function toRow(p: OperatorProposal) {
  return {
    id: p.id,
    venue_id: p.venueId,
    account_id: p.accountId,
    type: p.type,
    payload: p.payload,
    status: p.status,
    reviewed_at: p.reviewedAt ?? null,
    reviewer_note: p.reviewerNote ?? null,
    created_at: p.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): OperatorProposal {
  const rawPayload =
    row.payload && typeof row.payload === "object" ? (row.payload as OperatorProposalPayload) : {};
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    accountId: String(row.account_id),
    type: String(row.type) as OperatorProposalType,
    payload: {
      title: typeof rawPayload.title === "string" ? rawPayload.title : undefined,
      body: typeof rawPayload.body === "string" ? rawPayload.body : undefined,
      field: typeof rawPayload.field === "string" ? rawPayload.field : undefined,
      startsAt: typeof rawPayload.startsAt === "string" ? rawPayload.startsAt : undefined,
      onDate: typeof rawPayload.onDate === "string" ? rawPayload.onDate : undefined,
    },
    status: String(row.status) as OperatorProposalStatus,
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    reviewerNote: row.reviewer_note ? String(row.reviewer_note) : undefined,
  };
}

export const supabaseOperatorProposalStore: OperatorProposalStore = {
  async create(fields, now = Date.now()) {
    const proposal: OperatorProposal = {
      id: randomUUID(),
      venueId: fields.venueId,
      accountId: fields.accountId,
      type: fields.type,
      payload: fields.payload,
      status: "pending",
      createdAt: new Date(now).toISOString(),
    };
    return guard<OperatorProposalDTO>({
      context: "create",
      onSchemaMiss: () => memoryOperatorProposalStore.create(fields, now),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        const { error } = await admin().from(TABLE).insert(toRow(proposal));
        if (error) throw new Error(error.message);
        return toOperatorProposalDTO(proposal);
      },
    });
  },

  async listForReview(status) {
    return guard<OperatorProposal[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryOperatorProposalStore.listForReview(status),
      message: "listForReview failed — returning empty queue",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("status", status)
          .order("created_at", { ascending: false })
          .limit(MAX_PROPOSAL_ROWS);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async listAcceptedForVenue(venueId) {
    return guard<OperatorProposal[]>({
      context: "listAcceptedForVenue",
      onSchemaMiss: () => memoryOperatorProposalStore.listAcceptedForVenue(venueId),
      message: "listAcceptedForVenue failed — returning none",
      onError: () => [],
      run: async () => {
        const { data, error } = await whereVenueIdIn(
          admin().from(TABLE).select("*"),
          await storedVenueIds(venueId),
        )
          .eq("status", "accepted")
          .order("created_at", { ascending: false })
          .limit(MAX_PROPOSAL_ROWS);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async decide(id, status, note) {
    const { data, error } = await admin().rpc("decide_operator_proposal", {
      p_id: id,
      p_status: status,
      p_note: note || null,
    });
    if (error) throw new Error(error.message);
    if (data?.outcome === "missing" || data?.outcome === "conflict" || data?.outcome === "declined") {
      return { outcome: data.outcome };
    }
    if (data?.outcome === "accepted" && data.proposal && data.fact) {
      const fact = operatorFactFromRow(data.fact);
      if (fact) return { outcome: "accepted", proposal: fromRow(data.proposal), fact };
    }
    throw new Error("operator proposal decision returned an unreadable result");
  },
};

/** The single backend selection point (mirrors the other stores). */
export function operatorProposalsStore(): OperatorProposalStore {
  return selectStore(memoryOperatorProposalStore, supabaseOperatorProposalStore);
}

/** Test-only: clear the in-memory state + warn dedupe between cases. */
export function __resetOperatorProposals(): void {
  byId.clear();
  resetSchemaMissWarnings();
}

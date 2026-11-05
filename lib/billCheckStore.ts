// Bill check store - dual backend (process-memory + Supabase
// public.price_bill_checks, migration 0220).
//
// ONE ROW PER BILL READ (captain 5 Nov 2026). The background bill check
// (lib/billCheck.server.ts) writes one row when it has read a bill: the verdict
// (lib/billCheck.ts `BILL_CHECK_RESULTS`), the lines the verdict needs, the
// pub and the submitted price. Nothing else about the bill is kept: no photo
// bytes, no venue name or date read off it, no card digits, no name.
//
// A row names the observation it checked: a Pint Drop, a community submission, or both
// when the one-tap door paired them. A second check of the same bill and observation is refused,
// because a bill is read once.
//
// THE MODERATION QUEUE is the unreviewed mismatches, newest first. A moderator
// REVIEWS a row by stamping it `kept` or `hidden`; the row is never deleted,
// and the price it names is hidden only through that lane's own moderator door
// (app/api/admin/bill-checks/route.ts).
//
// The record write THROWS on a hard failure so the run can log that it did not
// land. Reads are fail-soft. A missing table falls back to memory outside
// production; in production the write refuses rather than keeping a check in
// process memory.

import "server-only";

import { randomUUID } from "crypto";

import {
  BILL_CHECK_MAX_LINES,
  cleanBillCheckResult,
  type BillCheckResult,
  type BillLine,
} from "@/lib/billCheck";
import type { RoundPriceSource } from "@/lib/rounds";
import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const TABLE = "price_bill_checks";
const MIGRATION_HINT = "apply migration 0220";
const STORE_TAG = "bill-checks";

/** Most rows one queue read returns. */
const MAX_QUEUE_ROWS = 100;

/** What a moderator decided about a bill that does not show its price. */
export const BILL_CHECK_REVIEW_DECISIONS = ["kept", "hidden"] as const;
export type BillCheckReviewDecision = (typeof BILL_CHECK_REVIEW_DECISIONS)[number];

export function isBillCheckReviewDecision(value: unknown): value is BillCheckReviewDecision {
  return typeof value === "string" && (BILL_CHECK_REVIEW_DECISIONS as readonly string[]).includes(value);
}

type BillCheckInput = {
  pintDropId?: string;
  communityPriceId?: string;
  communityPriceSubmittedAt?: number;
  roundSource?: RoundPriceSource;
  billHash: string;
  venueId: string;
  priceGbp: number;
  result: BillCheckResult;
  lines: BillLine[];
};

type BillCheckSubject = Pick<BillCheckInput, "pintDropId" | "communityPriceId" | "communityPriceSubmittedAt" | "billHash" | "priceGbp" | "roundSource">;

export type BillCheckRecord = BillCheckInput & {
  id: string;
  checkedAt: string;
  reviewedAt?: string;
  reviewDecision?: BillCheckReviewDecision;
};

/** A second check of one bill. The run reads a bill once. */
class BillAlreadyCheckedError extends Error {
  constructor() {
    super("This bill is already checked.");
    this.name = "BillAlreadyCheckedError";
  }
}

export type BillCheckStore = {
  /** Store one check. THROWS on a hard failure and on a second check of one bill. */
  record(input: BillCheckInput): Promise<BillCheckRecord>;
  findChecked(input: BillCheckSubject): Promise<BillCheckRecord | null>;
  /** Unreviewed mismatches, newest first. Fail-soft ([]). */
  listMismatchesForReview(): Promise<BillCheckRecord[]>;
  /** Stamp one unreviewed mismatch. Null for an unknown id, a reviewed row or any other result. */
  review(id: string, decision: BillCheckReviewDecision, now?: number): Promise<BillCheckRecord | null>;
  releaseReview(check: BillCheckRecord): Promise<void>;
};

function subjectKeys(input: BillCheckSubject): string[] {
  const bill = `${Math.round(input.priceGbp * 100)}:${input.roundSource?.spendId ?? ""}:${input.roundSource?.lineIndex ?? ""}:${input.billHash}`;
  return [
    ...(input.pintDropId ? [`drop:${input.pintDropId}:${bill}`] : []),
    ...(input.communityPriceId ? [`price:${input.communityPriceId}:${input.communityPriceSubmittedAt}:${bill}`] : []),
  ];
}

function assertSubject(input: BillCheckSubject): void {
  if (!/^[a-f0-9]{64}$/.test(input.billHash)) throw new Error("A bill check needs its photo hash.");
  if (input.communityPriceId && !Number.isFinite(input.communityPriceSubmittedAt)) {
    throw new Error("A community bill check needs its submission date.");
  }
  if (!input.communityPriceId && (input.communityPriceSubmittedAt !== undefined || input.roundSource)) {
    throw new Error("A community observation needs its price row.");
  }
  if (!input.pintDropId && !input.communityPriceId) {
    throw new Error("A bill check names the price it checked.");
  }
}

function boundedLines(lines: readonly BillLine[]): BillLine[] {
  return lines.slice(0, BILL_CHECK_MAX_LINES).map((line) => ({ name: line.name, priceGbp: line.priceGbp }));
}

function byNewest(left: BillCheckRecord, right: BillCheckRecord): number {
  return right.checkedAt.localeCompare(left.checkedAt);
}

// ── Memory ───────────────────────────────────────────────────────────────────
const checks = new Map<string, BillCheckRecord>();

export const memoryBillCheckStore: BillCheckStore = {
  async record(input) {
    assertSubject(input);
    const taken = new Set([...checks.values()].flatMap(subjectKeys));
    if (subjectKeys(input).some((key) => taken.has(key))) throw new BillAlreadyCheckedError();
    const stored: BillCheckRecord = {
      ...(input.pintDropId ? { pintDropId: input.pintDropId } : {}),
      ...(input.communityPriceId ? { communityPriceId: input.communityPriceId } : {}),
      ...(input.communityPriceSubmittedAt !== undefined ? { communityPriceSubmittedAt: input.communityPriceSubmittedAt } : {}),
      ...(input.roundSource ? { roundSource: { ...input.roundSource } } : {}),
      billHash: input.billHash,
      venueId: input.venueId,
      priceGbp: input.priceGbp,
      result: input.result,
      lines: boundedLines(input.lines),
      id: randomUUID(),
      checkedAt: new Date().toISOString(),
    };
    checks.set(stored.id, stored);
    return { ...stored, lines: [...stored.lines] };
  },

  async findChecked(input) {
    assertSubject(input);
    const key = subjectKeys(input)[0];
    const hit = [...checks.values()].find((check) => subjectKeys(check).includes(key));
    return hit ? { ...hit, lines: [...hit.lines] } : null;
  },

  async listMismatchesForReview() {
    return [...checks.values()]
      .filter((check) => check.result === "mismatch" && !check.reviewedAt)
      .sort(byNewest)
      .slice(0, MAX_QUEUE_ROWS)
      .map((check) => ({ ...check, lines: [...check.lines] }));
  },

  async review(id, decision, now = Date.now()) {
    const hit = checks.get(id);
    if (!hit || hit.result !== "mismatch" || hit.reviewedAt) return null;
    hit.reviewedAt = new Date(now).toISOString();
    hit.reviewDecision = decision;
    return { ...hit, lines: [...hit.lines] };
  },

  async releaseReview(check) {
    const hit = checks.get(check.id);
    if (hit?.reviewedAt === check.reviewedAt && hit?.reviewDecision === "hidden") {
      delete hit.reviewedAt;
      delete hit.reviewDecision;
    }
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard, resetWarnings } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: [TABLE],
  migrationHint: MIGRATION_HINT,
});

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function linesFromRow(value: unknown): BillLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines: BillLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const line = entry as Record<string, unknown>;
    const name = readText(line.name);
    const price = line.price_gbp;
    if (!name || typeof price !== "number" || !Number.isFinite(price)) return null;
    lines.push({ name, priceGbp: price });
  }
  return lines;
}

function fromRow(row: Record<string, unknown>): BillCheckRecord | null {
  const id = readText(row.id);
  const venueId = readText(row.venue_id);
  const checkedAt = readText(row.checked_at);
  const result = cleanBillCheckResult(row.result);
  const lines = linesFromRow(row.lines);
  const pennies = row.price_pennies;
  const pintDropId = readText(row.pint_drop_id);
  const communityPriceId = readText(row.community_price_id);
  const submittedAt = readText(row.community_price_submitted_at);
  const communityPriceSubmittedAt = submittedAt ? Date.parse(submittedAt) : undefined;
  const source = row.community_price_round_source as Record<string, unknown> | null;
  let roundSource: RoundPriceSource | undefined;
  if (source) {
    if (typeof source.spendId !== "string" || !Number.isInteger(source.lineIndex) || Number(source.lineIndex) < 0) return null;
    roundSource = { spendId: source.spendId, lineIndex: Number(source.lineIndex) };
  }
  const billHash = readText(row.bill_hash);
  if (!billHash || !/^[a-f0-9]{64}$/.test(billHash) || (communityPriceId && !Number.isFinite(communityPriceSubmittedAt))) return null;
  if (!id || !venueId || !checkedAt || !result || !lines) return null;
  if (typeof pennies !== "number" || !Number.isInteger(pennies) || pennies <= 0) return null;
  if (!pintDropId && !communityPriceId) return null;
  const reviewedAt = readText(row.reviewed_at);
  const reviewDecision = isBillCheckReviewDecision(row.review_decision) ? row.review_decision : undefined;
  return {
    id,
    ...(pintDropId ? { pintDropId } : {}),
    ...(communityPriceId ? { communityPriceId } : {}),
    ...(communityPriceSubmittedAt !== undefined ? { communityPriceSubmittedAt } : {}),
    ...(roundSource ? { roundSource } : {}),
    billHash,
    venueId,
    priceGbp: pennies / 100,
    result,
    lines,
    checkedAt,
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(reviewDecision ? { reviewDecision } : {}),
  };
}

function toRow(input: BillCheckInput) {
  return {
    pint_drop_id: input.pintDropId ?? null,
    community_price_id: input.communityPriceId ?? null,
    community_price_submitted_at: input.communityPriceSubmittedAt !== undefined
      ? new Date(input.communityPriceSubmittedAt).toISOString() : null,
    bill_hash: input.billHash,
    community_price_round_source: input.roundSource ?? null,
    venue_id: input.venueId,
    price_pennies: Math.round(input.priceGbp * 100),
    result: input.result,
    lines: boundedLines(input.lines).map((line) => ({ name: line.name, price_gbp: line.priceGbp })),
  };
}

export const supabaseBillCheckStore: BillCheckStore = {
  async record(input) {
    assertSubject(input);
    return guard({
      context: "record",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryBillCheckStore.record(input),
        }),
      // No onError: a hard write failure THROWS so the run can log it.
      run: async () => {
        const { data, error } = await admin().from(TABLE).insert(toRow(input)).select("*").single();
        if (error) {
          if (error.code === "23505") throw new BillAlreadyCheckedError();
          throw new Error(error.message);
        }
        const stored = fromRow(data as Record<string, unknown>);
        if (!stored) throw new Error("bill check insert returned an unreadable row");
        return stored;
      },
    });
  },

  async findChecked(input) {
    assertSubject(input);
    return guard({
      context: "find-checked",
      onSchemaMiss: () => memoryBillCheckStore.findChecked(input),
      run: async () => {
        let query = admin().from(TABLE).select("*").eq("bill_hash", input.billHash)
          .eq("price_pennies", Math.round(input.priceGbp * 100));
        query = input.pintDropId
          ? query.eq("pint_drop_id", input.pintDropId)
          : query.eq("community_price_id", input.communityPriceId!)
            .eq("community_price_submitted_at", new Date(input.communityPriceSubmittedAt!).toISOString());
        query = input.roundSource
          ? query.eq("community_price_round_source", JSON.stringify(input.roundSource))
          : query.is("community_price_round_source", null);
        const { data, error } = await query.limit(1);
        if (error) throw new Error(error.message);
        return Array.isArray(data) && data.length > 0 ? fromRow(data[0] as Record<string, unknown>) : null;
      },
    });
  },

  async listMismatchesForReview() {
    return guard({
      context: "list-review",
      onSchemaMiss: () => memoryBillCheckStore.listMismatchesForReview(),
      onError: async () => [],
      message: "review read failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("result", "mismatch")
          .is("reviewed_at", null)
          .order("checked_at", { ascending: false })
          .limit(MAX_QUEUE_ROWS);
        if (error) throw new Error(error.message);
        return (Array.isArray(data) ? data : [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((check): check is BillCheckRecord => check !== null && check.result === "mismatch");
      },
    });
  },

  async review(id, decision, now = Date.now()) {
    return guard({
      context: "review",
      onSchemaMiss: () => memoryBillCheckStore.review(id, decision, now),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({ reviewed_at: new Date(now).toISOString(), review_decision: decision })
          .eq("id", id)
          .eq("result", "mismatch")
          .is("reviewed_at", null)
          .select("*")
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? fromRow(data as Record<string, unknown>) : null;
      },
    });
  },

  async releaseReview(check) {
    return guard({
      context: "release-review",
      onSchemaMiss: () => memoryBillCheckStore.releaseReview(check),
      run: async () => {
        const { error } = await admin().from(TABLE)
          .update({ reviewed_at: null, review_decision: null })
          .eq("id", check.id)
          .eq("reviewed_at", check.reviewedAt!)
          .eq("review_decision", "hidden");
        if (error) throw new Error(error.message);
      },
    });
  },
};

export const billCheckStore = createDualBackendStore(memoryBillCheckStore, supabaseBillCheckStore);

/** Test-only: clear the in-memory checks and the deduped warnings between cases. */
export function __resetBillChecks(): void {
  checks.clear();
  resetWarnings();
}

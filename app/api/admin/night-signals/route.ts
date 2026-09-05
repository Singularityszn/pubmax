// Night Signal candidate review, on the moderator door.
//   GET  ?status=pending|approved|rejected&limit=  → { durable, candidates, sweep }
//   POST { action: "approve" | "reject", id, authority? } → { ok, candidate }
//   POST { action: "requeue", keys? }                     → { ok, requeued }
//
// This is the review surface the cron's own header named as its follow-up. A
// serverless function cannot own the git-PR flow the CLI uses, so the sweep
// stores PENDING candidates and a person advances them here. Approving is what
// puts a claim in front of readers, which is why it is one gate, one decision
// and one authority, and why an already-decided candidate answers 409 rather
// than being quietly overwritten.
//
// Token-gated like every other /api/admin route: the same `isModerator`
// credential, no second auth layer. The queue carries unreviewed third-party
// claims and the shape of our own provider spend, so migration 0034 (approved
// current rows only) and 0146 (nothing at all) grant the browser neither.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import type { NightSignalReviewState } from "@/lib/nightSignalClaims";
import {
  MAX_QUERY_ATTEMPTS,
  MAX_REVIEW_PAGE,
  NIGHT_SIGNAL_SWEEP_SCOPE,
  parseReviewAction,
  parseReviewAuthority,
  requeueTerminalQueries,
  RETRY_QUERY_BUDGET,
} from "@/lib/nightSignalReview";
import {
  nightSignalCandidateStore,
  nightSignalCheckpointStore,
  nightSignalStoreIsDurable,
} from "@/lib/nightSignalStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_STATES: readonly NightSignalReviewState[] = ["pending", "approved", "rejected"];

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

/** Same per-IP budget the other moderator doors spend. */
async function rateLimited(request: Request): Promise<Response | null> {
  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-night-signals:${ipKey}`, `admin-night-signals:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  return null;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, MAX_REVIEW_PAGE);
}

export async function GET(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();
  const limited = await rateLimited(request);
  if (limited) return limited;

  const url = new URL(request.url);
  const requested = url.searchParams.get("status")?.trim() ?? "pending";
  if (!REVIEW_STATES.includes(requested as NightSignalReviewState)) {
    return publicApiError("Unknown review state.", "INVALID_REQUEST", 400);
  }
  const state = requested as NightSignalReviewState;

  const listed = await nightSignalCandidateStore().list({
    state,
    limit: parseLimit(url.searchParams.get("limit")),
  });
  if (listed.status === "unavailable") {
    // An empty queue would read as "nothing to review". A read we could not run
    // says so instead.
    return publicApiError("Night Signal candidate store unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  const checkpoint = await nightSignalCheckpointStore().read(NIGHT_SIGNAL_SWEEP_SCOPE, Date.now());
  return jsonNoStore({
    durable: nightSignalStoreIsDurable(),
    state,
    maxQueryAttempts: MAX_QUERY_ATTEMPTS,
    retryQueryBudget: RETRY_QUERY_BUDGET,
    candidates: listed.candidates,
    sweep: checkpoint
      ? {
          scope: checkpoint.scope,
          deferred: checkpoint.deferred,
          terminal: checkpoint.terminal,
          leaseOwner: checkpoint.leaseOwner,
          leaseExpiresAt: checkpoint.leaseExpiresAt,
          lastRun: checkpoint.lastRun,
          updatedAt: checkpoint.updatedAt,
        }
      : null,
  });
}

export async function POST(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();
  const limited = await rateLimited(request);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  if (body.action === "requeue") {
    const now = Date.now();
    const checkpoint = await nightSignalCheckpointStore().read(NIGHT_SIGNAL_SWEEP_SCOPE, now);
    if (!checkpoint) {
      return publicApiError("Night Signal checkpoint unavailable.", "CHECKPOINT_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    const keys = Array.isArray(body.keys)
      ? body.keys.filter(
          (value): value is string => typeof value === "string" && value.trim() !== "",
        )
      : undefined;
    const requeued = requeueTerminalQueries(checkpoint, { now, keys });
    if (requeued.requeued === 0) return jsonNoStore({ ok: true, requeued: 0 });
    const saved = await nightSignalCheckpointStore().save(requeued.checkpoint);
    if (saved.status !== "committed") {
      // Answering ok over a checkpoint that never moved would leave the
      // queries refused in silence.
      return publicApiError("Night Signal checkpoint unavailable.", "CHECKPOINT_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
    return jsonNoStore({ ok: true, requeued: requeued.requeued });
  }

  const action = parseReviewAction(body.action);
  if (!action) return publicApiError("Unsupported action.", "INVALID_REQUEST", 400);

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return publicApiError("A candidate id is required.", "INVALID_REQUEST", 400);

  const authority = parseReviewAuthority(body.authority);
  if (!authority) {
    return publicApiError("Unsupported review authority.", "INVALID_REQUEST", 400);
  }

  const result = await nightSignalCandidateStore().review(id, {
    action,
    authority,
    now: Date.now(),
  });
  if (result.status === "not_found") {
    return publicApiError("Candidate not found.", "NOT_FOUND", 404);
  }
  if (result.status === "already_decided") {
    return publicApiError("This candidate was already reviewed.", "ALREADY_REVIEWED", 409, {
      compatibilityFields: {
        reviewState: result.reviewState,
        reviewedAt: result.reviewedAt,
        reviewAuthority: result.reviewAuthority,
      },
    });
  }
  if (result.status === "expired") {
    return publicApiError("This candidate has expired.", "CANDIDATE_EXPIRED", 422, {
      compatibilityFields: { expiresAt: result.expiresAt },
    });
  }
  if (result.status === "unavailable") {
    return publicApiError("Night Signal candidate store unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return jsonNoStore({ ok: true, candidate: result.candidate });
}

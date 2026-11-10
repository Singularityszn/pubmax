// Operator proposals (Wayfinder 3.5) — the propose + review seam.
//
//   POST { venueId, type, payload }                    → 201 { proposal } (verified operator)
//   POST { action: "accept", id, note? }               → 200 { ok, materialized, fact } (moderator)
//   POST { action: "decline", id, note? }              → 200 { ok }              (moderator)
//   GET  ?status=pending|accepted|declined             → 200 { proposals }       (moderator)
//
// One OperatorProposalStore interface, two implementations
// (lib/operatorProposalsStore): Supabase (public.operator_proposals) when env
// keys exist, process-memory otherwise, with a fail-soft-to-memory degradation
// until migration 0047 lands.
//
// Boundaries (write-surface certification): the CREATE path is ACCOUNT + a narrow
// CAPABILITY — account_id is the VERIFIED Supabase uid (callerAuthIdentity), and
// the caller must ALREADY be a VERIFIED operator of the venue
// (venueOperatorsStore().isVerifiedOperator) or the proposal is refused 403; it is
// durably RATE LIMITED per account + hashed IP (rate_limit class). accept/decline
// require the admin token (isModerator — moderator class). A hard durable write
// failure answers 503.
//
// TRUSTED DATA IS UNTOUCHED. A proposal NEVER writes a venue fact. Only the
// moderator ACCEPT branch — this file, the admin acceptance seam — materialises an
// accepted payload into a served fact, and even then only as a `FactSource` of
// authority `operator` (rank 0, factClaims.acceptedProposalFactSource): additive,
// attributed evidence that surfaces as a conflict, never a silent overwrite.
//
// NOT under the solo-operator SOCIAL freeze: an operator proposal is venue-business
// content, not a social post — see the PR body for the exemption stance.

import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerAuthIdentity } from "@/lib/authServer";
import { acceptedProposalFactSource } from "@/lib/factClaims";
import { log } from "@/lib/log";
import { toPublicOperatorFact } from "@/lib/operatorFacts";
import {
  isOperatorProposalStatus,
  proposalServedValue,
  validateOperatorProposal,
} from "@/lib/operatorProposals";
import { operatorProposalsStore } from "@/lib/operatorProposalsStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { venueOperatorsStore } from "@/lib/venueOperatorsStore";

assertServerEnv();

const PROPOSAL_LIMIT = 20;

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // ── Moderator decisions (accept / decline) ──────────────────────────────────
  const action = readString(body.action);
  if (action === "accept" || action === "decline") {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    const id = readString(body.id);
    if (!id) return publicApiError("Proposal not found.", "NOT_FOUND", 404);
    const note = readString(body.note);
    try {
      const result = await operatorProposalsStore().decide(
        id, action === "accept" ? "accepted" : "declined", note,
      );
      if (result.outcome === "missing") {
        return publicApiError("Proposal not found.", "NOT_FOUND", 404);
      }
      if (result.outcome === "conflict") {
        return publicApiError("This proposal was already decided.", "CONFLICT", 409);
      }
      if (result.outcome === "declined") return jsonNoStore({ ok: true }, { status: 200 });
      const { proposal, fact } = result;
      const acceptedAt = Date.parse(fact.publishedAt);

      const materialized = acceptedProposalFactSource({
        value: proposalServedValue(proposal),
        acceptedAt,
        publisher: `operator:${proposal.accountId}`,
      });
      return jsonNoStore(
        { ok: true, materialized, fact: toPublicOperatorFact(fact) },
        { status: 200 },
      );
    } catch (err) {
      log("error", "operator_proposals.decision_failed", {
        route: "POST /api/operator-proposals",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // ── Create a proposal (verified operator only) ──────────────────────────────
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return publicApiError("Sign in to propose an update.", "UNAUTHENTICATED", 401);
  }

  const result = validateOperatorProposal(body, identity.id);
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_PROPOSAL", 400);
  }

  // Capability gate: the caller must be a VERIFIED operator of THIS venue. An
  // unverified or rejected/revoked claim cannot propose (fail-closed on a storage
  // wobble — isVerifiedOperator returns false).
  const verified = await venueOperatorsStore().isVerifiedOperator(
    identity.id,
    result.fields.venueId,
  );
  if (!verified) {
    return publicApiError(
      "Only an approved operator of this venue can propose an update.",
      "NOT_VERIFIED_OPERATOR",
      403,
    );
  }

  // Durable per-account + hashed-IP rate limit (the certification boundary).
  const ipHash = hashIp(clientIp(request));
  const key = `operator-proposal:${identity.id}:${ipHash}`;
  if (await isLimited(key, key, PROPOSAL_LIMIT)) {
    return publicApiError("Too many proposals, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const proposal = await operatorProposalsStore().create(result.fields);
    return jsonNoStore({ proposal }, { status: 201 });
  } catch (err) {
    log("error", "operator_proposals.create_failed", {
      route: "POST /api/operator-proposals",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (!status) {
    return publicApiError("Choose a status.", "INVALID_REQUEST", 400);
  }
  if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
  if (!isOperatorProposalStatus(status)) {
    return publicApiError("Unknown status.", "INVALID_REQUEST", 400);
  }
  try {
    const proposals = await operatorProposalsStore().listForReview(status);
    return jsonNoStore({ proposals }, { status: 200 });
  } catch (err) {
    log("error", "operator_proposals.list_review_failed", {
      route: "GET /api/operator-proposals",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}

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
// attributed evidence that surfaces as a conflict, never a silent overwrite. The
// proposal store itself imports no fact module (fence test).
//
// PUBLISHED, NOT JUST BUILT (launch plan 1 Nov 2026, section 7 item 1). The
// accept branch also PUBLISHES one operator fact (lib/operatorFactsStore.ts,
// migration 0217), which the venue sheet's "From the pub" block and Tonight
// read. It publishes BEFORE it stamps the status, so a publish that fails
// leaves the proposal pending and answers 503; a status stamp that fails after
// the publish takes the fact back down, so a proposal that is not accepted
// never shows. A decline WITHDRAWS any fact an earlier accept published, and
// it does that before the stamp for the same reason. Nothing else writes a fact.
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
import { operatorFactsStore } from "@/lib/operatorFactsStore";
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
      const store = operatorProposalsStore();

      if (action === "decline") {
        // Take down anything an earlier accept published FIRST: a withdrawal
        // that fails leaves the proposal as it was and answers 503.
        await operatorFactsStore().withdraw(id);
        const done = await store.setStatus(id, "declined", note);
        return done
          ? jsonNoStore({ ok: true }, { status: 200 })
          : publicApiError("Proposal not found.", "NOT_FOUND", 404);
      }

      // ── The admin acceptance seam ─────────────────────────────────────────
      // Load the proposal, publish its operator fact, stamp it accepted, then
      // materialise the accepted payload into an `operator` FactSource. This
      // is the ONLY path from a proposal to served evidence. Rank-0 authority
      // means it can never silently outrank the observed corpus — a venue
      // surface folds it in and exposes any disagreement as a conflict.
      const proposal = await store.getById(id);
      if (!proposal) return publicApiError("Proposal not found.", "NOT_FOUND", 404);

      const acceptedAt = Date.now();
      // Publish first: a publish that fails THROWS (503) with the proposal
      // still pending, so nothing claims a fact the store did not keep.
      const facts = operatorFactsStore();
      const fact = await facts.publish(proposal, acceptedAt);
      let done = false;
      try {
        done = await store.setStatus(id, "accepted", note);
      } finally {
        // A proposal that did not become accepted shows nothing.
        if (!done) await facts.withdraw(id).catch(() => false);
      }
      if (!done) return publicApiError("Proposal not found.", "NOT_FOUND", 404);

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

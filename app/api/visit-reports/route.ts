// Structured Visit Reports (Wayfinder 3.4) — the single write/read seam.
//
//   POST { venueId, handle, visitedAt?, busyness?, atmosphere?, wouldReturn?,
//          priceSanity?, note? }                         → 201 { report }
//   POST { action: "report", id, reason?, actor? }        → 200 { ok } (public)
//   POST { action: "restore" | "keep_hidden", id, note? } → 200 { ok } (moderator)
//   GET  ?venueId=…               → 200 { reports, summary } (public, no scores)
//   GET  ?status=hidden           → 200 { reports } (moderator review queue)
//
// One VisitReportStore interface, two implementations (lib/visitReportsStore):
// Supabase (public.structured_visit_reports) when env keys exist, process-memory
// otherwise, with a fail-soft-to-memory degradation until migration 0046 lands.
//
// Boundaries (write-surface certification): PUBLIC keyless contribution path.
// Creation and reporting are durably RATE LIMITED (rate_limit class); moderator
// restore/keep_hidden require the admin token (moderator class). A note is
// slop-filtered + capped at validation; identity is the self-asserted handle,
// gated by gateHandleAction, the same demo posture as a Pint Drop / rating. A
// hard durable write failure answers 503, never a fake success. Creation pauses
// under the solo-operator social freeze; reporting + moderation stay open.

import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { log } from "@/lib/log";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { validateVisitReport, type VisitReportStatus } from "@/lib/visitReports";
import { visitReportsStore } from "@/lib/visitReportsStore";
import { summariseVisitReports } from "@/lib/visitReportSummary";

// A genuine reporter files a handful of reports; more from one origin in the
// window is abuse. Durable per-handle + hashed-IP, like the app's other writes.
const CREATE_WINDOW_MS = 60_000;
// One report flag per actor per target per window (a second is rejected cheaply
// before it touches the store; durable per-actor uniqueness lives in the store).
const REPORT_PER_ACTOR_LIMIT = 1;

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

  // ── Public report (abuse flag) ─────────────────────────────────────────────
  // A report records per-actor-deduped metadata; the row is hidden from public
  // reads only once VISIT_REPORT_HIDE_THRESHOLD DISTINCT actors flag it (never
  // on the first). Reporting stays open under the social freeze.
  if (body.action === "report") {
    const id = readString(body.id);
    if (!id) return publicApiError("Visit report not found.", "NOT_FOUND", 404);
    const actorHash = hashActor(readString(body.actor) || `ip:${hashIp(clientIp(request))}`);
    if (
      (await isLimited(`visit-report-report:${id}`, `visit-report-report:${id}`)) ||
      (await isLimited(
        `visit-report-report:${id}:${actorHash}`,
        `visit-report-report:${id}:${actorHash}`,
        REPORT_PER_ACTOR_LIMIT,
      ))
    ) {
      return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    try {
      const done = await visitReportsStore().report(id, readString(body.reason), actorHash);
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Visit report not found.", "NOT_FOUND", 404);
    } catch (err) {
      log("error", "visit_reports.report_failed", {
        route: "POST /api/visit-reports",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // ── Moderator decisions ────────────────────────────────────────────────────
  if (body.action === "restore" || body.action === "keep_hidden") {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    const id = readString(body.id);
    if (!id) return publicApiError("Visit report not found.", "NOT_FOUND", 404);
    const status: VisitReportStatus = body.action === "restore" ? "visible" : "hidden";
    try {
      const done = await visitReportsStore().moderate(id, status, readString(body.note));
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Visit report not found.", "NOT_FOUND", 404);
    } catch (err) {
      log("error", "visit_reports.moderate_failed", {
        route: "POST /api/visit-reports",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // ── Create (a social write — paused under the solo-operator freeze) ─────────
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const result = validateVisitReport(body);
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_REPORT", 400);
  }

  // JWT-linked handle wins over a self-asserted body handle when signed in.
  const actorHandle = await resolveMessageHandle(request, result.value.handle);
  if (!actorHandle) {
    return publicApiError("Add a handle.", "INVALID_REPORT", 400);
  }
  const ownership = await gateHandleAction(request, actorHandle);
  if (!ownership.allowed) {
    return publicApiError(ownership.error, "FORBIDDEN", ownership.status);
  }

  // Durable per-handle + hashed-IP rate limit (the certification boundary).
  const ipHash = hashIp(clientIp(request));
  const key = `visit-report:${ownership.handle.toLowerCase()}:${ipHash}`;
  if (await isLimited(ownership.handle, key, undefined, CREATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const report = await visitReportsStore().create({ ...result.value, handle: ownership.handle });
    return jsonNoStore({ report }, { status: 201 });
  } catch (err) {
    log("error", "visit_reports.create_failed", {
      route: "POST /api/visit-reports",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // Moderator review queue: ?status=hidden → the reported rows, WITH metadata.
  const status = params.get("status");
  if (status === "hidden") {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    try {
      const reports = await visitReportsStore().listForReview("hidden");
      return jsonNoStore({ reports }, { status: 200 });
    } catch (err) {
      log("error", "visit_reports.list_review_failed", {
        route: "GET /api/visit-reports",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // Public read: a venue's visible reports + the honest recency-weighted summary
  // (plain lines, NO star score). Fail-soft: the store returns [] on any error,
  // so a venue sheet renders cleanly instead of 500ing.
  const venueId = readString(params.get("venueId"));
  if (!venueId) {
    return publicApiError("A venueId is required.", "INVALID_REQUEST", 400);
  }
  const reports = await visitReportsStore().listForVenue(venueId);
  const summary = summariseVisitReports(reports);
  return jsonNoStore({ reports, summary }, { status: 200 });
}

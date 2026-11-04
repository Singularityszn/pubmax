// Regular nights drinkers added, waiting for a moderator.
//   GET [?status=open|confirmed|hidden]            -> { reports } newest first (default open)
//   PATCH { id, status: "confirmed" | "hidden" }  -> { ok: true }
//
// Same admin gate (x-admin-token header OR httpOnly session cookie;
// lib/adminAuth.ts) and the same metering as the other moderation queues.
//
// A VERDICT STAMPS A STATUS AND NOTHING ELSE. Confirming a report does not
// write a listing or a venue fact: the row is still a drinker's dated report,
// and the reader stops printing the reporter's handle once a person has looked.
// Hiding one takes it off every surface. Confirm applies to an open row once;
// hide applies to an open or a confirmed row once; a second tap is 409.
//
// The queue carries the photo (a short-lived signed URL), the pub, the kind,
// the weekday and the time. The reporting account stays inside the store.

import { isModerator, moderatorStaffRoleId } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import {
  isRegularNightReportDecision,
  isRegularNightReportStatus,
  type ModeratorRegularNightReport,
} from "@/lib/regularNightReports";
import { venueNameReader } from "@/lib/regularNightReports.server";
import { signRegularNightBoard } from "@/lib/regularNightReportMedia.server";
import { regularNightReportsStore } from "@/lib/regularNightReportsStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

export const runtime = "nodejs";

/** A moderator clears a queue a tap at a time, so this is per minute and wide. */
const MODERATION_WRITE_LIMIT = 60;

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-regular-nights:${ipKey}`, `admin-regular-nights:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const requested = new URL(request.url).searchParams.get("status") ?? "open";
  if (!isRegularNightReportStatus(requested)) {
    return publicApiError("Unknown status.", "INVALID_REQUEST", 400);
  }
  const rows = await regularNightReportsStore().listForReview(requested);
  const name = venueNameReader();
  const reports = await Promise.all(
    rows.map(async (row): Promise<ModeratorRegularNightReport> => ({
      id: row.id,
      venueId: row.venueId,
      venueName: await name(row.venueId),
      kind: row.kind,
      weekday: row.weekday,
      startTime: row.startTime,
      note: row.note,
      status: row.status,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      photoUrl: await signRegularNightBoard(row.photoKey).catch(() => null),
    })),
  );
  return jsonNoStore({ reports }, { status: 200 });
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  // Behind the gate and still metered: a leaked token is one address, not an
  // unmetered loop.
  const ipKey = hashIp(clientIp(request));
  const writeKey = `admin-regular-nights-write:${ipKey}`;
  if (await isLimited(writeKey, writeKey, MODERATION_WRITE_LIMIT)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await boundedJson(request, 2 * 1024);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const id = readString(body.id);
  if (!id) return publicApiError("Missing report id.", "INVALID_REQUEST", 400);
  if (!isRegularNightReportDecision(body.status)) {
    return publicApiError("Choose confirmed or hidden.", "INVALID_REQUEST", 400);
  }
  if (!REPORT_ID.test(id)) return publicApiError("Report not found.", "NOT_FOUND", 404);

  const existing = await regularNightReportsStore().getById(id);
  if (!existing) return publicApiError("Report not found.", "NOT_FOUND", 404);

  try {
    const decided = await regularNightReportsStore().decide(
      id,
      body.status,
      moderatorStaffRoleId(request) ?? "admin",
    );
    if (!decided) {
      return publicApiError("That report has already been decided.", "ALREADY_DECIDED", 409);
    }
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

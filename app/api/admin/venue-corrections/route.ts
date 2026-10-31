// "That's wrong" notes, waiting for a moderator.
//   GET [?status=open|resolved|dismissed]       -> { corrections } newest first (default open)
//   PATCH { id, status: "resolved" | "dismissed" } -> { ok: true }
//
// Same admin gate (x-admin-token header OR httpOnly session cookie;
// lib/adminAuth.ts) and the same metering as the other moderation queues.
//
// A VERDICT STAMPS A STATUS AND NOTHING ELSE. Resolving a note does not close a
// pub or change its hours: the moderator fixes the fact through the pack
// rebuild, then marks the note resolved. A verdict applies to an open note
// once; a second tap on a decided one is 409.
//
// A reporter is never identified here: the queue carries the venue, the kind,
// the note and the day, and the owning account stays inside the store.

import { isModerator, moderatorStaffRoleId } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { lookupUkBasePub } from "@/lib/ukBaseIndex";
import { isUkBaseId } from "@/lib/ukBasePubs";
import {
  isVenueCorrectionDecision,
  isVenueCorrectionStatus,
  type ModeratorVenueCorrection,
  type VenueCorrection,
} from "@/lib/venueCorrections";
import { venueCorrectionsStore } from "@/lib/venueCorrectionsStore";
import { resolveStoredVenue } from "@/lib/venueIndex";

assertServerEnv();

/** A moderator clears a queue a tap at a time, so this is per minute and wide. */
const MODERATION_WRITE_LIMIT = 60;

// A uuid column: anything else is a note that does not exist, answered 404
// here rather than asked of PostgreSQL and logged as a 22P02 outage.
const CORRECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

async function venueNameFor(venueId: string): Promise<string | null> {
  try {
    if (isUkBaseId(venueId)) {
      const lookup = await lookupUkBasePub(venueId);
      return lookup.status === "ready" ? lookup.pub.name : null;
    }
    return (await resolveStoredVenue(venueId))?.name ?? null;
  } catch {
    return null;
  }
}

async function toModeratorDTO(
  row: VenueCorrection,
  names: Map<string, Promise<string | null>>,
): Promise<ModeratorVenueCorrection> {
  let name = names.get(row.venueId);
  if (!name) {
    name = venueNameFor(row.venueId);
    names.set(row.venueId, name);
  }
  return {
    id: row.id,
    venueId: row.venueId,
    kind: row.kind,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    venueName: await name,
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-venue-corrections:${ipKey}`, `admin-venue-corrections:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const requested = new URL(request.url).searchParams.get("status") ?? "open";
  if (!isVenueCorrectionStatus(requested)) {
    return publicApiError("Unknown status.", "INVALID_REQUEST", 400);
  }
  const rows = await venueCorrectionsStore().listForReview(requested);
  const names = new Map<string, Promise<string | null>>();
  return jsonNoStore(
    { corrections: await Promise.all(rows.map((row) => toModeratorDTO(row, names))) },
    { status: 200 },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  // Behind the gate and still metered: a leaked token is one address, not an
  // unmetered loop.
  const ipKey = hashIp(clientIp(request));
  const writeKey = `admin-venue-corrections-write:${ipKey}`;
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
  if (!id) return publicApiError("Missing correction id.", "INVALID_REQUEST", 400);
  if (!isVenueCorrectionDecision(body.status)) {
    return publicApiError("Choose resolved or dismissed.", "INVALID_REQUEST", 400);
  }
  if (!CORRECTION_ID.test(id)) return publicApiError("Correction not found.", "NOT_FOUND", 404);

  const existing = await venueCorrectionsStore().getById(id);
  if (!existing) return publicApiError("Correction not found.", "NOT_FOUND", 404);

  try {
    const decided = await venueCorrectionsStore().decide(
      id,
      body.status,
      moderatorStaffRoleId(request) ?? "admin",
    );
    if (!decided) {
      return publicApiError("That note has already been decided.", "ALREADY_DECIDED", 409);
    }
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

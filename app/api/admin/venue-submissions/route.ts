// Pubs drinkers have added, waiting for a moderator.
//   GET ?status=pending|accepted|declined|duplicate -> { submissions }
//   POST { action: "accept" | "decline", id, note? } -> { ok: true }
//   POST { action: "duplicate", id, duplicateOfVenueId, note? } -> { ok: true }
//
// Same admin gate (x-admin-token header OR httpOnly session cookie;
// lib/adminAuth.ts) and the same metering as the other moderation queues.
//
// A VERDICT STAMPS A STATUS AND NOTHING ELSE. Accepting a pub does not draw a
// pin: the offline pack rebuild folds accepted submissions in. A decision
// applies to a pending submission once; a second tap on a decided one is 409.
//
// Each menu file comes with a five-minute signed URL so the moderator can read
// it. A submitter is never identified here: the queue carries the proposal and
// its files, and the owning account stays inside the store.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { supabaseMenuFileStorage } from "@/lib/venueSubmissionMedia.server";
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";
import {
  isVenueSubmissionStatus,
  validateVenueSubmissionDecision,
  venueSubmissionPublicFields,
  type VenueSubmission,
  type VenueSubmissionFileKind,
  type VenueSubmissionPublicFields,
} from "@/lib/venueSubmissions";

assertServerEnv();

/** A moderator clears a queue a tap at a time, so this is per minute and wide. */
const MODERATION_WRITE_LIMIT = 60;

// A uuid column: anything else is a submission that does not exist, answered
// 404 here rather than asked of PostgreSQL and logged as a 22P02 outage.
const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ModeratorVenueSubmission = VenueSubmissionPublicFields & {
  files: { id: string; kind: VenueSubmissionFileKind; byteSize: number; url: string | null }[];
};

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

async function toModeratorDTO(row: VenueSubmission): Promise<ModeratorVenueSubmission> {
  return {
    ...venueSubmissionPublicFields(row),
    files: await Promise.all(
      row.files.map(async (file) => ({
        id: file.id,
        kind: file.kind,
        byteSize: file.byteSize,
        url: await supabaseMenuFileStorage.sign(file.objectKey),
      })),
    ),
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-venue-submissions:${ipKey}`, `admin-venue-submissions:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const requested = new URL(request.url).searchParams.get("status") ?? "pending";
  if (!isVenueSubmissionStatus(requested)) {
    return publicApiError("Unknown status.", "INVALID_REQUEST", 400);
  }
  const rows = await venueSubmissionStore().listForReview(requested);
  return jsonNoStore({ submissions: await Promise.all(rows.map(toModeratorDTO)) }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  // Behind the gate and still metered: a leaked token is one address, not an
  // unmetered loop.
  const ipKey = hashIp(clientIp(request));
  const writeKey = `admin-venue-submissions-write:${ipKey}`;
  if (await isLimited(writeKey, writeKey, MODERATION_WRITE_LIMIT)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await boundedJson(request, 8 * 1024);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const id = readString(body.id);
  if (!id) return publicApiError("Missing submission id.", "INVALID_REQUEST", 400);
  if (!SUBMISSION_ID.test(id)) return publicApiError("Submission not found.", "NOT_FOUND", 404);
  const decision = validateVenueSubmissionDecision(body);
  if (!decision.ok) return publicApiError(decision.error, "INVALID_REQUEST", 400);

  const existing = await venueSubmissionStore().getById(id);
  if (!existing) return publicApiError("Submission not found.", "NOT_FOUND", 404);

  try {
    const decided = await venueSubmissionStore().decide(id, decision.value);
    if (!decided) {
      return publicApiError("That submission has already been decided.", "ALREADY_DECIDED", 409);
    }
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

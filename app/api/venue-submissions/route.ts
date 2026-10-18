// Add a pub: a signed-in drinker proposes a pub the map does not have.
//
//   GET                                          -> 200 { status, submissions } (owner only, newest first);
//                                                   200 { status: "adult_check_required" | ..., error } while a gate stands in front of it
//   POST { name, address, postcode?, latitude?, longitude?, website?, menuUrl?,
//          openingHours?, note?, prices?, confirmNew? }
//                                                -> 201 { submission };
//                                                   409 POSSIBLE_MATCH { details: { matches } } until confirmNew
//   POST multipart { submission: <id>, file: <menu photo> }   (a PDF is refused, 400)
//                                                -> 201 { file: { id, kind } } (the owner's own pending submission)
//
// A SUBMISSION IS A PROPOSAL. Nothing here writes a venue, a pin or a price
// lane. A moderator decides it at /api/admin/venue-submissions, and an accepted
// pub reaches the map through the offline pack rebuild.
//
// LINKS ARE NEVER FETCHED. The website and menu link are stored for a reviewer;
// a harvest reads one only after the owner records it in the source policy.
//
// WHO MAY SUBMIT: a signed-in account with a claimed handle, through the shared
// contribution gate. The owner comes from the SESSION, never from the body.
// Every write is durably rate limited, a hard store failure answers 503 and
// never a fake success, and nothing is cached.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedFormData, boundedJson } from "@/lib/boundedRequest.server";
import { contributionReadRefusalResponse } from "@/lib/contributionReadRefusal.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { UPLOAD_FIELDS_ALLOWANCE_BYTES } from "@/lib/uploadBodyLimit";
import {
  prepareMenuFile,
  supabaseMenuFileStorage,
  VenueSubmissionFileError,
} from "@/lib/venueSubmissionMedia.server";
import { existingVenueMatches } from "@/lib/venueSubmissionMatch.server";
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";
import {
  toVenueSubmissionOwnerDTO,
  validateVenueSubmission,
  VENUE_SUBMISSION_FILE_MAX_BYTES,
  VENUE_SUBMISSION_MAX_FILES,
  VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT,
  venueSubmissionFileKey,
} from "@/lib/venueSubmissions";

assertServerEnv();

export const runtime = "nodejs";

/** A person adds a handful of pubs in an evening; more in an hour is a script. */
const CREATE_LIMIT = 6;
const UPLOAD_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const JSON_BODY_MAX_BYTES = 32 * 1024;

const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storeUnavailable(): Response {
  return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
    retryable: true,
  });
}

function rateLimited(): Response {
  return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, { retryable: true });
}

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await boundedJson(request, JSON_BODY_MAX_BYTES);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The multipart body the form sends: one submission id and one file. */
async function parseUpload(request: Request): Promise<{ submissionId: string; file: File } | null> {
  try {
    const form = await boundedFormData(request, VENUE_SUBMISSION_FILE_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES);
    if ([...form.keys()].some((key) => key !== "submission" && key !== "file")) return null;
    const ids = form.getAll("submission");
    const files = form.getAll("file");
    if (ids.length !== 1 || typeof ids[0] !== "string") return null;
    if (files.length !== 1 || !(files[0] instanceof File)) return null;
    return { submissionId: ids[0], file: files[0] };
  } catch {
    return null;
  }
}

function fileError(error: unknown): Response {
  if (error instanceof VenueSubmissionFileError) {
    const status = error.code === "TOO_LARGE" ? 413 : error.code === "STORAGE_UNAVAILABLE" ? 503 : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  return publicApiError("That file could not be read. Choose another.", "PROCESSING_FAILED", 400);
}

export async function GET(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return contributionReadRefusalResponse(owner);

  const result = await venueSubmissionStore().listForOwner(owner.accountId);
  return jsonNoStore(
    { status: result.status, submissions: result.submissions.map(toVenueSubmissionOwnerDTO) },
    { status: 200 },
  );
}

async function attachFile(request: Request, ownerUserId: string, actor: string): Promise<Response> {
  const key = `venue-submission-file:${actor}`;
  if (await isLimited(key, key, UPLOAD_LIMIT, HOUR_MS)) return rateLimited();

  const upload = await parseUpload(request);
  if (!upload) return publicApiError("Send one menu file at a time.", "MALFORMED_REQUEST", 400);
  if (!SUBMISSION_ID.test(upload.submissionId)) {
    return publicApiError("Submission not found.", "NOT_FOUND", 404);
  }

  // The owner's own PENDING submission only: a decided one is closed to new files.
  const submission = await venueSubmissionStore().getPendingForOwner(ownerUserId, upload.submissionId);
  if (!submission) return publicApiError("Submission not found.", "NOT_FOUND", 404);
  if (submission.files.length >= VENUE_SUBMISSION_MAX_FILES) {
    return publicApiError(`A pub takes up to ${VENUE_SUBMISSION_MAX_FILES} menu files.`, "TOO_MANY_FILES", 409);
  }

  let prepared;
  try {
    prepared = await prepareMenuFile(upload.file);
  } catch (error) {
    return fileError(error);
  }

  const fileId = crypto.randomUUID();
  const objectKey = venueSubmissionFileKey(ownerUserId, submission.id, fileId, prepared.kind);
  try {
    await supabaseMenuFileStorage.upload(objectKey, prepared.bytes, prepared.contentType);
  } catch (error) {
    return fileError(error);
  }

  try {
    const added = await venueSubmissionStore().addFile({
      id: fileId,
      submissionId: submission.id,
      ownerUserId,
      objectKey,
      kind: prepared.kind,
      contentType: prepared.contentType,
      byteSize: prepared.byteSize,
      sha256: prepared.sha256,
    });
    if (added.status !== "added") {
      // The bytes landed but the row was refused: take them back out.
      await supabaseMenuFileStorage.remove([objectKey]);
      return added.status === "too_many_files"
        ? publicApiError(`A pub takes up to ${VENUE_SUBMISSION_MAX_FILES} menu files.`, "TOO_MANY_FILES", 409)
        : publicApiError("Submission not found.", "NOT_FOUND", 404);
    }
    return jsonNoStore({ file: { id: added.file.id, kind: added.file.kind } }, { status: 201 });
  } catch (err) {
    await supabaseMenuFileStorage.remove([objectKey]);
    log("error", "venue_submission.file_failed", {
      route: "POST /api/venue-submissions",
      error: err instanceof Error ? err.message : String(err),
    });
    return storeUnavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  const owner = await resolveContributionIdentity(request);
  if (!owner.ok) return jsonNoStore(owner.body, { status: owner.httpStatus });

  const ipHash = hashIp(clientIp(request));
  const burstKey = `venue-submission:${owner.actor}:${ipHash}`;
  if (await isLimited(burstKey, burstKey)) return rateLimited();

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    return attachFile(request, owner.accountId, owner.actor);
  }

  const body = await parseJson(request);
  if (!body) return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);

  const createKey = `venue-submission-create:${owner.actor}`;
  if (await isLimited(createKey, createKey, CREATE_LIMIT, HOUR_MS)) return rateLimited();

  const result = validateVenueSubmission(owner.accountId, body);
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_VENUE_SUBMISSION", 400, { details: { field: result.field } });
  }

  // Ask before storing a pub the map already has. The drinker answers "it's a
  // different pub" with confirmNew, and the second ask is skipped.
  if (body.confirmNew !== true) {
    const matches = await existingVenueMatches(result.value.name, result.value.postcode);
    if (matches.length > 0) {
      return publicApiError("We might already have this pub.", "POSSIBLE_MATCH", 409, {
        details: { matches },
      });
    }
  }

  try {
    const created = await venueSubmissionStore().create(result.value);
    if (created.status === "too_many_pending") {
      return publicApiError(
        `You have ${VENUE_SUBMISSION_MAX_PENDING_PER_ACCOUNT} pubs waiting for review. Add more once those are checked.`,
        "TOO_MANY_PENDING",
        409,
      );
    }
    return jsonNoStore({ submission: toVenueSubmissionOwnerDTO(created.submission) }, { status: 201 });
  } catch (err) {
    log("error", "venue_submission.create_failed", {
      route: "POST /api/venue-submissions",
      error: err instanceof Error ? err.message : String(err),
    });
    return storeUnavailable();
  }
}

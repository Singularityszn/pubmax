// A regular night a drinker added: a quiz every Tuesday, music on a Sunday.
//
//   GET ?weekday=0..6 | ?venueId=<id>
//        -> 200 { status, reports }   live rows only (open or confirmed, not expired);
//           a caller with a verified session also learns `own` on each row, so
//           the reader can leave "Still on" off the reporter's own nights
//   POST multipart { venueId, kind, weekday, startTime?, note?, photo }
//        -> 201 { report: { id, status, lastSeenAt, expiresAt } }
//   PATCH { id }   "still on", from a different signed-in account, once
//        -> 200 { extended: true, expiresAt }
//
// A REPORT IS NEVER A VENUE FACT AND NEVER TONIGHT'S LISTING. It is one
// drinker's dated sighting with a photo of the board behind it. Nothing here
// moves a pack, a pin, hours or a listing; a moderator confirms or hides it at
// /api/admin/regular-nights, and the reader prints it apart from the sourced
// nights as "per a drinker, seen <date>".
//
// A PHOTO IS REQUIRED, and it goes through the shared upload journey (type,
// size cap, magic bytes, EXIF strip). Nothing is fetched or scraped.
//
// WHO MAY SEND ONE: a signed-in account with a claimed handle, through the
// shared contribution gate (sign_in_required, onboarding_required and the adult
// check). The reporter comes from the SESSION, never from the body. The venue
// must resolve through the one community-write door. Every write is durably
// rate limited, ten reports an hour per account, a hard store failure answers
// 503 and never a fake success, and nothing is cached.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { bearerToken, callerUserId } from "@/lib/authServer";
import { boundedFormData, boundedJson } from "@/lib/boundedRequest.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import {
  readRegularNightWeekday,
  validateRegularNightReport,
} from "@/lib/regularNightReports";
import { publicRegularNightReports } from "@/lib/regularNightReports.server";
import {
  REGULAR_NIGHT_BOARD_MAX_BYTES,
  RegularNightBoardError,
  removeRegularNightBoard,
  storeRegularNightBoard,
} from "@/lib/regularNightReportMedia.server";
import { regularNightReportsStore } from "@/lib/regularNightReportsStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { UPLOAD_FIELDS_ALLOWANCE_BYTES } from "@/lib/uploadBodyLimit";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";

assertServerEnv();

export const runtime = "nodejs";

/** A drinker adds a few nights on a crawl; more than this in an hour is a script. */
const ACTOR_HOURLY_LIMIT = 10;
const STILL_ON_HOURLY_LIMIT = 30;
const HOUR_MS = 60 * 60 * 1000;
const READ_LIMIT = 60;
const READ_WINDOW_MS = 60_000;
const JSON_BODY_MAX_BYTES = 2 * 1024;
const FIELDS = new Set(["venueId", "kind", "weekday", "startTime", "note", "photo"]);

// A uuid column: anything else is a report that does not exist, answered 404
// here rather than asked of PostgreSQL and logged as a 22P02 outage.
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rateLimited(): Response {
  return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
}

function storeUnavailable(): Response {
  return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
    retryable: true,
  });
}

function photoError(error: unknown): Response {
  if (error instanceof RegularNightBoardError) {
    const status = error.code === "TOO_LARGE" ? 413 : error.code === "STORAGE_UNAVAILABLE" ? 503 : 400;
    return publicApiError(error.message, error.code, status, {
      retryable: error.code === "STORAGE_UNAVAILABLE",
    });
  }
  return publicApiError("That photo could not be read. Choose another.", "PROCESSING_FAILED", 400);
}

type ParsedReport = { fields: Record<string, unknown>; photo: File | null };

/** The multipart body the form sends: the fields once each and at most one photo. */
async function parseReport(request: Request): Promise<ParsedReport | null> {
  try {
    const form = await boundedFormData(request, REGULAR_NIGHT_BOARD_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES);
    const fields: Record<string, unknown> = {};
    let photo: File | null = null;
    for (const key of new Set(form.keys())) {
      if (!FIELDS.has(key)) return null;
      const values = form.getAll(key);
      if (values.length !== 1) return null;
      const value = values[0];
      if (key === "photo") {
        if (!(value instanceof File)) return null;
        photo = value;
      } else {
        if (typeof value !== "string") return null;
        fields[key] = value;
      }
    }
    return { fields, photo };
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const ipKey = `regular-nights-read:${hashIp(clientIp(request))}`;
  if (await isLimited(ipKey, ipKey, READ_LIMIT, READ_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const params = new URL(request.url).searchParams;
  const rawWeekday = params.get("weekday");
  const rawVenue = params.get("venueId")?.trim() ?? "";
  const weekday = rawWeekday === null ? null : readRegularNightWeekday(rawWeekday);
  if (rawWeekday !== null && weekday === null) {
    return publicApiError("Choose a weekday from 0 to 6.", "INVALID_REQUEST", 400);
  }
  if (rawVenue.length > 128) return publicApiError("Unknown pub.", "INVALID_REQUEST", 400);
  if (weekday === null && !rawVenue) {
    return publicApiError("Ask for a weekday or a pub.", "INVALID_REQUEST", 400);
  }

  const now = Date.now();
  // Anonymous is the common read and stays a plain read: the session is only
  // asked when the request carries a bearer, and a bad one is anonymous.
  const viewer = bearerToken(request) ? await callerUserId(request) : null;
  const read = await regularNightReportsStore().listLive(
    { ...(weekday === null ? {} : { weekday }), ...(rawVenue ? { venueId: rawVenue } : {}) },
    now,
  );
  return jsonNoStore(
    { status: read.status, reports: await publicRegularNightReports(read.reports, now, viewer) },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const reporter = await resolveContributionIdentity(request);
  if (!reporter.ok) return jsonNoStore(reporter.body, { status: reporter.httpStatus });

  // Burst first, keyed on the account AND the address, like every contribution door.
  const ipHash = hashIp(clientIp(request));
  const burstKey = `regular-night:${reporter.actor}:${ipHash}`;
  if (await isLimited(burstKey, burstKey)) return rateLimited();

  const parsed = await parseReport(request);
  if (!parsed) return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);

  const input = validateRegularNightReport(parsed.fields);
  if (!input.ok) {
    return publicApiError(input.error, "INVALID_REGULAR_NIGHT", 400, { details: { field: input.field } });
  }
  if (!parsed.photo) {
    return publicApiError("Add a photo of the board or the poster.", "INVALID_REGULAR_NIGHT", 400, {
      details: { field: "photo" },
    });
  }

  const actorKey = `regular-night-actor:${reporter.actor}`;
  if (await isLimited(actorKey, actorKey, ACTOR_HOURLY_LIMIT, HOUR_MS)) return rateLimited();

  const target = await resolveWritableVenueId(input.venueId);
  if (!target.ok) return publicApiErrorFromStatus(target.error, target.status);

  const reportId = crypto.randomUUID();
  let photoKey: string;
  try {
    photoKey = await storeRegularNightBoard(parsed.photo, reporter.accountId, reportId);
  } catch (error) {
    return photoError(error);
  }

  try {
    const report = await regularNightReportsStore().create({
      id: reportId,
      venueId: target.venueId,
      kind: input.kind,
      weekday: input.weekday,
      startTime: input.startTime,
      note: input.note,
      photoKey,
      reporterUserId: reporter.accountId,
    });
    return jsonNoStore(
      {
        report: {
          id: report.id,
          status: report.status,
          lastSeenAt: report.lastSeenAt,
          expiresAt: report.expiresAt,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // The bytes landed but the row did not: take them back out.
    await removeRegularNightBoard(photoKey);
    log("error", "regular_night_report.create_failed", {
      route: "POST /api/regular-nights",
      error: err instanceof Error ? err.message : String(err),
    });
    return storeUnavailable();
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const caller = await resolveContributionIdentity(request);
  if (!caller.ok) return jsonNoStore(caller.body, { status: caller.httpStatus });

  const key = `regular-night-still-on:${caller.actor}`;
  if (await isLimited(key, key, STILL_ON_HOURLY_LIMIT, HOUR_MS)) return rateLimited();

  let id = "";
  try {
    const body = await boundedJson(request, JSON_BODY_MAX_BYTES);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const raw = (body as Record<string, unknown>).id;
      id = typeof raw === "string" ? raw.trim() : "";
    }
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  if (!id) return publicApiError("Missing report id.", "INVALID_REQUEST", 400);
  if (!REPORT_ID.test(id)) return publicApiError("Report not found.", "NOT_FOUND", 404);

  try {
    const result = await regularNightReportsStore().stillOn(id, caller.accountId);
    if (result === "not_found") return publicApiError("Report not found.", "NOT_FOUND", 404);
    if (result === "own") {
      return publicApiError("Somebody else has to say it is still on.", "OWN_REPORT", 409);
    }
    if (result === "already") {
      return publicApiError("You have already said this one is still on.", "ALREADY_STILL_ON", 409);
    }
    const report = await regularNightReportsStore().getById(id);
    return jsonNoStore({ extended: true, expiresAt: report?.expiresAt ?? null }, { status: 200 });
  } catch (err) {
    log("error", "regular_night_report.still_on_failed", {
      route: "PATCH /api/regular-nights",
      error: err instanceof Error ? err.message : String(err),
    });
    return storeUnavailable();
  }
}

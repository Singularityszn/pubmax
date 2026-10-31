// "Is the kitchen still open?" (launch review idea A1), one tap on the food row.
//
//   GET ?venueId=<id>
//        -> 200 { status, report }   the newest report inside 90 minutes, or null
//   POST { venueId, state: "open" | "closed" }
//        -> 200 { outcome: "reported" | "confirmed", report }
//        -> 409 the reporter's own matching tap, or a report one other already confirmed
//
// A REPORT IS NEVER A VENUE FACT AND NEVER HOURS. It is one drinker's dated
// word, printed as "Kitchen open, said @handle 20 min ago", and it goes quiet
// after the crowd reading's 90 minute window. A second account's matching tap
// confirms it once, the pint confirmation shape. Nothing here moves a pack, a
// pin, hours or a kitchen time.
//
// WHO MAY TAP: a signed-in account with a claimed handle, through the shared
// contribution gate. The reporter comes from the SESSION, never from the body.
// The venue must resolve through the one community-write door. Every write is
// durably rate limited, a hard store failure answers 503 and never a fake
// success, and nothing is cached. The handle is read at answer time, never
// stored, so a rename shows the new one.
//
// A WITHDRAWN REPORTER SHOWS NOTHING. The handle passes the public-withdrawal
// boundary (lib/accountPublicAccess.server.ts) the way a regular night report
// does (lib/regularNightReports.server.ts): a suspended, banned or deleted
// reporter's reading is dropped, and a check that cannot answer shows no
// reading at all (review P2, PR 2402). This holds for the GET read and the
// POST reply alike.

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson } from "@/lib/boundedRequest.server";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { parseKitchenState, type KitchenReport, type PublicKitchenReport } from "@/lib/kitchenReports";
import { kitchenReportsStore } from "@/lib/kitchenReportsStore";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";

assertServerEnv();

export const runtime = "nodejs";

/** A drinker taps a few kitchens on a crawl; more than this in an hour is a script. */
const ACTOR_HOURLY_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const READ_LIMIT = 60;
const READ_WINDOW_MS = 60_000;
const JSON_BODY_MAX_BYTES = 1024;
const VENUE_ID_MAX = 128;

function rateLimited(): Response {
  return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
}

/**
 * The reporter's current handle when a stranger may read it, else null. A
 * tombstoned row, a withdrawn account and a check that cannot answer are all
 * null: the read fails closed, never open.
 */
async function publicHandleFor(userId: string): Promise<string | null> {
  try {
    const profile = await profileStore().getByUserId(userId);
    if (!profile || isProfileTombstoned(profile)) return null;
    const handle = normalizeHandle(profile.handle);
    if (!handle) return null;
    const hidden = await withdrawnHandles([handle]);
    return hidden.has(handle) ? null : handle;
  } catch {
    return null;
  }
}

/** The public projection: no account id leaves. A report with no handle to show is no reading. */
async function publicKitchenReport(row: KitchenReport | null): Promise<PublicKitchenReport | null> {
  if (!row) return null;
  const handle = await publicHandleFor(row.reporterUserId);
  if (!handle) return null;
  return {
    id: row.id,
    venueId: row.venueId,
    state: row.state,
    reportedAt: row.reportedAt,
    handle,
    confirmed: row.confirmedAt !== null,
  };
}

export async function GET(request: Request): Promise<Response> {
  const ipKey = `kitchen-reports-read:${hashIp(clientIp(request))}`;
  if (await isLimited(ipKey, ipKey, READ_LIMIT, READ_WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const rawVenue = new URL(request.url).searchParams.get("venueId")?.trim() ?? "";
  if (!rawVenue || rawVenue.length > VENUE_ID_MAX) {
    return publicApiError("Ask for a pub.", "INVALID_REQUEST", 400);
  }
  let venueId = rawVenue;
  try {
    venueId = await resolveCanonicalVenueId(rawVenue);
  } catch {
    // An alias table that cannot answer leaves the id as asked.
  }
  const read = await kitchenReportsStore().readLatest(venueId);
  return jsonNoStore({ status: read.status, report: await publicKitchenReport(read.report) }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const reporter = await resolveContributionIdentity(request);
  if (!reporter.ok) return jsonNoStore(reporter.body, { status: reporter.httpStatus });

  // Burst first, keyed on the account AND the address, like every contribution door.
  const ipHash = hashIp(clientIp(request));
  const burstKey = `kitchen-report:${reporter.actor}:${ipHash}`;
  if (await isLimited(burstKey, burstKey)) return rateLimited();

  let venueRaw: unknown;
  let stateRaw: unknown;
  try {
    const body = await boundedJson(request, JSON_BODY_MAX_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
    }
    venueRaw = (body as Record<string, unknown>).venueId;
    stateRaw = (body as Record<string, unknown>).state;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const state = parseKitchenState(stateRaw);
  if (!state) {
    return publicApiError("Say still serving or kitchen closed.", "INVALID_KITCHEN_REPORT", 400, {
      details: { field: "state" },
    });
  }
  const venueInput = typeof venueRaw === "string" ? venueRaw.trim() : "";
  if (!venueInput || venueInput.length > VENUE_ID_MAX) {
    return publicApiError("Pick a pub from the map.", "INVALID_KITCHEN_REPORT", 400, {
      details: { field: "venueId" },
    });
  }

  const actorKey = `kitchen-report-actor:${reporter.actor}`;
  if (await isLimited(actorKey, actorKey, ACTOR_HOURLY_LIMIT, HOUR_MS)) return rateLimited();

  const target = await resolveWritableVenueId(venueInput);
  if (!target.ok) return publicApiErrorFromStatus(target.error, target.status);

  try {
    const result = await kitchenReportsStore().tap({
      venueId: target.venueId,
      state,
      userId: reporter.accountId,
    });
    if (result.outcome === "own") {
      return publicApiError("Somebody else has to confirm it.", "OWN_KITCHEN_REPORT", 409);
    }
    if (result.outcome === "already") {
      return publicApiError("One other drinker has already confirmed this.", "ALREADY_CONFIRMED", 409);
    }
    return jsonNoStore(
      { outcome: result.outcome, report: await publicKitchenReport(result.report) },
      { status: 200 },
    );
  } catch (err) {
    log("error", "kitchen_report.tap_failed", {
      route: "POST /api/kitchen-reports",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

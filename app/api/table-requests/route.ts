// "Ask the pub for a table" (launch plan 1 Nov 2026, section 7 item 3).
//
//   POST { venueId, name, partySize, date, time, note?, contact: { kind, value } }
//        -> 201 { outcome: "sent" }       emailed to the pub's verified operator
//        -> 200 { outcome: "not_sent" }   PUBMAXX sent nothing; the sheet hands
//                                         the person the pub's own address
//   GET  ?venueId=<id>
//        -> 200 { status, requests }      the pub's verified operator alone
//
// WHO MAY ASK: a signed-in account with a claimed handle that has answered the
// age question as an adult, through the shared contribution gate
// (resolveContributionIdentity), exactly as every other social write asks. The
// requester comes from the SESSION, never the body. A request is a message to
// a real inbox, so every write is durably rate limited per account and address,
// the account's hourly budget fails CLOSED, and one pub has a budget of its
// own.
//
// WHAT IT NEVER DOES. It never charges anything, holds no table and takes no
// booking: a fee per seated group is a later decision under ADR 0011 and
// nothing here is built for it. It never echoes a contact: the answer names an
// outcome and nothing else, so neither the operator's address nor the
// person's own contact comes back. And it changes no rank, pin colour, price
// band or order (__tests__/tableRequestFence.test.ts).

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerAuthIdentity } from "@/lib/authServer";
import { boundedJson } from "@/lib/boundedRequest.server";
import {
  resolveContributionIdentity,
  type ContributionIdentityResolution,
} from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { deliverTableRequest } from "@/lib/tableRequestDelivery.server";
import { toOperatorTableRequest, validateTableRequest } from "@/lib/tableRequests";
import { tableRequestsStore } from "@/lib/tableRequestsStore";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { venueOperatorsStore } from "@/lib/venueOperatorsStore";

assertServerEnv();

export const runtime = "nodejs";

/** A crew asks a pub or two for one night. More than this in an hour is a script. */
const ACTOR_HOURLY_LIMIT = 4;
const ACTOR_DAILY_LIMIT = 10;
/** One pub's inbox, whoever is asking. */
const VENUE_HOURLY_LIMIT = 20;
const READ_LIMIT = 30;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const READ_WINDOW_MS = 60_000;
const JSON_BODY_MAX_BYTES = 2048;
const VENUE_ID_MAX = 120;

function rateLimited(): Response {
  return publicApiError("Too many table requests. Try again later.", "RATE_LIMITED", 429, {
    retryable: true,
  });
}

type Refusal = Extract<ContributionIdentityResolution, { ok: false }>;

/** The shared gate's refusal, in the house envelope, with its `status` for the gate dialog. */
function gateRefusal(refusal: Refusal): Response {
  const { body, httpStatus } = refusal;
  const code =
    body.code ??
    (body.status === "sign_in_required"
      ? "UNAUTHENTICATED"
      : body.status === "onboarding_required"
        ? "HANDLE_REQUIRED"
        : body.status === "adult_check_required" || body.status === "adult_check_failed"
          ? "ADULT_REQUIRED"
          : undefined);
  const options = {
    retryable: httpStatus >= 500,
    ...(body.status ? { compatibilityFields: { status: body.status } } : {}),
  };
  return code
    ? publicApiError(body.error, code, httpStatus, options)
    : publicApiErrorFromStatus(body.error, httpStatus, options);
}

/** The pub the request is for: a curated pub, by its canonical id, with its name. */
async function requestedPub(
  venueId: string,
): Promise<{ ok: true; venueId: string; name: string } | { ok: false; response: Response }> {
  const lookup = await lookupCanonicalVenue(venueId);
  if (lookup.status === "unavailable") {
    return {
      ok: false,
      response: publicApiError("The pub list is unavailable right now. Try again shortly.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      }),
    };
  }
  if (lookup.status !== "found" || lookup.venue.retired || !isPubVenueKind(lookup.venue.kind)) {
    return {
      ok: false,
      response: publicApiError("Pick a pub from the map.", "INVALID_TABLE_REQUEST", 400, {
        details: { field: "venueId" },
      }),
    };
  }
  return { ok: true, venueId: lookup.canonicalId, name: lookup.venue.name };
}

export async function POST(request: Request): Promise<Response> {
  const requester = await resolveContributionIdentity(request);
  if (!requester.ok) return gateRefusal(requester);

  // Burst first, keyed on the account AND the address, like every contribution door.
  const ipHash = hashIp(clientIp(request));
  const burstKey = `table-request:${requester.actor}:${ipHash}`;
  if (await isLimited(burstKey, burstKey)) return rateLimited();

  let body: Record<string, unknown>;
  try {
    const parsed = await boundedJson(request, JSON_BODY_MAX_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const validation = validateTableRequest(body, requester.accountId);
  if (!validation.ok) {
    return publicApiError(validation.error, "INVALID_TABLE_REQUEST", 400, {
      details: { field: validation.field },
    });
  }

  // A message to a real inbox: the account's budgets fail CLOSED, so a limiter
  // we cannot reach refuses rather than letting a script mail a pub.
  const hourKey = `table-request-actor-hour:${requester.actor}`;
  const dayKey = `table-request-actor-day:${requester.actor}`;
  if (
    (await isLimited(hourKey, hourKey, ACTOR_HOURLY_LIMIT, HOUR_MS, { failClosed: true })) ||
    (await isLimited(dayKey, dayKey, ACTOR_DAILY_LIMIT, DAY_MS, { failClosed: true }))
  ) {
    return rateLimited();
  }

  const pub = await requestedPub(validation.fields.venueId);
  if (!pub.ok) return pub.response;

  const venueKey = `table-request-venue:${pub.venueId}`;
  if (await isLimited(venueKey, venueKey, VENUE_HOURLY_LIMIT, HOUR_MS)) return rateLimited();

  const delivery = await deliverTableRequest({ ...validation.fields, venueId: pub.venueId }, pub.name);
  log("info", "table_request.answered", {
    route: "POST /api/table-requests",
    outcome: delivery.outcome,
    ...(delivery.outcome === "not_sent" ? { reason: delivery.reason } : {}),
  });
  return delivery.outcome === "sent"
    ? jsonNoStore({ outcome: "sent" }, { status: 201 })
    : jsonNoStore({ outcome: "not_sent" }, { status: 200 });
}

export async function GET(request: Request): Promise<Response> {
  const identity = await callerAuthIdentity(request);
  if (!identity) {
    return publicApiError("Sign in to see your pub's table requests.", "UNAUTHENTICATED", 401);
  }
  const readKey = `table-request-read:${identity.id}`;
  if (await isLimited(readKey, readKey, READ_LIMIT, READ_WINDOW_MS)) return rateLimited();

  const rawVenue = new URL(request.url).searchParams.get("venueId")?.trim() ?? "";
  if (!rawVenue || rawVenue.length > VENUE_ID_MAX) {
    return publicApiError("Ask for a pub.", "INVALID_REQUEST", 400);
  }
  const pub = await requestedPub(rawVenue);
  if (!pub.ok) return pub.response;

  // Only a VERIFIED operator of THIS pub reads its requests. A storage wobble
  // answers false, so it refuses rather than listing to anybody.
  if (!(await venueOperatorsStore().isVerifiedOperator(identity.id, pub.venueId))) {
    return publicApiError(
      "Only an approved operator of this pub can see its table requests.",
      "NOT_VERIFIED_OPERATOR",
      403,
    );
  }

  const read = await tableRequestsStore().listEmailedForVenue(pub.venueId);
  return jsonNoStore(
    { status: read.status, requests: read.requests.map(toOperatorTableRequest) },
    { status: 200 },
  );
}

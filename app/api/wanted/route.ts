// Wanted Wave A — private list + create / delete / fulfil.
//
//   GET                           → 200 { status, wanteds } (owner only)
//   GET ?open=1                   → 200 { status, wanteds } open only
//   POST { venueId, venueName, venueKind?, sourceUrl?, note?, rawPaste? }
//                                 → 201 { wanted }
//   POST { action: "pending", rawPaste, sourceUrl?, note? }
//                                 → 201 { wanted } (unresolvable paste)
//   POST { action: "fulfil", venueId }
//                                 → 200 { fulfilled: WantedDTO[] }
//   POST { action: "delete", id } → 200 { ok: true }
//   POST { action: "soft-plan", id }
//                                 → 200 { softPlan: { venueId, query } }
//   POST { action: "visibility", id, visibility }
//                                 → 200 { wanted }
//   GET ?scope=mutuals|crew&crewId=...
//                                 → shared rows after relationship checks
//
// Auth-gated via resolveContributionIdentity. Rate-limited. publicApiError
// envelope. Never returns another account's Wanteds. No viewer coordinates.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { followStore } from "@/lib/followStore";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { profileStore } from "@/lib/profileStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { cleanWantedVisibility, validateWantedCreate } from "@/lib/wanted";
import { fulfilWantedsAtVenue } from "@/lib/wantedFulfil.server";
import { createSocialCrewStore, SocialCrewStoreError } from "@/lib/socialCrewStore";
import { wantedStore } from "@/lib/wantedStore";

export const runtime = "nodejs";

const CREATE_WINDOW_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requireOwner(request: Request) {
  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return { ok: false as const, response: jsonNoStore(contributor.body, { status: contributor.httpStatus }) };
  }
  return { ok: true as const, contributor };
}

type WantedOwner = Extract<Awaited<ReturnType<typeof requireOwner>>, { ok: true }>;

function socialActorForOwner(owner: Awaited<ReturnType<typeof requireOwner>>) {
  if (!owner.ok) return null;
  const profileId = owner.contributor.actor.slice("profile:".length);
  if (!UUID_RE.test(profileId) || !UUID_RE.test(owner.contributor.accountId)) return null;
  return {
    accountId: owner.contributor.accountId,
    profileId,
    handle: owner.contributor.handle,
  };
}

async function crewMembership(
  owner: Awaited<ReturnType<typeof requireOwner>>,
  crewId: string,
): Promise<"member" | "not_member" | "unavailable"> {
  const actor = socialActorForOwner(owner);
  if (!actor || !UUID_RE.test(crewId)) return "not_member";
  try {
    const read = await createSocialCrewStore().read(crewId, actor);
    return read.kind === "member" ? "member" : "not_member";
  } catch (error) {
    return error instanceof SocialCrewStoreError && error.code === "UNAVAILABLE"
      ? "unavailable"
      : "not_member";
  }
}

async function verifyCrewForVisibility(
  owner: Awaited<ReturnType<typeof requireOwner>>,
  visibility: string,
): Promise<Response | null> {
  const crewId = visibility.slice("crew:".length);
  const membership = await crewMembership(owner, crewId);
  if (membership === "member") return null;
  if (membership === "unavailable") {
    return publicApiError("Crew access is unavailable right now.", "CREW_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return publicApiError("Join that Crew before sharing a Wanted place.", "CREW_ACCESS_REQUIRED", 403);
}

async function fulfilWantedAction(
  owner: WantedOwner,
  body: Record<string, unknown>,
): Promise<Response> {
  const venueId = readString(body.venueId);
  if (!venueId) return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  const fulfilled = await fulfilWantedsAtVenue(owner.contributor.actor, venueId);
  return jsonNoStore({ fulfilled }, { status: 200 });
}

async function deleteWantedAction(
  owner: WantedOwner,
  body: Record<string, unknown>,
): Promise<Response> {
  const id = readString(body.id);
  if (!id) return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  try {
    const done = await wantedStore().delete(owner.contributor.actor, id);
    return done
      ? jsonNoStore({ ok: true }, { status: 200 })
      : publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  } catch (err) {
    log("error", "wanteds.delete_failed", {
      route: "POST /api/wanted",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

async function softPlanWantedAction(
  owner: WantedOwner,
  body: Record<string, unknown>,
): Promise<Response> {
  const id = readString(body.id);
  if (!id) return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  try {
    const wanted = await wantedStore().getById(owner.contributor.actor, id);
    if (!wanted) return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
    if (!wanted.venueId || wanted.venueKind === "pending") {
      return publicApiError("Confirm a pub before adding it to Soft Plan.", "WANTED_PENDING", 409);
    }
    return jsonNoStore({
      softPlan: {
        venueId: wanted.venueId,
        query: `a night at ${wanted.venueName}`,
      },
    }, { status: 200 });
  } catch (err) {
    log("error", "wanteds.soft_plan_failed", {
      route: "POST /api/wanted",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}

async function changeWantedVisibilityAction(
  owner: WantedOwner,
  action: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const id = readString(body.id);
  if (!id) return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  const requestedVisibility = action === "crew"
    ? `crew:${readString(body.crewId)}`
    : readString(body.visibility);
  const visibility = cleanWantedVisibility(requestedVisibility);
  if (!visibility) {
    return publicApiError("Choose private, mutuals, or a Crew.", "INVALID_VISIBILITY", 400);
  }
  if (visibility.startsWith("crew:")) {
    const crewAccess = await verifyCrewForVisibility(owner, visibility);
    if (crewAccess) return crewAccess;
  }
  try {
    const wanted = await wantedStore().updateVisibility(owner.contributor.actor, id, visibility);
    return wanted
      ? jsonNoStore({ wanted }, { status: 200 })
      : publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  } catch (err) {
    log("error", "wanteds.visibility_failed", {
      route: "POST /api/wanted",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}

async function handleWantedAction(
  owner: WantedOwner,
  action: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  if (action === "fulfil") return fulfilWantedAction(owner, body);
  if (action === "delete") return deleteWantedAction(owner, body);
  if (action === "soft-plan") return softPlanWantedAction(owner, body);
  if (action === "crew" || action === "visibility") {
    return changeWantedVisibilityAction(owner, action, body);
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const params = new URL(request.url).searchParams;
  const scope = params.get("scope");
  const openOnly = params.get("open") === "1";
  try {
    if (!scope) {
      const result = openOnly
        ? await wantedStore().listOpenForOwner(owner.contributor.actor)
        : await wantedStore().listForOwner(owner.contributor.actor);
      return jsonNoStore(result, { status: 200 });
    }

    if (scope === "mutuals") {
      const mutualHandles = await followStore().listMutuals(owner.contributor.handle);
      const mutualProfiles = await Promise.all(
        mutualHandles.map((handle) => profileStore().getByHandle(handle)),
      );
      const ownerActors = mutualProfiles.flatMap((profile) =>
        profile?.id ? [`profile:${profile.id}`] : [],
      );
      const result = await wantedStore().listForMutualOwners(ownerActors);
      return jsonNoStore(result, { status: 200 });
    }

    if (scope === "crew") {
      const crewId = params.get("crewId") ?? "";
      if (!UUID_RE.test(crewId)) {
        return publicApiError("Choose a valid Crew.", "INVALID_CREW", 400);
      }
      const crewAccess = await crewMembership(owner, crewId);
      if (crewAccess === "unavailable") {
        return publicApiError("Crew access is unavailable right now.", "CREW_UNAVAILABLE", 503, {
          retryable: true,
        });
      }
      if (crewAccess !== "member") {
        return publicApiError("Join that Crew before viewing its Wanted places.", "CREW_ACCESS_REQUIRED", 403);
      }
      const result = await wantedStore().listForCrew(crewId);
      return jsonNoStore(result, { status: 200 });
    }

    return publicApiError("Wanted scope is not valid.", "INVALID_SCOPE", 400);
  } catch (err) {
    log("error", "wanteds.list_failed", {
      route: "GET /api/wanted",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const ipHash = hashIp(clientIp(request));
  const key = `wanted:${owner.contributor.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, CREATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const action = readString(body.action) ?? "";

  const actionResponse = await handleWantedAction(owner, action, body);
  if (actionResponse) return actionResponse;

  const pending = action === "pending";
  const result = validateWantedCreate({
    ownerActor: owner.contributor.actor,
    venueKind: pending ? "pending" : body.venueKind,
    venueId: pending ? "" : body.venueId,
    venueName: pending ? "" : body.venueName,
    sourceUrl: body.sourceUrl,
    note: body.note,
    rawPaste: body.rawPaste ?? body.paste,
    drinkInterest: body.drinkInterest,
    visibility: body.visibility,
  });
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_WANTED", 400);
  }

  if (result.value.visibility.startsWith("crew:")) {
    const crewAccess = await verifyCrewForVisibility(owner, result.value.visibility);
    if (crewAccess) return crewAccess;
  }

  try {
    const wanted = await wantedStore().create(result.value);
    return jsonNoStore({ wanted }, { status: 201 });
  } catch (err) {
    log("error", "wanteds.create_failed", {
      route: "POST /api/wanted",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

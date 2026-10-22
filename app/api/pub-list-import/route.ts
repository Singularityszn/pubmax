import { randomUUID } from "node:crypto";

import { z } from "zod";

import { authUnavailableError, publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import { getCity } from "@/lib/cities";
import { readCityVenueIndex } from "@/lib/venueIndex";
import { selectPubListCluster } from "@/lib/pubListImportCluster";
import { pubStreetWalkKm } from "@/lib/pubWalkPairs.server";
import { getPubListNightDraft, listPubListNightDrafts, savePubListNightDraft } from "@/lib/pubListImportDraftStore.server";
import { importPubList, importedVenuesById, sourceAttribution } from "@/lib/pubListImport.server";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

const textInputSchema = z.object({
  text: z.string().max(4000).refine((text) => text.trim().length > 0),
  sourceUrl: z.string().max(2048).optional(),
}).strict();

const venueIds = z.array(z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/)).min(1).max(40)
  .refine((ids) => new Set(ids).size === ids.length);
const inputSchema = z.union([
  textInputSchema,
  z.object({ action: z.literal("cluster"), venueIds }).strict(),
  z.object({ action: z.literal("save"), importId: z.uuid(), venueIds, sourceUrl: z.string().max(2048).optional() }).strict(),
  z.object({ action: z.literal("resume"), importId: z.uuid() }).strict(),
]);

export async function POST(request: Request): Promise<Response> {
  const ipKey = `pub-list-import:ip:${hashIp(clientIp(request))}`;
  if (await isLimited(ipKey, ipKey, 30, 60_000, { failClosed: true })) {
    return publicApiError("Too many imports. Try again in a minute.", "RATE_LIMITED", 429, { retryable: true });
  }

  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") return authUnavailableError();
  if (verification.status !== "verified") {
    return publicApiError("Sign in to import a pub list.", "UNAUTHENTICATED", 401);
  }
  const userKey = `pub-list-import:user:${hashActor(verification.identity.id)}`;
  if (await isLimited(userKey, userKey, 10, 60_000, { failClosed: true })) {
    return publicApiError("Too many imports. Try again in a minute.", "RATE_LIMITED", 429, { retryable: true });
  }

  let body: unknown;
  try {
    body = await boundedJson(request, 48_000);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return publicApiError("The pasted list is too large.", "PAYLOAD_TOO_LARGE", 413);
    }
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const input = inputSchema.safeParse(body);
  if (!input.success) {
    return publicApiError("Paste up to 4,000 characters and an optional source link.", "INVALID_REQUEST", 400);
  }

  try {
    if ("action" in input.data) {
      const action = input.data;
      if (action.action === "resume") {
        const saved = await getPubListNightDraft(verification.identity.id, action.importId);
        if (!saved) return publicApiError("That night draft is unavailable.", "NOT_FOUND", 404);
        const venues = await importedVenuesById(saved.venueIds);
        return jsonNoStore({ restored: true, importId: saved.id, source: saved.source, truncated: false,
          items: venues.map((venue) => ({ rawLine: venue.name, name: venue.name, areaHint: venue.area,
            state: venue.closed ? "closed" : "matched", venue })),
          missingCount: saved.venueIds.length - venues.length });
      }
      const venues = await importedVenuesById(action.venueIds);
      if (venues.length !== action.venueIds.length) {
        return publicApiError("Some pubs are no longer listed. Match the list again.", "IMPORT_VENUES_INVALID", 422);
      }
      if (action.action === "save") {
        const draft = await savePubListNightDraft(verification.identity.id, {
          id: action.importId, venueIds: action.venueIds, source: sourceAttribution(action.sourceUrl),
        });
        return jsonNoStore({ draft });
      }
      const index = await readCityVenueIndex(getCity("london"));
      if (!index?.size) throw new Error("Pub catalogue unavailable.");
      const located = venues.flatMap((venue) => {
        const record = index.get(venue.id)?.venue;
        return venue.layer === "curated" && !venue.closed && record
          ? [{ id: venue.id, lat: record.lat, lng: record.lng }] : [];
      });
      const cluster = selectPubListCluster(located, pubStreetWalkKm);
      const first = located.find((venue) => venue.id === cluster.venueIds[0]);
      const area = first ? nearestNightAreaForViewport("london", [first.lng, first.lat]) : null;
      return jsonNoStore({ ...cluster, nightArea: area?.slug ?? null });
    }
    const result = await importPubList(input.data);
    return jsonNoStore({ importId: randomUUID(), ...result });
  } catch (error) {
    if (error instanceof RangeError) return publicApiError(error.message, "INVALID_REQUEST", 400);
    return publicApiError("The import is unavailable. Try again.", "IMPORT_UNAVAILABLE", 503, { retryable: true });
  }
}

export async function GET(request: Request): Promise<Response> {
  const key = `pub-list-drafts:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, 30, 60_000, { failClosed: true })) {
    return publicApiError("Too many requests. Try again in a minute.", "RATE_LIMITED", 429, { retryable: true });
  }
  const auth = await verifyCallerAuth(request);
  if (auth.status === "unavailable") return authUnavailableError();
  if (auth.status !== "verified") return publicApiError("Sign in to see your night drafts.", "UNAUTHENTICATED", 401);
  try {
    return jsonNoStore({ drafts: await listPubListNightDrafts(auth.identity.id) });
  } catch {
    return publicApiError("Your night drafts are unavailable. Try again.", "IMPORT_UNAVAILABLE", 503, { retryable: true });
  }
}

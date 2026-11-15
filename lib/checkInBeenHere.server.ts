import "server-only";

import { BEEN_HERE_LIST } from "@/lib/beenHere";
import { isNearbyVisit } from "@/lib/nearbyVisit";
import { nearbyVisitStore } from "@/lib/nearbyVisitStore";
import { profileStore } from "@/lib/profileStore";
import { savedPubsStore } from "@/lib/savedPubsStore";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { resolveVenue } from "@/lib/venueIndex";

export async function checkInBeenHere(userId: string, handle: string, venueId: unknown, location: unknown) {
  if (!userId) return { ok: false, status: 401, error: "Sign in to check in nearby." } as const;
  const aliases = await loadVenueAliasResolver();
  if (aliases.status === "unavailable") throw new Error("Venue aliases unavailable");
  const id = typeof venueId === "string" ? aliases.canonical(venueId) : "";
  const venue = id ? await resolveVenue(id) : null;
  if (!venue || (venue.kind && venue.kind !== "pub") || !isNearbyVisit(location, venue)) {
    return { ok: false, status: 400, error: "We couldn't place you close enough to this pub. Try again outside." } as const;
  }
  const profile = await profileStore().getByHandle(handle);
  if (!profile || profile.userId !== userId) throw new Error("Profile ownership unavailable");
  const saved = await savedPubsStore().ensureSaved({ profileId: profile.id, handle, venueId: id, listType: BEEN_HERE_LIST });
  if (saved.outcome === "unavailable") throw new Error("Saved lists unavailable");
  await nearbyVisitStore().record(userId, id);
  return { ok: true } as const;
}

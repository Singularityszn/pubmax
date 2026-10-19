// Pals walk together: what a crew member may learn about another member's Pub
// Pal, and how the map reads it. GET /api/plans/[id]/pals answers a caller
// who holds that plan's member capability with the Pals of the OTHER members
// who chose "Show my Pal to my crew" (pub_pals.crew_visible, migration 0194)
// and did not hide their Pal. It names the Pal, never its owner: no account
// id, no crew seat id and no handle leaves the server.

import { compatiblePalSpecies, type PubPal } from "@/lib/pubPal";

/** The most crew Pals the map draws beside the reader's own. */
export const CREW_PALS_MAX = 5;

export type CrewPal = Pick<PubPal, "id" | "name" | "personality" | "muted"> & {
  species: PubPal["appearance"]["species"];
};

/** The share-safe shape of one crew Pal, from a stored Pal. */
export function crewPalFrom(pal: PubPal): CrewPal {
  return { id: pal.id, name: pal.name, species: pal.appearance.species, personality: pal.personality, muted: pal.muted };
}

/** The crew Pals in a route's answer, dropping anything malformed. */
export function crewPalsFromBody(body: unknown): CrewPal[] {
  if (!body || typeof body !== "object") return [];
  const { visibility, pals } = body as { visibility?: unknown; pals?: unknown };
  if (visibility !== "member" || !Array.isArray(pals)) return [];
  const out: CrewPal[] = [];
  for (const raw of pals) {
    if (!raw || typeof raw !== "object") continue;
    const value = raw as Record<string, unknown>;
    const species = compatiblePalSpecies(value.species);
    if (typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name.trim() || !species) continue;
    if (!value.personality || typeof value.personality !== "object") continue;
    out.push({
      id: value.id,
      name: value.name.trim(),
      species,
      personality: value.personality as CrewPal["personality"],
      muted: value.muted === true,
    });
    if (out.length === CREW_PALS_MAX) break;
  }
  return out;
}

/** A crew Pal as the map marker draws a Pal: its look, and nothing more. */
export function crewPalLook(pal: CrewPal): { id: string; personality: CrewPal["personality"]; muted: boolean; appearance: { species: CrewPal["species"] } } {
  return { id: pal.id, personality: pal.personality, muted: pal.muted, appearance: { species: pal.species } };
}

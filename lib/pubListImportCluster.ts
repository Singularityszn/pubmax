import { haversineKm } from "@/lib/haversine";

type LocatedPub = { id: string; lat: number; lng: number };

/** A bounded path search with the planner's 1.6 km leg and 3 km total limits. */
export function selectPubListCluster(
  input: readonly LocatedPub[],
  streetWalkKm: (from: string, to: string) => number | null,
): { venueIds: string[]; remainingIds: string[]; distanceBasis: "street-walk" | "straight-line-estimate" } {
  const pubs = [...new Map(input.map((pub) => [pub.id, pub])).values()].slice(0, 40);
  const edges = pubs.map((a) => pubs.map((b) => {
    const street = streetWalkKm(a.id, b.id);
    return { km: street ?? haversineKm([a.lng, a.lat], [b.lng, b.lat]), estimated: street === null };
  }));
  type Path = { indices: number[]; mask: bigint; km: number; estimated: boolean };
  let paths: Path[] = pubs.map((_, i) => ({ indices: [i], mask: BigInt(1) << BigInt(i), km: 0, estimated: false }));
  let best: Path | null = null;
  const compare = (a: Path, b: Path) => {
    if (a.km !== b.km) return a.km - b.km;
    for (let i = 0; i < a.indices.length; i++) {
      if (a.indices[i] !== b.indices[i]) return a.indices[i]! - b.indices[i]!;
    }
    return 0;
  };
  for (let size = 2; size <= 6; size++) {
    const next = new Map<string, Path>();
    for (const path of paths) {
      for (let i = 0; i < pubs.length; i++) {
        const bit = BigInt(1) << BigInt(i);
        if (path.mask & bit) continue;
        const edge = edges[path.indices.at(-1)!]![i]!;
        if (edge.km > 1.6 || path.km + edge.km > 3) continue;
        const extended = { indices: [...path.indices, i], mask: path.mask | bit, km: path.km + edge.km, estimated: path.estimated || edge.estimated };
        const key = `${extended.indices[0]}:${extended.mask}:${i}`;
        const held = next.get(key);
        if (!held || compare(extended, held) < 0) next.set(key, extended);
      }
    }
    // Preserve each starting pub so a small, tight group cannot erase a larger distant group.
    const perStart = new Map<number, number>();
    paths = [...next.values()].sort(compare).filter((path) => {
      const start = path.indices[0]!;
      const count = perStart.get(start) ?? 0;
      perStart.set(start, count + 1);
      return count < 32;
    });
    if (!paths.length) break;
    if (size >= 3) best = paths[0]!;
  }
  const venueIds = best?.indices.map((i) => pubs[i]!.id) ?? [];
  return {
    venueIds,
    remainingIds: pubs.filter(({ id }) => !venueIds.includes(id)).map(({ id }) => id),
    distanceBasis: best && !best.estimated ? "street-walk" : "straight-line-estimate",
  };
}

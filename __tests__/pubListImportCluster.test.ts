import { describe, expect, it } from "vitest";
import { selectPubListCluster } from "@/lib/pubListImportCluster";

const pub = (id: string, lng: number) => ({ id, lat: 51.51, lng });

describe("an imported list's crawl selection", () => {
  it("takes the larger walkable group, excludes duplicates and retains the rest", () => {
    const pubs = [pub("distant", -0.4), pub("a", -0.13), pub("b", -0.129), pub("c", -0.128), pub("d", -0.127)];
    const result = selectPubListCluster([...pubs, pubs[1]!], () => null);
    expect(result.venueIds).toHaveLength(4);
    expect(new Set(result.venueIds)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(result.remainingIds).toEqual(["distant"]);
    expect(result.distanceBasis).toBe("straight-line-estimate");
  });

  it("uses street distances and refuses a group separated by a long crossing", () => {
    const result = selectPubListCluster([pub("a", -0.13), pub("b", -0.129), pub("c", -0.128)], () => 2);
    expect(result.venueIds).toEqual([]);
    expect(result.remainingIds).toEqual(["a", "b", "c"]);
  });

  it("caps a dense list at six and gives a stable answer", () => {
    const pubs = Array.from({ length: 40 }, (_, n) => pub(`pub-${n}`, -0.13 + n * 0.00001));
    expect(selectPubListCluster(pubs, () => 0.1).venueIds).toEqual(pubs.slice(0, 6).map(({ id }) => id));
  });
});

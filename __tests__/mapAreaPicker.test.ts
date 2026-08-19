import { describe, expect, it } from "vitest";

import type { Locality } from "@/lib/localities";
import {
  filterChooseAreaNeighbourhoods,
  otherCityRows,
  type ChooseAreaNeighbourhood,
} from "@/lib/mapAreaPicker";

const CAMDEN: ChooseAreaNeighbourhood = {
  slug: "camden",
  name: "Camden",
  pubCount: 42,
  center: [-0.143, 51.539],
};

const SHOREDITCH: ChooseAreaNeighbourhood = {
  slug: "shoreditch",
  name: "Shoreditch",
  pubCount: 30,
  center: [-0.078, 51.526],
};

function locality(name: string, borough: string): Locality {
  return { name, borough, lat: 51.5, lng: -0.1 };
}

describe("filterChooseAreaNeighbourhoods", () => {
  it("returns every row for an empty query", () => {
    expect(filterChooseAreaNeighbourhoods([CAMDEN, SHOREDITCH], "  ")).toEqual([
      CAMDEN,
      SHOREDITCH,
    ]);
  });

  it("matches a night area by name, case-insensitively", () => {
    expect(
      filterChooseAreaNeighbourhoods([CAMDEN, SHOREDITCH], "shore"),
    ).toEqual([SHOREDITCH]);
  });

  it("adds gazetteer rows matched by name or borough", () => {
    const rows = filterChooseAreaNeighbourhoods(
      [CAMDEN, SHOREDITCH],
      "willesden",
      [locality("Willesden", "Brent"), locality("Peckham", "Southwark")],
    );
    expect(rows.map((row) => row.name)).toEqual(["Willesden"]);
    expect(rows[0]).toMatchObject({ slug: "locality:willesden", pubCount: 0 });
  });

  it("never prints two rows a reader cannot tell apart", () => {
    // A gazetteer entry sharing a night area's name is the collision: the two
    // rows carry different slugs by construction (`locality:` prefix), so only
    // the visible name can decide, and the counted night area wins.
    const rows = filterChooseAreaNeighbourhoods([CAMDEN, SHOREDITCH], "camden", [
      locality("Camden", "Camden"),
    ]);
    expect(rows).toEqual([CAMDEN]);
  });

  it("keeps a gazetteer row whose name differs only by case out too", () => {
    const rows = filterChooseAreaNeighbourhoods([CAMDEN], "camden", [
      locality("camden", "Camden"),
    ]);
    expect(rows).toEqual([CAMDEN]);
  });
});

describe("otherCityRows", () => {
  it("never offers the city the reader is already in", () => {
    const rows = otherCityRows("london");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.cityId)).not.toContain("london");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");

function functionBody(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Could not find ${start}`);
  return source.slice(from, to);
}

describe("map search selection", () => {
  it("clears the text filter when an area result is picked", () => {
    const areaSelection = functionBody(
      "const selectSearchArea = useCallback(",
      "const selectVenueFromSearch = useCallback(",
    );

    expect(areaSelection).toContain(
      'setFilters((current) => ({ ...current, query: "" }));',
    );
  });

  it("clears the text filter when a curated place result is picked", () => {
    const placeSelection = functionBody(
      "const selectPlaceFromSearch = useCallback(",
      "const selectCityFromSearch = useCallback(",
    );

    expect(placeSelection).toContain(
      'setFilters((current) => ({ ...current, query: "" }));',
    );
  });
});

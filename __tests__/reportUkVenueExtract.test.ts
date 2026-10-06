// The UK venue extraction report is generated markdown, so a taxonomy note that
// carries a pipe must not split its table row into extra columns, and a
// placeholder in angle brackets must not render as an HTML tag.

import { describe, expect, it } from "vitest";

import { markdownCell } from "../scripts/report_uk_venue_extract.mjs";
import { UK_VENUE_TAXONOMY } from "../scripts/lib/ukOsmVenueSeed.mjs";

describe("UK venue extract report", () => {
  it("escapes the pipes and angle brackets in a table cell", () => {
    expect(markdownCell("alcohol=yes|served")).toBe("alcohol=yes\\|served");
    expect(markdownCell("drink=<alcoholic name>")).toBe("drink=&lt;alcoholic name&gt;");
    expect(markdownCell("amenity=bar")).toBe("amenity=bar");
  });

  it("keeps every taxonomy note inside one cell", () => {
    for (const row of UK_VENUE_TAXONOMY) {
      expect(markdownCell(row.note)).not.toMatch(/(^|[^\\])\|/);
    }
  });
});

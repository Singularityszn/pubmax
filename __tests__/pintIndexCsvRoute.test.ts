import { describe, it, expect } from "vitest";

import { GET } from "@/app/pint-index/data.csv/route";
import { LEAGUE_CSV_HEADER } from "@/lib/pintIndex";

// Exercises the real route handler end-to-end: it reads the bundled pint
// dataset (public/data/pint_prices_app_dataset.json, present in the repo) and
// serialises the league table to CSV. Asserts the response shape + headers and
// that the body parses as the expected CSV, without pinning volatile prices.
describe("GET /pint-index/data.csv", () => {
  it("returns a downloadable text/csv attachment", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="london-pint-index.csv"',
    );
    expect(res.headers.get("cache-control")).toContain("s-maxage");
  });

  it("emits the header row and one line per borough", async () => {
    const res = await GET();
    const body = await res.text();
    const lines = body.trimEnd().split("\r\n");
    expect(lines[0]).toBe(LEAGUE_CSV_HEADER.join(","));
    // The real dataset has many boroughs — there is at least a header + rows.
    expect(lines.length).toBeGreaterThan(1);
    // Every data row has exactly the header's column count.
    const cols = LEAGUE_CSV_HEADER.length;
    for (const line of lines.slice(1)) {
      // Quoted commas are possible, so count via a tolerant split on unquoted
      // commas: a simple field-count check for the common (unquoted) rows.
      if (!line.includes('"')) {
        expect(line.split(",")).toHaveLength(cols);
      }
    }
  });
});

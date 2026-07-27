import { describe, it, expect } from "vitest";

import { GET } from "@/app/pint-index/[month]/data.csv/route";
import { LEAGUE_CSV_HEADER } from "@/lib/pintIndex";
import { listPintIndexArchiveMonths } from "@/lib/pintIndexSnapshot.server";

const request = new Request("https://pubmaxxing.com/pint-index/2026-06/data.csv");
const params = (month: string) => ({ params: Promise.resolve({ month }) });

describe("GET /pint-index/[month]/data.csv", () => {
  it("serves a published month as a named, hard-cacheable download", async () => {
    const [month] = await listPintIndexArchiveMonths();
    expect(month, "at least one dated edition is published").toBeTruthy();

    const res = await GET(request, params(month));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(`filename="london-pint-index-${month}.csv"`);
    // A frozen month never changes, so the CSV may be cached as immutable.
    expect(res.headers.get("cache-control")).toContain("immutable");

    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe(LEAGUE_CSV_HEADER.join(","));
  });

  it("404s an unpublished or malformed month rather than inventing one", async () => {
    expect((await GET(request, params("1999-01"))).status).toBe(404);
    expect((await GET(request, params("2026-13"))).status).toBe(404);
    expect((await GET(request, params("../../etc/passwd"))).status).toBe(404);
  });
});

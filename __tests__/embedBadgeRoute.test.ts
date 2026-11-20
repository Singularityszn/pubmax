import { beforeEach, describe, expect, it, vi } from "vitest";

const readBadge = vi.hoisted(() => vi.fn());
vi.mock("@/lib/embedBadge.server", () => ({ readBadge }));

import { GET } from "@/app/api/badge/[kind]/[id]/route";

const request = new Request("https://pubmaxxing.com/api/badge/area/camden");
const context = (kind: string, id: string) => ({ params: Promise.resolve({ kind, id }) });

describe("embed badge route", () => {
  beforeEach(() => readBadge.mockReset());

  it("returns a cacheable image with the dated source and escaped venue name", async () => {
    readBadge.mockResolvedValue({ title: "Cheapest pint in Camden", pubName: "The <Crown>", priceGbp: 4.5, publisher: "Pint Prices", observedOn: "2026-11-09" });
    const response = await GET(request, context("area", "camden"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    const image = await response.text();
    expect(image).toContain("£4.50");
    expect(image).toContain("Pint Prices");
    expect(image).toContain("9 Nov 2026");
    expect(image).toContain("The &lt;Crown&gt;");
  });

  it("does not cache a missing or unavailable price", async () => {
    readBadge.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("unavailable"));
    const missing = await GET(request, context("venue", "missing"));
    const unavailable = await GET(request, context("venue", "missing"));
    expect(missing.status).toBe(404);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toContain("no-store");
  });
});

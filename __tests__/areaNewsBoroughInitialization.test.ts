import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/boroughs");
  vi.resetModules();
});

it("loads venue news when the borough helper export is unavailable, preserving canonical London names and rejecting non-London boroughs", async () => {
  vi.resetModules();
  vi.doMock("@/lib/boroughs", async (original) => ({
    ...await original<typeof import("@/lib/boroughs")>(), LONDON_BOROUGHS: undefined,
  }));
  const news = await import("@/lib/areaNews");
  expect(news.resolveAreaBorough("manchester")).toBeNull();
  expect(news.resolveAreaBorough("manchester-city-centre")).toBeNull();
  expect(news.resolveAreaBorough("camden")).toBe("camden");
  expect(news.areaLabel("city-of-london")).toBe("City of London");
});

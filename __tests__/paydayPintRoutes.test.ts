import { afterEach, expect, it, vi } from "vitest";
const unsubscribe = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/paydayPintStore", () => ({ paydayPintStore: () => ({ unsubscribe }) }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));
vi.mock("@/lib/supabase", () => ({ clientIp: () => "127.0.0.1", hashIp: () => "test" }));
vi.mock("@/lib/paydayPintData.server", () => ({
  paydayStations: async () => [{ name: "Bank", lat: 51.5, lng: -0.1 }],
  paydayVenues: async () => [{ id: "near", name: "Nearby", lat: 51.5, lng: -0.1, fairPint: [450, "https://example.test/price", "2026-11-01"] }],
}));
import { GET, POST } from "@/app/api/payday-pint/unsubscribe/route";
import { POST as subscribe } from "@/app/api/payday-pint/subscribe/route";
import { GET as preview } from "@/app/api/payday-pint/preview/route";

afterEach(() => { vi.unstubAllEnvs(); unsubscribe.mockClear(); });
it("keeps unsubscribe GET read-only and accepts the one-click POST while the feature is disabled", async () => {
  vi.stubEnv("PAYDAY_PINT_ENABLED", "0");
  const url = `https://example.test/api/payday-pint/unsubscribe?token=${"a".repeat(43)}`;
  expect((await GET(new Request(url))).status).toBe(200);
  expect(unsubscribe).not.toHaveBeenCalled();
  const response = await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  expect(response.status).toBe(200);
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it("refuses signup when delivery is held", async () => {
  vi.stubEnv("PAYDAY_PINT_ENABLED", "1");
  vi.stubEnv("PAYDAY_PINT_DELIVERY_ENABLED", "0");
  const response = await subscribe(new Request("https://example.test/api/payday-pint/subscribe", { method: "POST", body: "{}" }));
  expect(response.status).toBe(503);
});

it.each(["", "?station=", "?station=bank", "?station=Unknown"])("requires an exact station for the preview: %s", async (query) => {
  vi.stubEnv("PAYDAY_PINT_PREVIEW", "1");
  expect((await preview(new Request(`https://example.test/api/payday-pint/preview${query}`))).status).toBe(404);
});

it("renders the selected station's prices only when preview is enabled", async () => {
  const request = new Request("https://example.test/api/payday-pint/preview?station=Bank");
  vi.stubEnv("PAYDAY_PINT_PREVIEW", "0");
  expect((await preview(request)).status).toBe(404);
  vi.stubEnv("PAYDAY_PINT_PREVIEW", "1");
  const response = await preview(request);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("£4.50");
});

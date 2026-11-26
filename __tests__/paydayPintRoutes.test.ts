import { afterEach, beforeEach, expect, it, vi } from "vitest";
const unsubscribe = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/paydayPintStore", () => ({ paydayPintStore: () => ({ unsubscribe }) }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));
vi.mock("@/lib/supabase", () => ({ clientIp: () => "127.0.0.1", hashIp: () => "test", hashActor: (value: string) => `hash:${value}` }));
const requestPaydayPint = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/paydayPintSignup.server", () => ({ requestPaydayPint }));
vi.mock("@/lib/paydayPintData.server", () => ({
  paydayStations: async () => [{ name: "Bank", lat: 51.5, lng: -0.1 }, { name: "Far Station", lat: 52, lng: -0.1 }],
  paydayVenues: async () => [{ id: "near", name: "Nearby", lat: 51.5, lng: -0.1, fairPint: [450, "https://example.test/price", "2026-11-01"] }],
}));
import { GET, POST } from "@/app/api/payday-pint/unsubscribe/route";
import { POST as subscribe } from "@/app/api/payday-pint/subscribe/route";
import { GET as preview } from "@/app/api/payday-pint/preview/route";
import { isLimited } from "@/lib/pintDrops";

beforeEach(() => { vi.setSystemTime(new Date("2026-11-20T09:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); unsubscribe.mockClear(); });
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

it("accepts signup only for a station with a sourced pint price within 1 km", async () => {
  vi.stubEnv("PAYDAY_PINT_ENABLED", "1");
  vi.stubEnv("PAYDAY_PINT_DELIVERY_ENABLED", "1");
  vi.stubEnv("PAYDAY_PINT_POSTAL_ADDRESS", "Example sender");
  vi.stubEnv("RESEND_API_KEY", "test-only");
  vi.stubEnv("EMAIL_FROM", "sender@example.test");
  const signup = (station: string) => subscribe(new Request("https://example.test/api/payday-pint/subscribe", { method: "POST", body: JSON.stringify({ email: "person@example.test", station, adult: true, consent: true }) }));
  expect((await signup("Far Station")).status).toBe(400);
  expect(requestPaydayPint).not.toHaveBeenCalled();
  expect((await signup("Bank")).status).toBe(200);
  expect(requestPaydayPint).toHaveBeenCalledWith("person@example.test", "Bank");
});

it("refuses a confirmation request when the recipient budget is spent", async () => {
  vi.stubEnv("PAYDAY_PINT_ENABLED", "1");
  vi.stubEnv("PAYDAY_PINT_DELIVERY_ENABLED", "1");
  vi.stubEnv("PAYDAY_PINT_POSTAL_ADDRESS", "Example sender");
  vi.stubEnv("RESEND_API_KEY", "fake");
  vi.stubEnv("EMAIL_FROM", "sender@example.test");
  vi.mocked(isLimited).mockImplementation(async (key) => key.startsWith("payday-pint:recipient:"));
  requestPaydayPint.mockClear();
  const response = await subscribe(new Request("https://example.test/api/payday-pint/subscribe", { method: "POST", body: JSON.stringify({ email: "person@example.test", station: "Bank", adult: true, consent: true }) }));
  expect(response.status).toBe(429);
  expect(requestPaydayPint).not.toHaveBeenCalled();
  vi.mocked(isLimited).mockReset().mockResolvedValue(false);
});

it("bounds the signup body before processing it", async () => {
  vi.stubEnv("PAYDAY_PINT_ENABLED", "1");
  vi.stubEnv("PAYDAY_PINT_DELIVERY_ENABLED", "1");
  vi.stubEnv("PAYDAY_PINT_POSTAL_ADDRESS", "Example sender");
  vi.stubEnv("RESEND_API_KEY", "fake");
  vi.stubEnv("EMAIL_FROM", "sender@example.test");
  const response = await subscribe(new Request("https://example.test/api/payday-pint/subscribe", { method: "POST", body: JSON.stringify({ email: "x".repeat(70_000) }) }));
  expect(response.status).toBe(413);
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

it("omits expired prices from the preview at the current time", async () => {
  vi.stubEnv("PAYDAY_PINT_PREVIEW", "1");
  vi.setSystemTime(new Date("2027-11-05T09:00:00Z"));
  const response = await preview(new Request("https://example.test/api/payday-pint/preview?station=Bank"));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).not.toContain("£4.50");
  expect(html).toContain("could not find a sourced pint price");
});

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/contributionIdentity.server", () => ({ resolveContributionIdentity: vi.fn() }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));

import { GET, POST } from "@/app/api/price-alert/route";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { __resetPriceAlertStore } from "@/lib/priceAlertStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const token = encodeWebPushSubscription({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/test", expirationTime: null, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } })!;
const request = (body: object) => new Request("http://localhost/api/price-alert", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  __resetPriceAlertStore();
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: true, accountId: "account-a", actor: "profile:a", handle: "test" });
});

it("saves and removes an alert without returning its subscription secret", async () => {
  expect((await POST(request({ area: "camden", thresholdPence: 500, token }))).status).toBe(200);
  const read = await GET(new Request("http://localhost/api/price-alert"));
  expect(await read.json()).toEqual({ enabled: true, area: "camden", thresholdPence: 500 });
  expect((await POST(request({ enabled: false }))).status).toBe(200);
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toEqual({ enabled: false });
});

it("refuses invalid preferences and unauthenticated writes", async () => {
  expect((await POST(request({ area: "unknown", thresholdPence: 500, token }))).status).toBe(400);
  expect((await POST(request({ area: "camden", thresholdPence: 0, token }))).status).toBe(400);
  expect((await POST(request({ area: "camden", thresholdPence: 500, token: "bad" }))).status).toBe(400);
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: false, body: { error: "Sign in" }, httpStatus: 401 });
  expect((await POST(request({ enabled: false }))).status).toBe(401);
});

it("does not expose or remove another account's alert", async () => {
  await POST(request({ area: "camden", thresholdPence: 500, token }));
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: true, accountId: "account-b", actor: "profile:b", handle: "other" });
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toEqual({ enabled: false });
  await POST(request({ enabled: false, accountId: "account-a" }));
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: true, accountId: "account-a", actor: "profile:a", handle: "test" });
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toMatchObject({ enabled: true, area: "camden" });
});

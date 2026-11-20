import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/contributionIdentity.server", () => ({ resolveContributionIdentity: vi.fn() }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));

import { GET, POST } from "@/app/api/price-alert/route";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { __resetPriceAlertStore, priceAlertStore } from "@/lib/priceAlertStore";
import { dispatchPriceAlert } from "@/lib/priceAlertDispatch.server";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const token = encodeWebPushSubscription({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/test", expirationTime: null, keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } })!;
const request = (body: object) => new Request("http://localhost/api/price-alert", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  __resetPriceAlertStore();
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: true, accountId: "account-a", actor: "profile:a", handle: "test" });
});

it("delivers a Peckham pint 89 metres from the person, not Camden 9 km away", async () => {
  const location = { lat: 51.473, lng: -0.069 };
  expect((await POST(request({ ...location, thresholdPence: 500, token }))).status).toBe(200);
  const send = vi.fn();
  const store = priceAlertStore();
  const delivery = { list: store.list, claim: async () => true, send };
  const event = { id: "nearby", venueId: "venue-1fabngq", venueName: "The Kentish Drovers", pricePence: 420, lat: 51.4735, lng: -0.070012, observedAt: "2026-11-20T12:00:00Z", sourceLabel: "Pint Drop", visibility: "public", status: "visible", measure: "pint" };
  await dispatchPriceAlert(event, delivery, event.observedAt);
  await dispatchPriceAlert({ ...event, id: "distant", venueId: "venue-17u2i1w", venueName: "The Ice Wharf", pricePence: 425, lat: 51.5404, lng: -0.145649 }, delivery, event.observedAt);
  expect(send.mock.calls.map(([, payload]) => payload.url)).toEqual(["/map?sel=venue-1fabngq"]);
});

it("saves and removes an alert without returning its subscription secret", async () => {
  expect((await POST(request({ lat: 51.539, lng: -0.143, thresholdPence: 500, token }))).status).toBe(200);
  const read = await GET(new Request("http://localhost/api/price-alert"));
  expect(await read.json()).toEqual({ enabled: true, thresholdPence: 500 });
  expect((await POST(request({ enabled: false }))).status).toBe(200);
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toEqual({ enabled: false });
});

it("refuses invalid preferences and unauthenticated writes", async () => {
  expect((await POST(request({ lat: 91, lng: -0.143, thresholdPence: 500, token }))).status).toBe(400);
  expect((await POST(request({ lat: 51.539, lng: -0.143, thresholdPence: 0, token }))).status).toBe(400);
  expect((await POST(request({ lat: 51.539, lng: -0.143, thresholdPence: 500, token: "bad" }))).status).toBe(400);
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: false, body: { error: "Sign in" }, httpStatus: 401 });
  expect((await POST(request({ enabled: false }))).status).toBe(401);
});

it.each([400, 450, 500, 550, 600])("accepts the %i pence preset", async (thresholdPence) => {
  expect((await POST(request({ lat: 51.539, lng: -0.143, thresholdPence, token }))).status).toBe(200);
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toMatchObject({ thresholdPence });
});

it.each([1, 399, 475, 601, 100000, 450.5, "500"])("rejects a threshold outside the presets: %s", async (thresholdPence) => {
  expect((await POST(request({ lat: 51.539, lng: -0.143, thresholdPence, token }))).status).toBe(400);
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toEqual({ enabled: false });
});

it("does not expose or remove another account's alert", async () => {
  await POST(request({ lat: 51.539, lng: -0.143, thresholdPence: 500, token }));
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: true, accountId: "account-b", actor: "profile:b", handle: "other" });
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toEqual({ enabled: false });
  await POST(request({ enabled: false, accountId: "account-a" }));
  vi.mocked(resolveContributionIdentity).mockResolvedValue({ ok: true, accountId: "account-a", actor: "profile:a", handle: "test" });
  expect(await (await GET(new Request("http://localhost/api/price-alert"))).json()).toMatchObject({ enabled: true });
});

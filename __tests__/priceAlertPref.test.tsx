// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ owns: true, geolocate: vi.fn(), register: vi.fn(), fetch: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "account-a" } }) }));
vi.mock("@/lib/webPush", () => ({ registerWebPush: fixture.register, webPushSupport: () => "supported" }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => false }));
vi.mock("@/lib/authedFetch", async (original) => ({ ...(await original<typeof import("@/lib/authedFetch")>()), authedActionFetch: fixture.fetch }));
vi.mock("@/lib/authProviderRevision", async (original) => ({ ...(await original<typeof import("@/lib/authProviderRevision")>()), providerOwnsSession: () => fixture.owns }));

import PriceAlertPref from "@/components/profile/PriceAlertPref";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  fixture.geolocate.mockReset().mockImplementation((success) => success({ coords: { latitude: 51.473, longitude: -0.069 } }));
  vi.stubGlobal("navigator", Object.create(navigator, { geolocation: { value: { getCurrentPosition: fixture.geolocate } } }));
});
afterEach(() => vi.unstubAllGlobals());

it.each([null, 400, 450, 500, 550, 600])("saves the selected preset with a £5 default: %s", async (thresholdPence) => {
  fixture.owns = true;
  fixture.register.mockReset().mockResolvedValue("device-a");
  fixture.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({ enabled: false })));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(PriceAlertPref)); });
    const price = container.querySelector("select");
    expect(Number(price!.value)).toBe(500);
    await act(async () => {
      if (thresholdPence !== null) {
        price!.value = String(thresholdPence);
        price!.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Turn alert on")!.click(); });
    expect(fixture.geolocate).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ maximumAge: 0 }));
    const writes = fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]![1].body)).toEqual({ lat: 51.473, lng: -0.069, thresholdPence: thresholdPence ?? 500, token: "device-a" });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("does not save an alert to another account when registration finishes after a switch", async () => {
  fixture.owns = true;
  fixture.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ enabled: false })));
  let finish!: (value: string) => void;
  fixture.register.mockReset().mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(PriceAlertPref)); });
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Turn alert on")!.click(); });
  fixture.owns = false;
  await act(async () => { finish("device-a"); });
  expect(fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  await act(async () => root.unmount());
  container.remove();
});

it("refuses activation when the person denies location access", async () => {
  fixture.owns = true;
  fixture.geolocate.mockImplementation((_success, failure) => failure({ code: 1 }));
  fixture.register.mockReset();
  fixture.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({ enabled: false })));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(PriceAlertPref)); });
    await act(async () => { container.querySelector("button")!.click(); });
    expect(fixture.register).not.toHaveBeenCalled();
    expect(fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not register notifications when location arrives after an account switch", async () => {
  fixture.owns = true;
  let finish!: PositionCallback;
  fixture.geolocate.mockImplementation((success) => { finish = success; });
  fixture.register.mockReset();
  fixture.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({ enabled: false })));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(PriceAlertPref)); });
    await act(async () => { container.querySelector("button")!.click(); });
    fixture.owns = false;
    await act(async () => { finish({ coords: { latitude: 51.473, longitude: -0.069 } } as GeolocationPosition); });
    expect(fixture.register).not.toHaveBeenCalled();
    expect(fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
  }
});

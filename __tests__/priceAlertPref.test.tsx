// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ owns: true, register: vi.fn(), fetch: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "account-a" } }) }));
vi.mock("@/lib/webPush", () => ({ registerWebPush: fixture.register, webPushSupport: () => "supported" }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => false }));
vi.mock("@/lib/authedFetch", async (original) => ({ ...(await original<typeof import("@/lib/authedFetch")>()), authedActionFetch: fixture.fetch }));
vi.mock("@/lib/authProviderRevision", async (original) => ({ ...(await original<typeof import("@/lib/authProviderRevision")>()), providerOwnsSession: () => fixture.owns }));

import PriceAlertPref from "@/components/profile/PriceAlertPref";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows that a saved pending alert will start shortly", async () => {
  fixture.owns = true;
  fixture.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ enabled: true, area: "camden", thresholdPence: 500, status: "pending" })));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(PriceAlertPref)); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Alerts start shortly.");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("saves an alert with the fixed £5 threshold", async () => {
  fixture.owns = true;
  fixture.register.mockReset().mockResolvedValue("device-a");
  fixture.fetch.mockReset().mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? { enabled: true, area: "camden", thresholdPence: 500, status: "pending" } : { enabled: false })));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(PriceAlertPref)); });
    const area = container.querySelector("select")!;
    await act(async () => {
      area.value = "camden";
      area.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Turn alert on")!.click(); });
    const writes = fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]![1].body)).toEqual({ area: "camden", thresholdPence: 500, token: "device-a" });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Alerts start shortly.");
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
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "camden"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Turn alert on")!.click(); });
  fixture.owns = false;
  await act(async () => { finish("device-a"); });
  expect(fixture.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  await act(async () => root.unmount());
  container.remove();
});

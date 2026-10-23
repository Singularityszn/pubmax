// @vitest-environment jsdom
// The invite page is server-rendered, and the server knows nothing about this
// device. A guest name remembered in localStorage must therefore arrive AFTER
// hydration, never in the first client render, or the name input's `value`
// disagrees with the server HTML (CMP-9).
import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/plan/InviteMapLink", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/planSessionCapability", () => ({
  clearPlanCapability: vi.fn(),
  parsePlanCapabilitySnapshot: () => ({ token: null, role: null }),
  planCapabilityEvent: () => "plan-capability:plan-1",
  readPlanCapabilitySnapshot: () => "|0|",
  restorePlanCapability: vi.fn(async () => undefined),
  writePlanCapability: vi.fn(),
}));

import PlanInviteRsvp from "@/components/plan/PlanInviteRsvp";

const GUEST_NAME_STORAGE_KEY = "pubmax:inviteGuestName:v1";

const props = {
  token: "invite-token",
  planId: "plan-1",
  initialRsvp: { counts: { going: 0, maybe: 0 }, guests: [] },
  initialReactions: { counts: {}, mine: [] },
  venueIds: [],
};

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PlanInviteRsvp's remembered guest name", () => {
  it("renders an empty name on the first pass even when this device remembers one", () => {
    // React does not report a controlled input's `value` as a hydration
    // mismatch, so the honest check is what the FIRST render computes. In
    // jsdom `window` exists, so this render runs the same initialisers the
    // browser's hydration pass runs: it must match the server's empty input.
    localStorage.setItem(GUEST_NAME_STORAGE_KEY, "Sam");
    host.innerHTML = renderToString(createElement(PlanInviteRsvp, props));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(input?.getAttribute("value")).toBe("");
  });

  it("hydrates with no mismatch and then fills the remembered name", async () => {
    // The server render: no device storage, so the input is empty.
    host.innerHTML = renderToString(createElement(PlanInviteRsvp, props));
    const serverInput = host.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(serverInput?.getAttribute("value")).toBe("");

    // This device remembers a name from an earlier invite.
    localStorage.setItem(GUEST_NAME_STORAGE_KEY, "Sam");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRecoverableError = vi.fn();

    await act(async () => {
      root = hydrateRoot(host, createElement(PlanInviteRsvp, props), {
        onRecoverableError,
      });
    });

    const mismatch = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("didn't match"),
    );
    expect(mismatch).toEqual([]);
    expect(onRecoverableError).not.toHaveBeenCalled();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(input?.value).toBe("Sam");
  });

  it("lets the guest type over the remembered name", async () => {
    localStorage.setItem(GUEST_NAME_STORAGE_KEY, "Sam");
    host.innerHTML = renderToString(createElement(PlanInviteRsvp, props));
    await act(async () => {
      root = hydrateRoot(host, createElement(PlanInviteRsvp, props));
    });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Your name"]');
    expect(input?.value).toBe("Sam");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "Samira");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input?.value).toBe("Samira");
  });
});

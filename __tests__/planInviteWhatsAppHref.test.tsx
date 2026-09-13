// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://pubmaxxing.com/plan/6a7d6f2e-0c1a-4c4b-9c3d-1f2a3b4c5d6e" }

// Astra plan lane 1.7. The click path absolutised the crew-join URL, but the
// Send on WhatsApp anchor still carried the relative one, so a long-press,
// "Copy link" or a reader with pop-ups blocked sent "/plan/<id>#invite=..."
// with no host. Both paths now carry the site origin, and never a viewer
// coordinate.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN = "6a7d6f2e-0c1a-4c4b-9c3d-1f2a3b4c5d6e";
const TOKEN = "693fb655a1c34e7d8b0f2a1c4d5e6f70";

vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "member-token",
    collaborationAuthorized: true,
    role: "host",
  }),
  planCapabilityEvent: (planId: string) => `pubmax:plan-capability:${planId}`,
  readPlanCapabilitySnapshot: () => "member-token|1|host",
  restorePlanCapability: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/planInviteTokenClient", () => ({
  parsePlanInviteTokenSnapshot: () => ({ state: "ready", token: TOKEN }),
  planInviteTokenEvent: (planId: string) => `pubmax:plan-invite-token:${planId}`,
  readPlanInviteTokenSnapshot: () => `ready|${TOKEN}`,
  ensurePlanInviteToken: vi.fn().mockResolvedValue(undefined),
  clearPlanInviteToken: vi.fn(),
}));

vi.mock("@/components/plan/PlanVibe", () => ({
  PlanInviteShareBar: () => null,
}));

vi.mock("@/components/plan/PlanHostInviteLink", () => ({
  default: () => null,
  INVITE_TOKEN_MISSING_LINE: "missing",
  INVITE_TOKEN_UNAVAILABLE_LINE: "unavailable",
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PlanInviteNextStep from "@/components/plan/PlanInviteNextStep";

let root: Root;
let container: HTMLDivElement;

function sharedPayload(href: string): string {
  const url = new URL(href);
  expect(url.origin).toBe("https://wa.me");
  return url.searchParams.get("text") ?? "";
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(PlanInviteNextStep, {
        planId: PLAN,
        title: "Friday sorted",
        text: "Friday sorted",
        initialVibeSlug: null,
      }),
    );
    await Promise.resolve();
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Send on WhatsApp carries an absolute crew-join URL", () => {
  it("puts the site origin in the anchor href, not a bare /plan path", () => {
    const anchor = container.querySelector<HTMLAnchorElement>("a.planInviteNext__whatsapp");
    expect(anchor).not.toBeNull();

    const payload = sharedPayload(anchor!.href);
    expect(payload).toContain(`https://pubmaxxing.com/plan/${PLAN}#invite=${TOKEN}`);
    expect(payload).not.toMatch(/(^|\s)\/plan\//);
    expect(payload.startsWith("Friday sorted ")).toBe(true);
  });

  it("opens the same absolute URL on click", () => {
    const open = vi.fn().mockReturnValue({} as Window);
    vi.stubGlobal("open", open);

    const anchor = container.querySelector<HTMLAnchorElement>("a.planInviteNext__whatsapp");
    act(() => {
      anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(open).toHaveBeenCalledTimes(1);
    const payload = sharedPayload(String(open.mock.calls[0]?.[0]));
    expect(payload).toContain(`https://pubmaxxing.com/plan/${PLAN}#invite=${TOKEN}`);
  });

  it("never carries a viewer coordinate in the share URL", () => {
    const anchor = container.querySelector<HTMLAnchorElement>("a.planInviteNext__whatsapp");
    const payload = sharedPayload(anchor!.href);
    expect(payload).not.toMatch(/lat=|lng=|lon=|near=/);
  });
});

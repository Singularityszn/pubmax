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
  NOT_IN_CREW_LINE: "not in crew",
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PlanInviteNextStep from "@/components/plan/PlanInviteNextStep";
import { trackEvent } from "@/lib/analytics";

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

describe("Send on WhatsApp carries the absolute invite page URL", () => {
  it("puts the site origin and the /invite page in the anchor href, not a bare /plan path", () => {
    const anchor = container.querySelector<HTMLAnchorElement>("a.planInviteNext__whatsapp");
    expect(anchor).not.toBeNull();

    const payload = sharedPayload(anchor!.href);
    expect(payload).toContain(`https://pubmaxxing.com/invite/${TOKEN}`);
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
    expect(payload).toContain(`https://pubmaxxing.com/invite/${TOKEN}`);
  });

  it("never carries a viewer coordinate in the share URL", () => {
    const anchor = container.querySelector<HTMLAnchorElement>("a.planInviteNext__whatsapp");
    const payload = sharedPayload(anchor!.href);
    expect(payload).not.toMatch(/lat=|lng=|lon=|near=/);
  });
});

// window.open as the HTML spec has it: a "noopener" feature opens the tab and
// returns null. The mock above answers a window whatever it is given, which is
// how every WhatsApp invite told its host "Could not open WhatsApp" and sent no
// plan_invite_sent without a test noticing.
function specWindowOpen() {
  return vi.fn((_url?: string, _target?: string, features?: string) => (
    features?.includes("noopener") ? null : ({ opener: window } as unknown as Window)
  ));
}

describe("a WhatsApp invite that opened is counted, and is not reported as failing", () => {
  it("sends plan_invite_sent and shows no error when the tab opens", () => {
    vi.stubGlobal("open", specWindowOpen());
    const anchor = container.querySelector<HTMLAnchorElement>("a.planInviteNext__whatsapp");
    act(() => {
      anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(trackEvent).toHaveBeenCalledWith("plan_invite_sent", { channel: "whatsapp" });
    expect(container.querySelector(".planInviteNext__error")).toBeNull();
  });

  it("still says so, and counts nothing, when a blocker really ate the tab", () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));
    const anchor = container.querySelector<HTMLAnchorElement>("a.planInviteNext__whatsapp");
    act(() => {
      anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(trackEvent).not.toHaveBeenCalledWith("plan_invite_sent", expect.anything());
    expect(container.querySelector(".planInviteNext__error")?.textContent).toContain("Could not open WhatsApp");
  });
});

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPlan, restorePlanCapability, writeText } = vi.hoisted(() => ({
  fetchPlan: vi.fn(),
  restorePlanCapability: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "member-token",
    collaborationAuthorized: false,
    role: "host",
  }),
  planCapabilityEvent: (planId: string) => `pubmax:plan-capability:${planId}`,
  readPlanCapabilitySnapshot: () => "member-token|1|host",
  restorePlanCapability,
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

import PlanHostInviteLink from "@/components/plan/PlanHostInviteLink";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const CLASSIC_INVITE_TOKEN = "a".repeat(32);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  fetchPlan.mockResolvedValue({
    ok: true,
    json: async () => ({ inviteToken: CLASSIC_INVITE_TOKEN }),
  });
  restorePlanCapability.mockResolvedValue(undefined);
  writeText.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchPlan);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PlanHostInviteLink", () => {
  it("copies the canonical crew join URL", async () => {
    await act(async () => {
      root.render(createElement(PlanHostInviteLink, { planId: PLAN_ID }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const copyButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy invite link",
    );
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/plan/${PLAN_ID}#invite=${CLASSIC_INVITE_TOKEN}`,
    );
  });
});

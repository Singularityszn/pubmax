// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { restorePlanCapability } = vi.hoisted(() => ({
  restorePlanCapability: vi.fn(),
}));

vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "",
    collaborationAuthorized: false,
    role: null,
  }),
  planCapabilityEvent: (planId: string) => `pubmax:plan-capability:${planId}`,
  readPlanCapabilitySnapshot: () => "|0|",
  restorePlanCapability,
}));

vi.mock("@/components/plan/PlanVibe", () => ({
  PlanInviteShareBar: () => null,
}));

import PlanHostInviteLink from "@/components/plan/PlanHostInviteLink";
import PlanInviteNextStep from "@/components/plan/PlanInviteNextStep";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  restorePlanCapability.mockRejectedValue(new Error("session unavailable"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("plan invite session restoration", () => {
  it("settles host invite tools after restoration fails", async () => {
    await act(async () => {
      root.render(createElement(PlanHostInviteLink, { planId: "plan-1" }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("You're a guest on this plan. Join the crew to use the invite tools.");
    expect(container.textContent).not.toContain("Restoring your invite tools");
  });

  it("settles next-step sharing state after restoration fails", async () => {
    await act(async () => {
      root.render(createElement(PlanInviteNextStep, {
        planId: "plan-2",
        title: "Friday sorted",
        text: "Friday sorted",
        initialVibeSlug: null,
      }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("You're a guest on this plan. Join the crew to use the invite tools.");
    expect(container.textContent).not.toContain("Restoring your invite tools");
    // ONE notice for a stranger. The nested host link used to print the same
    // sentence a second time, and the host-only tools rendered beside it.
    expect(container.textContent!.split("You're a guest on this plan").length - 1).toBe(1);
    expect(container.querySelector(".planInviteNext__more")).toBeNull();
  });
});

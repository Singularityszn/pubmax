// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, identityResolved: true }),
}));

import PlanCollaborationPanel from "@/components/plan/PlanCollaborationPanel";
import PlanComposer from "@/components/plan/PlanComposer";
import PlanCrew from "@/components/plan/PlanCrew";
import { MobilePlanActivation } from "@/components/plan/MobilePlanActivation";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import PlanIntake from "@/components/plan/PlanIntake";
import PlanInviteRsvp from "@/components/plan/PlanInviteRsvp";
import WantedCapture from "@/components/wanted/WantedCapture";
import { PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, writePlanDraftEnvelope } from "@/lib/planDraft";
import { createPlanIntakeDraft, type PlanIntakeDraft } from "@/lib/planIntake";

function intakeDraft(
  currentStep: PlanIntakeDraft["currentStep"],
  answers: Partial<PlanIntakeDraft["answers"]> = {},
): PlanIntakeDraft {
  const draft = createPlanIntakeDraft();
  return {
    ...draft,
    currentStep,
    answers: { ...draft.answers, ...answers },
  };
}

function renderedInputs(): HTMLInputElement[] {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(PlanDescribeFirst, {
        onSubmit: () => undefined,
        onGuideMeInstead: () => undefined,
      }),
      createElement(MobilePlanActivation, {
        cityId: "london",
        initialNightArea: "clapham",
        onGenerated: () => undefined,
      }),
      createElement(PlanIntake, {
        draft: intakeDraft("time-window", {
          timeWindow: "evening",
          exactStartIso: "2026-07-20T18:00:00.000Z",
        }),
        onChange: () => undefined,
      }),
      createElement(PlanIntake, {
        draft: intakeDraft("group-size", { groupSize: 4 }),
        onChange: () => undefined,
      }),
      createElement(PlanIntake, {
        draft: intakeDraft("budget", { budget: "value", budgetLimitPence: 2500 }),
        onChange: () => undefined,
      }),
      createElement(WantedCapture),
      createElement(PlanCollaborationPanel, {
        planId: "plan-input-types-collaboration",
        memberToken: "member-token",
        isHost: false,
        draftStops: [{ venueId: "venue-a", venueName: "The Pub", position: 1 }],
        routeRevision: 1,
        canPropose: true,
        onProposalCreated: () => undefined,
      }),
      createElement(PlanInviteRsvp, {
        token: "invite-token",
        planId: "plan-input-types-rsvp",
        initialRsvp: { counts: { going: 0, maybe: 0 }, guests: [] },
        initialReactions: { counts: {}, mine: [] },
        venueIds: ["venue-a"],
      }),
    ),
  );
  return Array.from(host.querySelectorAll<HTMLInputElement>("input"));
}

async function mountedInputs(): Promise<HTMLInputElement[]> {
  const host = document.createElement("div");
  document.body.append(host);
  const previousUrl = window.location.href;
  const storage = window.sessionStorage;
  const previousDraft = storage.getItem(PLAN_DRAFT_KEY);
  const previousDraftV2 = storage.getItem(PLAN_DRAFT_V2_KEY);
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(null, { status: 401 }),
  );
  let root: Root | null = null;
  try {
    writePlanDraftEnvelope({
      title: "Input types test",
      creatorName: "Test drinker",
      startTime: new Date(Date.now() + 3_600_000).toISOString(),
      conciergeQuery: "Quiet pints",
      stops: [{ key: 1, venueId: "venue-a", venueName: "The Pub" }],
    }, "manual", storage);
    window.history.replaceState({}, "", "/plan#invite=invite-token");
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(Fragment, null,
        createElement(PlanCrew, {
          planId: "plan-input-types-crew",
          hostName: "Host",
        }),
        createElement(PlanComposer),
      ));
      await Promise.resolve();
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
      });
    }
    return Array.from(host.querySelectorAll<HTMLInputElement>("input"));
  } finally {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    fetchSpy.mockRestore();
    if (previousDraft === null) storage.removeItem(PLAN_DRAFT_KEY);
    else storage.setItem(PLAN_DRAFT_KEY, previousDraft);
    if (previousDraftV2 === null) storage.removeItem(PLAN_DRAFT_V2_KEY);
    else storage.setItem(PLAN_DRAFT_V2_KEY, previousDraftV2);
    window.history.replaceState({}, "", previousUrl);
    host.remove();
  }
}

describe("plan and Wanted fields expose their input types", () => {
  it("renders an explicit type for every native input", async () => {
    const inputs = [...renderedInputs(), ...(await mountedInputs())];

    expect(inputs).toHaveLength(18);
    expect(inputs.map((input) => input.getAttribute("type"))).toEqual([
      "text",
      "text",
      "number",
      "number",
      "datetime-local",
      "number",
      "number",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
      "datetime-local",
      "text",
    ]);
  });
});

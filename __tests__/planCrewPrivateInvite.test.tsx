// @vitest-environment jsdom

// A PRIVATE ONE-USE INVITE OPENS THE JOIN FORM IT WAS MADE FOR.
//
// "Create private invite" mints 32 random bytes as 64 lowercase hex and puts
// them in the plan link's #invite= hash, and the join route redeems that
// token. The crew panel knew only the 32-hex classic link, so it told a guest
// the link was not valid. These cases render the crew panel the way a
// signed-out guest meets it, for each kind of link. The server still decides
// whether a well-shaped token is real, unexpired and unused.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN = "6ab5ca40-836b-4970-9477-d1779fdd31ab";
const ONE_USE_TOKEN = "3f".repeat(32);
const CLASSIC_TOKEN = "a1".repeat(16);
const MALFORMED_LINE = "This invite link isn't valid. Ask the host for a fresh one.";
const NO_LINK_LINE = "Open the invite link your host sent to join this crew.";

const seams = vi.hoisted(() => ({
  joins: [] as Array<{ url: string; body: unknown }>,
  writeCapability: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, identityResolved: true }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(), trackMeaningfulCoreAction: vi.fn() }));
vi.mock("@/lib/authRedirect", () => ({ subscribeToAuthFragmentRestored: vi.fn(() => () => {}) }));
vi.mock("@/lib/crewRealtime", () => ({ subscribeToPlanCrew: vi.fn(() => () => {}) }));
vi.mock("@/lib/identityNudge", () => ({ isIdentityNudgePending: () => false, recordPlanNudgeTrigger: vi.fn() }));
vi.mock("@/lib/nativePushPrompt", () => ({ recordPlanHighIntentAction: vi.fn() }));
vi.mock("@/lib/planMutationKey", () => ({
  persistentPlanMutationKey: vi.fn(async () => "join-request-key"),
  clearPersistentPlanMutationKey: vi.fn(),
}));
// A signed-out guest in a fresh browser holds no capability for this Plan.
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({ token: "", collaborationAuthorized: false, role: null }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => "|0|",
  restorePlanCapability: vi.fn().mockResolvedValue(null),
  writePlanCapability: seams.writeCapability,
}));
// The join request is the boundary: what the form sends, and the route's answer.
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn(async (url: string, init: RequestInit) => {
    seams.joins.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ memberToken: "guest-token", collaborationAuthorized: true });
  }),
}));

import PlanCrew from "@/components/plan/PlanCrew";
import { clearPlanMemberProjectionRead } from "@/components/plan/usePlanMemberRead";

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openCrew(hash: string): Promise<void> {
  window.history.replaceState(null, "", `/plan/${PLAN}${hash}`);
  await act(async () => {
    root.render(createElement(PlanCrew, { planId: PLAN, hostName: "Sam" }));
  });
  await settle();
}

function nameField(): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>("#join-name");
}

async function joinAs(name: string): Promise<void> {
  const field = nameField();
  if (!field) throw new Error("The join form is not on screen.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, name);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = host.querySelector<HTMLButtonElement>('.planCrew__join button[type="submit"]');
  if (!submit) throw new Error("The join button is not on screen.");
  await act(async () => submit.click());
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  seams.joins.length = 0;
  seams.writeCapability.mockClear();
  clearPlanMemberProjectionRead(PLAN);
  // The preview projection a non-member reads carries no crew.
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ visibility: "preview" })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearPlanMemberProjectionRead(PLAN);
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the crew panel and a guest's invite link", () => {
  it("opens the join form for a host's private one-use invite and sends that exact token", async () => {
    await openCrew(`#invite=${ONE_USE_TOKEN}`);

    expect(host.textContent).not.toContain(MALFORMED_LINE);
    expect(nameField()).not.toBeNull();

    await joinAs("Priya");

    expect(seams.joins).toEqual([
      { url: `/api/plans/${PLAN}/join`, body: { name: "Priya", inviteToken: ONE_USE_TOKEN } },
    ]);
    expect(seams.writeCapability).toHaveBeenCalledWith(PLAN, {
      token: "guest-token",
      collaborationAuthorized: true,
      role: "guest",
    });
    expect(window.location.hash).toBe("");
  });

  it("still opens the join form for a classic crew link", async () => {
    await openCrew(`#invite=${CLASSIC_TOKEN}`);

    expect(host.textContent).not.toContain(MALFORMED_LINE);
    expect(nameField()).not.toBeNull();
  });

  it.each([
    ["a word", "not-an-invite"],
    ["63 hex characters", "3f".repeat(31) + "3"],
    ["66 hex characters", "ab".repeat(33)],
  ])("refuses a link carrying %s and shows no form", async (_label, token) => {
    await openCrew(`#invite=${token}`);

    expect(host.textContent).toContain(MALFORMED_LINE);
    expect(nameField()).toBeNull();
    expect(seams.joins).toEqual([]);
  });

  it("asks for the host's link when the address carries none", async () => {
    await openCrew("");

    expect(host.textContent).toContain(NO_LINK_LINE);
    expect(host.textContent).not.toContain(MALFORMED_LINE);
    expect(nameField()).toBeNull();
  });
});

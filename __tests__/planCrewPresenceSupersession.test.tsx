// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Same auth-provider and unrelated side-effect boundaries as the existing
// PlanCrew mounted suites. Capability events and recovery helpers stay real.
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
    session: { access_token: "fixture-account-token" }, identityResolved: true,
  }),
}));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "fixture-account-token" }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(), trackMeaningfulCoreAction: vi.fn() }));
vi.mock("@/lib/authRedirect", () => ({ subscribeToAuthFragmentRestored: () => () => {} }));
vi.mock("@/lib/crewRealtime", () => ({ subscribeToPlanCrew: () => () => {} }));
vi.mock("@/lib/identityNudge", () => ({ isIdentityNudgePending: () => false, recordPlanNudgeTrigger: vi.fn() }));
vi.mock("@/lib/nativePushPrompt", () => ({ recordPlanHighIntentAction: vi.fn() }));

import PlanCrew from "@/components/plan/PlanCrew";
import { clearPlanMemberProjectionRead } from "@/components/plan/usePlanMemberRead";
import { clearPlanCapability, PLAN_HTTP_ONLY_SESSION, writePlanCapability } from "@/lib/planSessionCapability";
import { publishAuthActionState } from "@/lib/authedFetch";

const PLAN = "6ab5ca40-836b-4970-9477-d1779fdd31ab";
const MEMBER = { token: PLAN_HTTP_ONLY_SESSION, role: "host" as const, collaborationAuthorized: true };
let root: Root;
let host: HTMLDivElement;
let finishFirst: (response: Response) => void;
let requests: Array<{ path: string; method: string; body: unknown }>;
const crew = (status = "in") => ({ crew: [{ id: "crew-host", name: "Sam", status }] });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear(); localStorage.clear();
  clearPlanMemberProjectionRead(PLAN);
  clearPlanCapability(PLAN);
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  window.history.replaceState(null, "", `/plan/${PLAN}`);
  requests = [];
  const firstPresence = new Promise<Response>((resolve) => { finishFirst = resolve; });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const path = new URL(request?.url ?? String(input), window.location.origin).pathname;
    const method = init?.method ?? request?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
    requests.push({ path, method, body });
    if (path === `/api/plans/${PLAN}/presence` && method === "POST") {
      const count = requests.filter((row) => row.path === path && row.method === "POST").length;
      return count === 1 ? firstPresence : Promise.resolve(Response.json(crew("on_the_way")));
    }
    if (path === `/api/plans/${PLAN}/session`) {
      // If stale code clears the newer marker, the real restore helper will
      // read inactive and attempt a signed-in PATCH. Observe that public seam.
      return Promise.resolve(Response.json(method === "PATCH"
        ? { active: true, role: "host", collaborationAuthorized: true } : { active: false }));
    }
    if (path === `/api/plans/${PLAN}` && method === "GET") return Promise.resolve(Response.json(crew()));
    return Promise.reject(new Error("Unexpected fixture endpoint"));
  }));
  writePlanCapability(PLAN, MEMBER);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  finishFirst(Response.json({ error: "Fixture closed", code: "FIXTURE_CLOSED", retryable: false }, { status: 503 }));
  await act(async () => root.unmount());
  host.remove();
  clearPlanCapability(PLAN); clearPlanMemberProjectionRead(PLAN);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

function statusButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((node) => node.textContent?.trim() === "On the way");
  if (!button) throw new Error("The member status control is missing");
  return button;
}
async function settled(check: () => void) {
  await vi.waitFor(async () => { await act(async () => {}); check(); }, { timeout: 5_000 });
}

it("keeps newer identical-marker authority when an older presence refusal arrives", async () => {
  await act(async () => root.render(createElement(PlanCrew, { planId: PLAN, hostName: "Sam" })));
  await settled(() => expect(statusButton().disabled).toBe(false));
  await act(async () => statusButton().click());
  await settled(() => {
    expect(requests.filter((row) => row.path.endsWith("/presence"))).toHaveLength(1);
    expect(statusButton().disabled).toBe(true);
  });

  // A successful newer capability publication has the same public marker and
  // snapshot bytes. Its existing public event must still supersede this request.
  await act(async () => writePlanCapability(PLAN, { ...MEMBER }));
  await act(async () => finishFirst(Response.json({
    error: "Your crew session needs refreshing.", code: "PLAN_PRESENCE_REQUIRED", retryable: false,
  }, { status: 401 })));
  await settled(() => expect(statusButton().disabled).toBe(false));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(requests.filter((row) => row.path.endsWith("/session") && row.method === "PATCH")).toEqual([]);

  // The next deliberate public action proves the newer authority was retained.
  await act(async () => statusButton().click());
  await settled(() => {
    expect(statusButton().getAttribute("aria-pressed")).toBe("true");
    expect(statusButton().disabled).toBe(false);
  });
  const writes = requests.filter((row) => row.path.endsWith("/presence") && row.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes.map((row) => row.body)).toEqual([
    { memberToken: PLAN_HTTP_ONLY_SESSION, status: "on_the_way" },
    { memberToken: PLAN_HTTP_ONLY_SESSION, status: "on_the_way" },
  ]);
  expect(statusButton().disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(requests.filter((row) => row.path.endsWith("/session") && row.method === "PATCH")).toEqual([]);
});

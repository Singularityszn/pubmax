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
let rejectFirst: (error: Error) => void;
let serverStatus: string;
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
  serverStatus = "in";
  const firstPresence = new Promise<Response>((resolve, reject) => { finishFirst = resolve; rejectFirst = reject; });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const path = new URL(request?.url ?? String(input), window.location.origin).pathname;
    const method = init?.method ?? request?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
    requests.push({ path, method, body });
    if (path === `/api/plans/${PLAN}/presence` && method === "POST") {
      serverStatus = (body as { status: string }).status;
      const count = requests.filter((row) => row.path === path && row.method === "POST").length;
      return count === 1 ? firstPresence : Promise.resolve(Response.json(crew(serverStatus)));
    }
    if (path === `/api/plans/${PLAN}/session`) {
      // If stale code clears the newer marker, the real restore helper will
      // read inactive and attempt a signed-in PATCH. Observe that public seam.
      return Promise.resolve(Response.json(method === "PATCH"
        ? { active: true, role: "host", collaborationAuthorized: true } : { active: false }));
    }
    if (path === `/api/plans/${PLAN}` && method === "GET") return Promise.resolve(Response.json(crew(serverStatus)));
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

it("recovers the lost crew session when presence finds only the HttpOnly marker", async () => {
  await act(async () => root.render(createElement(PlanCrew, { planId: PLAN, hostName: "Sam" })));
  await settled(() => expect(statusButton().disabled).toBe(false));
  await act(async () => statusButton().click());
  await settled(() => expect(requests.filter((row) => row.path.endsWith("/presence"))).toHaveLength(1));

  // The capability cookie expired, so the server holds no member authority.
  await act(async () => finishFirst(Response.json({
    error: "Your crew session needs refreshing.", code: "PLAN_PRESENCE_REQUIRED", retryable: false,
  }, { status: 401 })));

  // The optimistic status rolls back, the page says what to do, and the
  // signed-in account restores the crew session without a reload.
  await settled(() => {
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save your status. Tap it again when your crew is back.",
    );
    expect(statusButton().getAttribute("aria-pressed")).toBe("false");
    expect(requests.filter((row) => row.path.endsWith("/session") && row.method === "PATCH")).toHaveLength(1);
    expect(statusButton().disabled).toBe(false);
  });

  await act(async () => statusButton().click());
  await settled(() => expect(statusButton().getAttribute("aria-pressed")).toBe("true"));
  expect(requests.filter((row) => row.path.endsWith("/presence") && row.method === "POST")).toHaveLength(2);
});

it.each(["unmount", "supersession", "transport", "body", "refusal-body", "null-body", "server"] as const)(
  "forgets the cached selection after a committed write with an uncertain %s outcome",
  async (outcome) => {
    sessionStorage.setItem(`pubmax-plan-status:${PLAN}`, "in");
    await act(async () => root.render(createElement(PlanCrew, { planId: PLAN, hostName: "Sam" })));
    await settled(() => expect(statusButton().disabled).toBe(false));
    await act(async () => statusButton().click());
    expect(serverStatus).toBe("on_the_way");

    if (outcome === "unmount") {
      await act(async () => root.render(null));
    } else if (outcome === "supersession") {
      await act(async () => writePlanCapability(PLAN, { ...MEMBER }));
    } else if (outcome === "transport") {
      await act(async () => rejectFirst(new Error("Connection lost after commit")));
    } else {
      await act(async () => finishFirst(outcome === "body" || outcome === "refusal-body"
        ? new Response("truncated JSON", { status: outcome === "refusal-body" ? 403 : 200 })
        : outcome === "null-body" ? Response.json(null)
        : Response.json({ error: "Unknown write outcome" }, { status: 503 })));
    }

    expect(sessionStorage.getItem(`pubmax-plan-status:${PLAN}`)).toBeNull();
    if (outcome === "unmount" || outcome === "supersession") {
      await act(async () => finishFirst(Response.json(crew(serverStatus))));
    }
    if (outcome === "unmount") {
      clearPlanMemberProjectionRead(PLAN);
      await act(async () => root.render(createElement(PlanCrew, { planId: PLAN, hostName: "Sam" })));
      await settled(() => expect(host.querySelector('.planCrew__list [data-status="on_the_way"]')?.textContent).toBe("On the way"));
    }
    await settled(() => expect(statusButton().disabled).toBe(false));
    expect(host.querySelector('button[aria-pressed="true"]')).toBeNull();
    const inButton = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "In")!;
    await act(async () => inButton.click());
    await settled(() => expect(inButton.getAttribute("aria-pressed")).toBe("true"));
    expect(serverStatus).toBe("in");
    expect(requests.filter((row) => row.path.endsWith("/presence"))).toHaveLength(2);
  },
);

it("restores the previous selection after a confirmed refusal", async () => {
  sessionStorage.setItem(`pubmax-plan-status:${PLAN}`, "in");
  await act(async () => root.render(createElement(PlanCrew, { planId: PLAN, hostName: "Sam" })));
  await settled(() => expect(statusButton().disabled).toBe(false));
  await act(async () => statusButton().click());
  serverStatus = "in";
  await act(async () => finishFirst(Response.json({ error: "Too many updates" }, { status: 429 })));
  await settled(() => expect(statusButton().disabled).toBe(false));
  expect(sessionStorage.getItem(`pubmax-plan-status:${PLAN}`)).toBe("in");
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("In");
});

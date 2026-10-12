// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAccessToken } = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock("@/lib/authClient", () => ({ getAccessToken }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PlanHostInviteLink from "@/components/plan/PlanHostInviteLink";
import { publishAuthActionState } from "@/lib/authedFetch";
import { clearPlanInviteToken, readPlanInviteTokenSnapshot } from "@/lib/planInviteTokenClient";
import { clearPlanCapability, restorePlanCapability } from "@/lib/planSessionCapability";

const PLAN = "66666666-7777-4888-8999-000000000007";
const FIRST = "first-invite";
const ROTATED = "rotated-invite";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  clearPlanCapability(PLAN);
  clearPlanInviteToken(PLAN);
  getAccessToken.mockResolvedValue("fixture-account-token");
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearPlanCapability(PLAN);
  clearPlanInviteToken(PLAN);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("restored host invite actions", () => {
  it("recovers a lost cookie and rotates once without remounting the Plan", async () => {
    let cookiePresent = true;
    const requests: { path: string; method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      requests.push({ path, method });
      if (path === `/api/plans/${PLAN}/session`) {
        if (method === "PATCH") {
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-account-token");
          expect(new Headers(init?.headers).get("idempotency-key")).toBeTruthy();
          cookiePresent = true;
        }
        return Response.json(cookiePresent
          ? { active: true, role: "host", collaborationAuthorized: true }
          : { active: false });
      }
      if (path === `/api/plans/${PLAN}`) return Response.json({ inviteToken: FIRST });
      if (path === `/api/plans/${PLAN}/invite-rotate` && method === "POST") {
        return cookiePresent
          ? Response.json({ inviteToken: ROTATED })
          : Response.json({ error: "Forbidden" }, { status: 403 });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    }));

    await restorePlanCapability(PLAN);
    await act(async () => root.render(createElement(PlanHostInviteLink, { planId: PLAN })));
    const button = Array.from(container.querySelectorAll("button"))
      .find((node) => node.textContent === "New link");
    expect(button).toBeDefined();
    requests.length = 0;
    cookiePresent = false;

    await act(async () => button!.click());

    expect(container.textContent).toContain("New link ready. The old one stopped working.");
    expect(cookiePresent).toBe(true);
    expect(readPlanInviteTokenSnapshot(PLAN)).toBe(`ready|${ROTATED}`);
    expect(requests).toEqual([
      { path: `/api/plans/${PLAN}/invite-rotate`, method: "POST" },
      { path: `/api/plans/${PLAN}/session`, method: "GET" },
      { path: `/api/plans/${PLAN}/session`, method: "PATCH" },
      { path: `/api/plans/${PLAN}/invite-rotate`, method: "POST" },
    ]);
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it.each(["signed-out", "unauthorized", "guest", "retry-refused", "unavailable"] as const)(
    "does not rotate beyond the restored authority when %s",
    async (outcome) => {
      let cookieLost = false;
      const requests: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        const method = init?.method ?? "GET";
        requests.push(`${method} ${path}`);
        if (path === `/api/plans/${PLAN}/session`) {
          if (!cookieLost) return Response.json({ active: true, role: "host" });
          if (method === "GET") return Response.json({ active: false });
          if (outcome === "unavailable") return Response.json({}, { status: 503 });
          if (outcome === "unauthorized") return Response.json({ active: false }, { status: 403 });
          return Response.json({ active: true, role: outcome === "guest" ? "guest" : "host" });
        }
        if (path === `/api/plans/${PLAN}`) return Response.json({ inviteToken: FIRST });
        if (path === `/api/plans/${PLAN}/invite-rotate`) return Response.json({}, { status: 403 });
        throw new Error(`Unexpected request: ${method} ${path}`);
      }));
      await restorePlanCapability(PLAN);
      await act(async () => root.render(createElement(PlanHostInviteLink, { planId: PLAN })));
      const button = Array.from(container.querySelectorAll("button"))
        .find((node) => node.textContent === "New link");
      expect(button).toBeDefined();
      requests.length = 0;
      cookieLost = true;
      getAccessToken.mockClear();
      if (outcome === "signed-out") {
        publishAuthActionState({ status: "signed-out", identityResolved: true });
      }

      await act(async () => button!.click());

      expect(container.textContent).not.toContain("New link ready.");
      expect(readPlanInviteTokenSnapshot(PLAN)).toBe(`ready|${FIRST}`);
      const expected = [
        `POST /api/plans/${PLAN}/invite-rotate`,
        `GET /api/plans/${PLAN}/session`,
      ];
      if (outcome !== "signed-out") expected.push(`PATCH /api/plans/${PLAN}/session`);
      if (outcome === "retry-refused") expected.push(`POST /api/plans/${PLAN}/invite-rotate`);
      expect(requests).toEqual(expected);
      if (outcome === "signed-out") expect(getAccessToken).not.toHaveBeenCalled();
      if (outcome === "guest") {
        expect(Array.from(container.querySelectorAll("button")).some((node) => node.textContent === "New link")).toBe(false);
      }
    },
  );
});

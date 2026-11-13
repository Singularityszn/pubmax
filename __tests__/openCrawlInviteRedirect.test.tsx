import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// THE OLD INVITE LINK FOLLOWS THE PLAN (launch plan P0 #5). After "Open it up"
// the plan is Crew-bound, so the plan read answers { plan: null }. A host who
// already posted the invite link keeps it working: the page redirects to the
// open crew's page. A plan that became a PRIVATE crew still reads as "not
// valid", so the link never says that crew exists.

const OPEN_CREW = "3f2b8c1e-6a4d-4c9b-8e7f-1a2b3c4d5e6f";

const state = vi.hoisted(() => ({
  planRead: { ok: true, plan: null } as { ok: boolean; plan: null },
  crew: { ok: true, crewId: null } as { ok: true; crewId: string | null } | { ok: false },
  crewAsks: [] as string[],
}));

vi.mock("@/lib/planStore", () => ({
  resolvePlanIdByInviteToken: async () => ({ ok: true, planId: "plan-opened" }),
  planStateResult: async () => state.planRead,
}));
vi.mock("@/lib/openCrawlInvite.server", () => ({
  openCrawlCrewIdForPlan: async (planId: string) => {
    state.crewAsks.push(planId);
    return state.crew;
  },
}));
vi.mock("@/components/plan/PlanInviteRsvp", () => ({ default: () => null }));
vi.mock("@/components/plan/InvitePageView", () => ({ default: () => null }));

import PlanInvitePage, { generateMetadata } from "@/app/invite/[token]/page";

const params = { params: Promise.resolve({ token: "a".repeat(32) }) };

/** The redirect target Next carries on the error `redirect()` throws, or null. */
async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) throw error;
    return digest.split(";")[2] ?? null;
  }
}

async function renderPage(): Promise<string> {
  const element = await PlanInvitePage(params);
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

afterEach(() => {
  state.planRead = { ok: true, plan: null };
  state.crew = { ok: true, crewId: null };
  state.crewAsks = [];
});

describe("an invite whose plan was opened up", () => {
  it("redirects the page and its link preview to the open crawl page", async () => {
    state.crew = { ok: true, crewId: OPEN_CREW };
    expect(await redirectTarget(() => PlanInvitePage(params))).toBe(`/social/crews/${OPEN_CREW}`);
    expect(await redirectTarget(() => generateMetadata(params))).toBe(`/social/crews/${OPEN_CREW}`);
    expect(state.crewAsks).toEqual(["plan-opened", "plan-opened"]);
  });

  it("still reads as not valid when the plan's crew is not open", async () => {
    state.crew = { ok: true, crewId: null };
    expect(await renderPage()).toContain("This invite link isn’t valid");
    expect((await generateMetadata(params)).title).toBe("This invite link isn't valid");
  });

  it("says try again when the crew lookup fails, rather than calling the link dead", async () => {
    state.crew = { ok: false };
    expect(await renderPage()).toContain("This invite isn’t available right now");
  });

  it("never asks about a crew when the plan read itself failed", async () => {
    state.planRead = { ok: false, plan: null };
    expect(await renderPage()).toContain("This invite isn’t available right now");
    expect(state.crewAsks).toEqual([]);
  });
});

describe("openCrawlCrewIdForPlan", () => {
  it("answers the open crew, none, or a failed read", async () => {
    const actual = await vi.importActual<typeof import("@/lib/openCrawlInvite.server")>(
      "@/lib/openCrawlInvite.server",
    );
    await expect(actual.openCrawlCrewIdForPlan("plan-1", { readOpenCrewId: async () => OPEN_CREW }))
      .resolves.toEqual({ ok: true, crewId: OPEN_CREW });
    await expect(actual.openCrawlCrewIdForPlan("plan-1", { readOpenCrewId: async () => null }))
      .resolves.toEqual({ ok: true, crewId: null });
    await expect(actual.openCrawlCrewIdForPlan("plan-1", {
      readOpenCrewId: async () => { throw new Error("store down"); },
    })).resolves.toEqual({ ok: false });
  });
});

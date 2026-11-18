import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanState } from "@/lib/plan";

const store = vi.hoisted(() => ({ resolve: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/planStore", () => ({ resolvePlanIdByInviteToken: store.resolve, planStateResult: store.state }));
vi.mock("@/lib/venueDetailIndex", () => ({ lookupVenueDetail: async () => ({ status: "found", venue: { cheapestPrice: 6.5 } }) }));
vi.mock("next/og", () => ({ ImageResponse: class extends Response {
  constructor(element: ReactElement) { super(renderToStaticMarkup(element)); }
} }));
import Image from "@/app/invite/[token]/opengraph-image";

const plan: PlanState = {
  plan: { id: "plan-1", title: "Secret celebration", startTime: "2026-07-18T19:00:00.000Z", createdAt: "2026-07-15T12:00:00.000Z", routeRevision: 1, status: "ready" },
  stops: [
    { venueId: "secret-id-one", venueName: "Hidden Arms", position: 0 },
    { venueId: "secret-id-two", venueName: "Secret Tap", position: 1 },
  ],
  crew: [{ id: "member-1", name: "Private Host", status: "in", joinedAt: "2026-07-15T12:00:00.000Z", updatedAt: "2026-07-15T12:00:00.000Z" }],
  context: { nightArea: "shoreditch", daypart: "evening", partyType: "friends", groupSize: 4, budget: "standard", budgetLimitPence: null, zeroProof: false, wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [] },
  actions: [], ending: null,
};

async function imageText() {
  const response = await Image({ params: Promise.resolve({ token: "valid-token" }) });
  return (await response.text()).replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}

beforeEach(() => {
  store.resolve.mockReset().mockResolvedValue({ ok: true, planId: plan.plan.id });
  store.state.mockReset().mockResolvedValue({ ok: true, plan });
});

describe("invite share image privacy", () => {
  it("shows only the broad invitation details from a saved plan", async () => {
    const output = await imageText();
    for (const secret of ["Secret celebration", "Private Host", "Hidden Arms", "Secret Tap", "secret-id-one", "secret-id-two", "£6.50", "£13.00"]) expect(output).not.toContain(secret);
    for (const visible of ["Shoreditch", "20:00", "2 stops", "Join the crew to see the route"]) expect(output).toContain(visible);
  });

  it("uses safe labels when the area and start time are unavailable", async () => {
    store.state.mockResolvedValue({ ok: true, plan: { ...plan, context: null, plan: { ...plan.plan, startTime: "invalid" } } });
    const output = await imageText();
    expect(output).toContain("You’re invited");
    expect(output).toContain("Time to be confirmed");
    expect(output).toContain("2 stops");
  });

  it.each(["invalid token", "store error", "unsupported plan"])('shows the generic poster for %s', async (reason) => {
    if (reason === "invalid token") store.resolve.mockResolvedValue({ ok: false });
    if (reason === "store error") store.state.mockRejectedValue(new Error("unavailable"));
    if (reason === "unsupported plan") store.state.mockResolvedValue({ ok: false });
    const output = await imageText();
    expect(output).toContain("A pub crawl planned on PUBMAXX.");
    expect(output).not.toContain("Shoreditch");
    expect(output).not.toContain("Hidden Arms");
  });
});

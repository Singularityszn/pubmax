import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { NIGHT_AREAS } from "@/lib/nightAreas";
import type { PlanState } from "@/lib/plan";
import type { PlanReadResult } from "@/lib/planStore";

// Astra F09 (6 Sep 2026): /plan carried no metadata of its own beyond a title,
// so every share of the planner unfurled as the homepage (og:url
// https://pubmaxxing.com, the site-wide title and description), and the blank
// composer was indexable.

const AREA = NIGHT_AREAS[0];
const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const planRead = vi.fn<(id: string) => Promise<PlanReadResult>>();
const vibeTally = vi.fn();

vi.mock("@/lib/planStore", () => ({
  planStore: () => ({ read: planRead }),
}));
vi.mock("@/lib/planCollaborationStore", () => ({
  planCollaborationStore: () => ({ vibeTally }),
}));

function planState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: {
      id: PLAN_ID,
      title: "Dave's stag do, SECRET ROUTE",
      startTime: "2026-07-24T19:00:00.000Z",
      createdAt: "2026-07-24T12:00:00.000Z",
      status: "ready",
      outcome: "route",
      routeReadyAt: "2026-07-24T12:00:00.000Z",
    },
    stops: [
      { venueId: "venue-the-dove", venueName: "The Dove", position: 0 },
      { venueId: "venue-the-anchor", venueName: "The Anchor", position: 1 },
    ],
    crew: [
      { id: "c1", name: "Dave" },
      { id: "c2", name: "Priya" },
    ] as PlanState["crew"],
    context: { nightArea: AREA.slug } as PlanState["context"],
    actions: [],
    ending: null,
    ...overrides,
  };
}

function findElement(node: ReactNode, target: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, target);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.type === target) return element;
  return findElement(element.props.children as ReactNode, target);
}

describe("/plan, the blank composer", () => {
  it("is noindex and follow: there is nothing here to index, and it links onward", async () => {
    const { metadata } = await import("@/app/plan/page");
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it("carries its own canonical, so the handoff variants collapse onto one address", async () => {
    const { metadata } = await import("@/app/plan/page");
    expect(metadata.alternates?.canonical).toBe("/plan");
  });

  it("says what the planner is, and never borrows the homepage card", async () => {
    const { metadata } = await import("@/app/plan/page");
    expect(metadata.openGraph?.url).toBe("/plan");
    expect(String(metadata.openGraph?.title)).toContain("Sort the outing");
    expect(String(metadata.openGraph?.title)).not.toContain("listed pint prices");
    expect(String(metadata.openGraph?.description)).toContain(
      "send one link to the crew",
    );
    expect(String(metadata.twitter?.title)).toContain("Sort the outing");
    // A route that declares its own openGraph inherits no image from the root
    // layout, so a shared planner link would unfurl bare without this.
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("/og.png");
    expect(JSON.stringify(metadata.twitter?.images)).toContain("/og.png");
  });

  it("stays out of the sitemap, because a noindex route may not be submitted", () => {
    const sitemap = readFileSync(join(process.cwd(), "app/sitemap.ts"), "utf8");
    expect(sitemap).not.toMatch(/["'`]\/plan["'`]/);
  });
});

describe("/plan/[id], the public invitation card", () => {
  beforeEach(() => {
    planRead.mockReset();
    vibeTally.mockReset();
    vibeTally.mockResolvedValue({ ok: false });
  });

  async function metadataFor(state: PlanState | null) {
    planRead.mockResolvedValue(state ? { status: "found", state } : { status: "absent" });
    const { generateMetadata } = await import("@/app/plan/[id]/page");
    return generateMetadata({
      params: Promise.resolve({ id: PLAN_ID }),
      searchParams: Promise.resolve({}),
    });
  }

  it("explains the outing to somebody with no login: the area, the stops and the time", async () => {
    const metadata = await metadataFor(planState());
    const title = String(metadata.openGraph?.title);
    const description = String(metadata.openGraph?.description);
    expect(title).toContain(AREA.name);
    expect(description).toMatch(/\b2 stops\b/);
    expect(metadata.openGraph?.url).toBe(`/plan/${PLAN_ID}`);
  });

  it("never carries the user's title, the crew or a venue", async () => {
    const metadata = await metadataFor(planState());
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain("SECRET ROUTE");
    expect(serialized).not.toContain("Dave");
    expect(serialized).not.toContain("Priya");
    expect(serialized).not.toContain("The Dove");
    expect(serialized).not.toContain("The Anchor");
  });

  it("renders only the safe fallback for a plan with no area and no route", async () => {
    const metadata = await metadataFor(
      planState({ context: null, stops: [], crew: [] }),
    );
    expect(String(metadata.openGraph?.title)).toBe("Your night out");
    expect(JSON.stringify(metadata)).not.toContain("SECRET ROUTE");
  });

  it("answers a plan that is gone without describing one", async () => {
    const metadata = await metadataFor(null);
    expect(String(metadata.title)).toContain("Plan not found");
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("is noindex and follow: one crew's night is not a search result", async () => {
    const metadata = await metadataFor(planState());
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it("passes NightCrawlMode only an explicit safe plan projection", async () => {
    const privateAnchor = "venue-private-anchor-canary";
    const privateStop = "venue-private-stop-canary";
    const privatePlanTitle = "Private plan title canary";
    const privateCrewName = "Private crew canary";
    const privateContext = "Private context canary";
    const privateAction = "private-action-canary";
    const futurePrivateField = "Future plan field canary";
    const state = planState({
      plan: {
        ...planState().plan,
        title: privatePlanTitle,
        anchorVenueId: privateAnchor,
        anchorSource: "map-search",
        routeRevision: 7,
        futurePrivateField,
      } as PlanState["plan"],
      stops: [
        { venueId: privateStop, venueName: "Private stop canary", position: 0 },
      ],
      crew: [{ id: "private-member-canary", name: privateCrewName }] as PlanState["crew"],
      context: {
        nightArea: AREA.slug,
        daypart: "evening",
        partyType: "friends",
        groupSize: 3,
        stopCount: 3,
        budget: "standard",
        budgetLimitPence: 43210,
        zeroProof: false,
        drinkCategory: "wine",
        wetherspoonsPreferred: false,
        atmosphere: [privateContext],
        foodNeeds: [],
        accessibility: [],
        transportConstraints: [],
      },
      actions: [
        {
          id: privateAction,
          type: "arrived",
          stopPosition: 0,
          ending: null,
          createdAt: "2026-07-24T19:15:00.000Z",
        },
      ],
      ending: null,
    });
    planRead.mockResolvedValue({ status: "found", state });

    const [{ default: PlanPage }, { default: NightCrawlMode }] = await Promise.all([
      import("@/app/plan/[id]/page"),
      import("@/components/plan/NightCrawlMode"),
    ]);
    const page = await PlanPage({
      params: Promise.resolve({ id: PLAN_ID }),
      searchParams: Promise.resolve({}),
    });
    const nightCrawl = findElement(page, NightCrawlMode);
    expect(nightCrawl).not.toBeNull();

    const props = nightCrawl!.props;
    const initialState = props.initialState as PlanState;
    expect(initialState.plan).toEqual({
      id: PLAN_ID,
      title: `Your night out in ${AREA.name}`,
      startTime: "2026-07-24T19:00:00.000Z",
      createdAt: "2026-07-24T12:00:00.000Z",
      routeRevision: 7,
      status: "ready",
      outcome: "route",
      routeReadyAt: "2026-07-24T12:00:00.000Z",
    });
    expect(initialState.plan).not.toHaveProperty("anchorVenueId");
    expect(initialState.plan).not.toHaveProperty("anchorSource");
    expect(initialState.stops).toEqual([]);
    expect(initialState.crew).toEqual([]);
    expect(initialState.context).toBeNull();
    expect(initialState.actions).toEqual([]);
    expect(initialState.ending).toBeNull();

    const serializedClientProps = JSON.stringify(props);
    for (const privateValue of [
      privateAnchor,
      privateStop,
      privatePlanTitle,
      privateCrewName,
      privateContext,
      privateAction,
      futurePrivateField,
    ]) {
      expect(serializedClientProps).not.toContain(privateValue);
    }
  });
});

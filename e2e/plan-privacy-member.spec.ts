import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// DAG L10 — the member side of the boundary. With friendMemberRehydrationV2 ON,
// the plan creator's capability (the HttpOnly cookie set on create, path-scoped
// to /api/plans/[id]) unlocks the FULL PlanState from the same endpoint the
// page client upgrades through — proving the privacy split never broke members.
// Self-gated: only runs when the run enables the flag.
test.skip(
  process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2 !== "1",
  "member rehydration flag off — this asserts the flag-ON member path",
);

test("a host with a valid capability sees the full route when the flag is on", async ({ request }) => {
  const venues = (await (await request.get("/data/venues_slim.json")).json() as Array<{ id: string; name: string }>).slice(0, 3);
  expect(venues.length).toBe(3);

  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Members see the route",
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      creatorName: "Host",
      stops: venues.map((v) => ({ venueId: v.id, venueName: v.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const id: string = (await created.json()).plan.plan.id;

  // Same request context keeps the HttpOnly member cookie from create, so this
  // GET carries the capability exactly like the page's client upgrade fetch.
  const body = await (await request.get(`/api/plans/${id}`)).text();
  const parsed = JSON.parse(body);
  // Member projection is the raw PlanState (no `visibility` discriminator).
  expect(parsed.visibility).toBeUndefined();
  expect(Array.isArray(parsed.stops)).toBe(true);
  expect(parsed.stops.length).toBe(3);
  expect(body).toContain(venues[0].name);
});

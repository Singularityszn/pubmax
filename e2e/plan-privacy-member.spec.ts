import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// DAG L10: the member side of the boundary, and the D01 regression.
//
// The member projection used to sit behind PUBMAX_FRIEND_MEMBER_REHYDRATION_V2,
// so this file ran only in the flag-on project and a deployment without that
// variable answered the anonymous preview to everyone: the host who had just
// locked a plan read "You've been invited" on their own plan, and a joined
// guest never saw the route (core-loop battle test, 5 Sep 2026). The flag is
// gone, so this runs in the DEFAULT suite, where no PUBMAX_* rollout variable
// is set, which is the whole point: a capability is the only question.
//
// The anonymous half stays in plan-privacy-boundary.spec.ts.

const BASE_URL = `http://localhost:${process.env.PW_PORT ?? 3100}`;

test("host and joined guest both see the route; a stranger sees the preview", async ({ request, playwright }) => {
  const venues = ((await (await request.get("/data/venues_slim.json")).json() as { rows: Array<{ id: string; name: string }> }).rows).slice(0, 3);
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

  // 1. The HOST. The same request context keeps the HttpOnly member cookie set
  //    on create, so this GET carries the capability exactly like the page's
  //    client upgrade fetch does after lock-in.
  const hostBody = await (await request.get(`/api/plans/${id}`)).text();
  const host = JSON.parse(hostBody);
  // Member projection is the raw PlanState (no `visibility` discriminator).
  expect(host.visibility).toBeUndefined();
  expect(Array.isArray(host.stops)).toBe(true);
  expect(host.stops.length).toBe(3);
  expect(hostBody).toContain(venues[0].name);
  // The host learns their own invite link, and the crew is theirs to read.
  expect(typeof host.inviteToken).toBe("string");
  expect(host.crew.map((member: { name: string }) => member.name)).toContain("Host");

  // 2. A STRANGER holding only the plan id: preview, never the route.
  const stranger = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    const strangerBody = await (await stranger.get(`/api/plans/${id}`)).text();
    expect(strangerBody).toContain('"visibility":"preview"');
    expect(strangerBody).not.toContain(venues[0].name);
    expect(strangerBody).not.toContain(venues[0].id);
    expect(strangerBody).not.toContain("Members see the route");
  } finally {
    await stranger.dispose();
  }

  // 3. A GUEST who joins with the host's invite token. The join response sets
  //    that context's own member cookie, so the next read is a member read.
  const guest = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    const joined = await guest.post(`/api/plans/${id}/join`, {
      headers: { "idempotency-key": randomUUID() },
      data: { name: "Guest", inviteToken: host.inviteToken },
    });
    expect(joined.ok()).toBe(true);

    const guestBody = await (await guest.get(`/api/plans/${id}`)).text();
    const guestState = JSON.parse(guestBody);
    expect(guestState.visibility).toBeUndefined();
    expect(guestState.stops.length).toBe(3);
    expect(guestBody).toContain(venues[0].name);
  } finally {
    await guest.dispose();
  }

  // 4. The host sees who joined.
  const afterJoin = JSON.parse(await (await request.get(`/api/plans/${id}`)).text());
  expect(afterJoin.crew.map((member: { name: string }) => member.name)).toContain("Guest");
});

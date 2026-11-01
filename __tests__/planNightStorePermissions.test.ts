import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false,
}));

import { operatePlanBeacon } from "@/lib/planBeaconStore";
import { planPresentationStore } from "@/lib/planPresentationStore";
import { __resetMemoryPlans, memoryPlanStore, recoverMemoryPlanMembership, removeMemoryPlanInviteRsvpMember } from "@/lib/planStore";

beforeEach(() => __resetMemoryPlans());
afterEach(() => vi.unstubAllEnvs());
async function night() {
  const created = await memoryPlanStore.create({ title: "Our night", creatorName: "Host", startTime: new Date().toISOString(), stops: [{ venueId: "a", venueName: "Pub a", position: 0 }] });
  if (!created.ok) throw new Error("Cannot create Plan");
  const id = created.plan.plan.id;
  const joined = await memoryPlanStore.join(id, "Guest", { collaborationAuthorized: true, userId: "guest-account" });
  if (!joined.ok) throw new Error("Cannot join Plan");
  const arrival = await memoryPlanStore.addAction(id, created.memberToken, { type: "arrived", stopPosition: 0, expectedRouteRevision: 1, venueId: "a", idempotencyKey: "our-arrival" });
  if (!arrival.ok) throw new Error("Cannot record arrival");
  const input = { symbol: "star", note: "By the window", expectedRouteRevision: 1, expectedArrivalId: arrival.plan.actions![0]!.id };
  return { id, host: created.memberToken, guest: joined.memberToken, guestId: joined.plan.crew.find((member) => member.name === "Guest")!.id, input };
}

it("refuses all new store operations in production without durable storage", async () => {
  const n = await night();
  const before = await memoryPlanStore.get(n.id);
  vi.stubEnv("VERCEL_ENV", "production");
  for (const operation of ["read", "set", "clear"] as const) {
    expect(await operatePlanBeacon(n.id, n.host, operation, n.input)).toEqual({ ok: false, error: "unavailable" });
  }
  expect(await planPresentationStore.read(n.id, n.host)).toEqual({ ok: false, error: "error" });
  expect(await planPresentationStore.set(n.id, n.host, { mysteryEnabled: true, expectedRouteRevision: 1 })).toEqual({ ok: false, error: "error" });
  vi.unstubAllEnvs();
  expect(await memoryPlanStore.get(n.id)).toEqual(before);
  expect(await operatePlanBeacon(n.id, n.host, "read")).toMatchObject({ ok: true, view: { beacon: null } });
  expect(await planPresentationStore.read(n.id, n.host)).toMatchObject({ ok: true, mysteryEnabled: false });
});

it("admits member reads, reserves changes for the host, and rejects revoked or rotated capabilities", async () => {
  const n = await night();
  expect(await operatePlanBeacon(n.id, n.host, "set", n.input)).toMatchObject({ ok: true });
  expect(await planPresentationStore.set(n.id, n.host, { mysteryEnabled: true, expectedRouteRevision: 1 })).toMatchObject({ ok: true });
  expect(await operatePlanBeacon(n.id, n.guest, "read")).toMatchObject({ ok: true, view: { canEdit: false, beacon: { note: "By the window" } } });
  expect(await planPresentationStore.read(n.id, n.guest)).toMatchObject({ ok: true, canEdit: false, mysteryEnabled: true });
  for (const token of [n.guest, "stranger"]) {
    expect((await operatePlanBeacon(n.id, token, "set", n.input)).ok).toBe(false);
    expect((await operatePlanBeacon(n.id, token, "clear", n.input)).ok).toBe(false);
    expect((await planPresentationStore.set(n.id, token, { mysteryEnabled: false, expectedRouteRevision: 1 })).ok).toBe(false);
  }
  expect((await operatePlanBeacon(n.id, "stranger", "read")).ok).toBe(false);
  expect((await planPresentationStore.read(n.id, "stranger")).ok).toBe(false);
  expect(recoverMemoryPlanMembership(n.id, "guest-account", "new-capability")).not.toBeNull();
  expect((await operatePlanBeacon(n.id, n.guest, "read")).ok).toBe(false);
  expect((await planPresentationStore.read(n.id, n.guest)).ok).toBe(false);
  expect((await operatePlanBeacon(n.id, "new-capability", "read")).ok).toBe(true);
  expect((await planPresentationStore.read(n.id, "new-capability")).ok).toBe(true);
  expect(removeMemoryPlanInviteRsvpMember(n.id, n.guestId)).toBe(true);
  expect((await operatePlanBeacon(n.id, "new-capability", "read")).ok).toBe(false);
  expect((await planPresentationStore.read(n.id, "new-capability")).ok).toBe(false);
  expect(await planPresentationStore.read(n.id, n.host)).toMatchObject({ ok: true, mysteryEnabled: true });
  expect(await operatePlanBeacon(n.id, n.host, "read")).toMatchObject({ ok: true, view: { beacon: { note: "By the window" } } });
});

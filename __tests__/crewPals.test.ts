import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { GET } from "@/app/api/plans/[id]/pals/route";
import { CREW_PALS_MAX, crewPalLook, crewPalsFromBody } from "@/lib/crewPals";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { claimPlanMembership } from "@/lib/planCrewIdentity";
import { __resetMemoryPlans, memoryPlanStore, planMemberIdentity } from "@/lib/planStore";
import {
  __resetPubPalStore,
  createPubPalResult,
  getPubPalResult,
  listCrewVisiblePalsResult,
  updatePubPalResult,
} from "@/lib/pubPalStore";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function palFor(ownerId: string, name: string, controls: { crewVisible?: boolean; hidden?: boolean } = {}) {
  const created = await createPubPalResult(ownerId, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name, hidden: controls.hidden === true });
  if (!created.ok) throw new Error("pal");
  if (controls.crewVisible) await updatePubPalResult(ownerId, { crewVisible: true });
}

async function crewPlan() {
  const created = await memoryPlanStore.create({
    title: "A night together",
    creatorName: "Host",
    startTime: new Date(Date.now() + 7_200_000).toISOString(),
    stops: [{ venueId: "venue-1f5ygjb", venueName: "The Crown" }, { venueId: "venue-xjf3n0", venueName: "The Lamb" }],
  }, { idempotencyKey: crypto.randomUUID() });
  if (!created.ok) throw new Error(created.error);
  const planId = created.plan.plan.id;
  const host = await planMemberIdentity(planId, created.memberToken);
  expect(await claimPlanMembership(planId, host!.memberId, "user-host")).toBe("claimed");
  const tokens: Record<string, string> = { host: created.memberToken };
  for (const [key, userId] of [["mate", "user-mate"], ["shy", "user-shy"], ["hider", "user-hider"], ["guest", ""]] as const) {
    const joined = await memoryPlanStore.join(planId, key, {
      idempotencyKey: crypto.randomUUID(),
      ...(userId ? { userId } : {}),
    });
    if (!joined.ok) throw new Error(joined.error);
    tokens[key] = joined.memberToken;
  }
  return { planId, tokens };
}

function read(planId: string, token?: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/plans/${planId}/pals`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }), ctx(planId));
}

beforeEach(() => {
  __resetMemoryPlans();
  __resetPubPalStore();
});

describe("a Pal its owner shows to the crew", () => {
  it("is private until the owner turns it on, and the owner can turn it off again", async () => {
    await palFor("user-a", "Ripley");
    expect((await getPubPalResult("user-a")).ok && (await getPubPalResult("user-a") as { value: { crewVisible?: boolean } }).value.crewVisible).toBe(false);
    expect((await listCrewVisiblePalsResult(["user-a"]))).toEqual({ ok: true, value: [] });

    const on = await updatePubPalResult("user-a", { crewVisible: true });
    expect(on.ok && on.value.crewVisible).toBe(true);
    const listed = await listCrewVisiblePalsResult(["user-a"]);
    expect(listed.ok && listed.value.map((pal) => pal.name)).toEqual(["Ripley"]);

    const off = await updatePubPalResult("user-a", { crewVisible: false });
    expect(off.ok && off.value.crewVisible).toBe(false);
    expect(await listCrewVisiblePalsResult(["user-a"])).toEqual({ ok: true, value: [] });
  });

  it("never lists a Pal its owner hid, even when shown to the crew", async () => {
    await palFor("user-b", "Moss", { crewVisible: true, hidden: true });
    expect(await listCrewVisiblePalsResult(["user-b"])).toEqual({ ok: true, value: [] });
  });

  it("keeps other settings when the crew choice changes", async () => {
    await palFor("user-c", "Fen");
    await updatePubPalResult("user-c", { muted: true });
    const on = await updatePubPalResult("user-c", { crewVisible: true });
    expect(on.ok && on.value.muted).toBe(true);
  });
});

describe("GET /api/plans/[id]/pals", () => {
  it("shows a member the other members' opted-in Pals, and never an owner", async () => {
    const { planId, tokens } = await crewPlan();
    await palFor("user-host", "Hostie", { crewVisible: true });
    await palFor("user-mate", "Ripley", { crewVisible: true });
    await palFor("user-shy", "Shy");
    await palFor("user-hider", "Ghost", { crewVisible: true, hidden: true });

    const response = await read(planId, tokens.guest);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    const text = await response.text();
    const body = JSON.parse(text) as { visibility: string; pals: Array<Record<string, unknown>> };
    expect(body.visibility).toBe("member");
    expect(body.pals.map((pal) => pal.name)).toEqual(["Hostie", "Ripley"]);
    expect(Object.keys(body.pals[0]!).sort()).toEqual(["id", "muted", "name", "personality", "species"]);
    expect(text).not.toMatch(/user-|ownerId|owner_id|memberId|handle/);
  });

  it("never sends a member their own Pal", async () => {
    const { planId, tokens } = await crewPlan();
    await palFor("user-mate", "Ripley", { crewVisible: true });
    const body = await (await read(planId, tokens.mate)).json() as { pals: Array<{ name: string }> };
    expect(body.pals).toEqual([]);
  });

  it("tells anyone without the plan's member capability nothing about the crew", async () => {
    const { planId } = await crewPlan();
    await palFor("user-mate", "Ripley", { crewVisible: true });
    expect(await (await read(planId)).json()).toEqual({ visibility: "preview" });
    expect(await (await read(planId, "not-a-member-token")).json()).toEqual({ visibility: "preview" });
    expect((await read("not-a-plan", "x")).status).toBe(404);
  });
});

describe("the crew Pals the map reads", () => {
  it("reads a member answer and drops anything malformed", () => {
    const good = { id: "p1", name: " Ripley ", species: "robin", personality: DEFAULT_PAL_DRAFT.personality, muted: true };
    expect(crewPalsFromBody({ visibility: "preview" })).toEqual([]);
    expect(crewPalsFromBody(null)).toEqual([]);
    expect(crewPalsFromBody({ visibility: "member", pals: [good, { id: "", name: "x" }, { ...good, species: "dragon" }, "nope"] })).toEqual([
      { id: "p1", name: "Ripley", species: "robin", personality: DEFAULT_PAL_DRAFT.personality, muted: true },
    ]);
  });

  it("draws at most a handful beside the reader's own", () => {
    const pals = Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, name: `Pal ${index}`, species: "fox", personality: DEFAULT_PAL_DRAFT.personality }));
    expect(crewPalsFromBody({ visibility: "member", pals })).toHaveLength(CREW_PALS_MAX);
  });

  it("hands the marker the Pal's look and nothing else", () => {
    const [pal] = crewPalsFromBody({ visibility: "member", pals: [{ id: "p1", name: "Ripley", species: "robin", personality: DEFAULT_PAL_DRAFT.personality }] });
    expect(crewPalLook(pal!)).toEqual({ id: "p1", personality: DEFAULT_PAL_DRAFT.personality, muted: false, appearance: { species: "robin" } });
  });
});

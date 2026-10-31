// Review finding P2 (PR 2402): the kitchen read prints "Kitchen open, said
// @handle" with the reporter's CURRENT handle. Like the regular-nights read
// (__tests__/regularNightReportsWithdrawal.test.ts), it must follow the public
// withdrawal boundary (lib/accountPublicAccess.server.ts): a suspended, banned
// or deleted reporter's reading is dropped, and a check that cannot answer
// shows no reading at all. The GET read and the POST confirmer reply both pass
// through the same projection, so both are covered here.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const ALICE = "a1111111-1111-4111-8111-111111111111";
const BOB = "b2222222-2222-4222-8222-222222222222";

type Resolution = import("@/lib/contributionIdentity.server").ContributionIdentityResolution;

const identityState = vi.hoisted(() => ({
  resolution: null as unknown as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));
vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => identityState.resolution,
}));
vi.mock("@/lib/venueWriteTarget.server", () => ({
  resolveWritableVenueId: async (venueId: string) => ({ ok: true, venueId }),
}));
vi.mock("@/lib/venueAliases", () => ({
  resolveCanonicalVenueId: async (id: string) => id,
}));

const access = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/accountPublicAccess.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accountPublicAccess.server")>();
  return {
    ...actual,
    withdrawnHandles: async (handles: readonly string[]) => {
      if (access.unavailable) throw new Error("public_withdrawn_profiles unavailable");
      return actual.withdrawnHandles(handles);
    },
  };
});

import { GET, POST } from "@/app/api/kitchen-reports/route";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryAuthUserBanned,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetKitchenReports } from "@/lib/kitchenReportsStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryProfiles, __tombstoneMemoryProfile, profileStore } from "@/lib/profileStore";

const SIGNED_IN_ALICE: Resolution = { ok: true, accountId: ALICE, actor: "profile:alice", handle: "alice" };
const SIGNED_IN_BOB: Resolution = { ok: true, accountId: BOB, actor: "profile:bob", handle: "bob" };

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function tap(state: "open" | "closed"): Request {
  return new Request("http://localhost/api/kitchen-reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ venueId: "venue-crown", state }),
  });
}

function read(): Request {
  return new Request("http://localhost/api/kitchen-reports?venueId=venue-crown", {
    headers: { "x-forwarded-for": nextIp() },
  });
}

async function readReport(): Promise<Record<string, unknown> | null> {
  const response = await GET(read());
  expect(response.status).toBe(200);
  return ((await response.json()) as { report: Record<string, unknown> | null }).report;
}

/** Bob confirms Alice's open reading; answers the confirmer's reply body. */
async function bobConfirms(): Promise<{ outcome: string; report: Record<string, unknown> | null }> {
  identityState.resolution = SIGNED_IN_BOB;
  const response = await POST(tap("open"));
  expect(response.status).toBe(200);
  return (await response.json()) as { outcome: string; report: Record<string, unknown> | null };
}

let aliceProfileId = "";

beforeEach(async () => {
  vi.restoreAllMocks();
  access.unavailable = false;
  __resetKitchenReports();
  __resetPintDrops();
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  aliceProfileId = (await profileStore().createOwned("alice", ALICE)).id;
  await profileStore().createOwned("bob", BOB);
  identityState.resolution = SIGNED_IN_ALICE;
  expect((await POST(tap("open"))).status).toBe(200);
});

describe("the kitchen read and a withdrawn reporter", () => {
  it("prints the reading with the reporter's handle while the account is in good standing", async () => {
    expect(await readReport()).toMatchObject({ state: "open", handle: "alice", confirmed: false });
    const reply = await bobConfirms();
    expect(reply.outcome).toBe("confirmed");
    expect(reply.report).toMatchObject({ handle: "alice", confirmed: true });
  });

  it("drops the reading once the reporter's Social account is suspended, on GET and the confirmer reply", async () => {
    expect((await readReport())?.handle).toBe("alice");
    __setMemoryProfileWithdrawn(aliceProfileId, true);
    expect(await readReport()).toBeNull();
    const reply = await bobConfirms();
    expect(reply.outcome).toBe("confirmed");
    expect(reply.report).toBeNull();
    expect(JSON.stringify(reply)).not.toContain("alice");
  });

  it("drops the reading once the reporter's auth account is banned, on GET and the confirmer reply", async () => {
    expect((await readReport())?.handle).toBe("alice");
    __setMemoryAuthUserBanned(ALICE, true);
    expect(await readReport()).toBeNull();
    const reply = await bobConfirms();
    expect(reply.report).toBeNull();
  });

  it("drops a tombstoned reporter's reading, on GET and the confirmer reply", async () => {
    expect((await readReport())?.handle).toBe("alice");
    __tombstoneMemoryProfile("alice");
    expect(await readReport()).toBeNull();
    expect((await bobConfirms()).report).toBeNull();
  });

  it("drops a soft-deleted reporter whose row still carries the account id", async () => {
    // The deletion trigger stamps tombstoned_at; the row can still name the
    // account until the foreign key clears it. A stamped row is never printed.
    const store = profileStore();
    const alice = await store.getByUserId(ALICE);
    if (!alice) throw new Error("alice profile missing");
    const soft = { ...alice, tombstonedAt: new Date().toISOString() };
    vi.spyOn(store, "getByUserId").mockImplementation(async (userId) => (userId === ALICE ? soft : null));
    vi.spyOn(store, "getHandleByUserId").mockImplementation(async (userId) => (userId === ALICE ? "alice" : null));
    expect(await readReport()).toBeNull();
    expect((await bobConfirms()).report).toBeNull();
  });

  it("fails closed: an access check that throws shows no reading, on GET and the confirmer reply", async () => {
    access.unavailable = true;
    expect(await readReport()).toBeNull();
    const reply = await bobConfirms();
    expect(reply.outcome).toBe("confirmed");
    expect(reply.report).toBeNull();
    expect(JSON.stringify(reply)).not.toContain("alice");
  });
});

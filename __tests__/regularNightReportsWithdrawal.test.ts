// Review finding 7 (PR 2402): the anonymous regular-nights read prints an
// open report with its reporter's CURRENT handle. That read must follow the
// same public-withdrawal boundary as every other public read
// (lib/accountPublicAccess.server.ts): a suspended or auth-banned reporter's
// handle never reaches a stranger, and a boundary that cannot answer fails
// closed. A confirmed row carries no handle, so it is unaffected.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
vi.mock("@/lib/venueIndex", () => ({ resolveStoredVenue: async () => ({ name: "The Crown" }) }));

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

import {
  __resetMemoryProfileWithdrawals,
  __setMemoryAuthUserBanned,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";
import type { RegularNightReport } from "@/lib/regularNightReports";
import { publicRegularNightReports } from "@/lib/regularNightReports.server";

const ALICE = "a1111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-10-30T18:00:00.000Z");

function report(id: string, status: RegularNightReport["status"] = "open"): RegularNightReport {
  return {
    id,
    venueId: "venue-crown",
    kind: "quiz",
    weekday: 2,
    startTime: "20:00",
    note: "Teams of six.",
    photoKey: `regular-nights/${id}.jpg`,
    reporterUserId: ALICE,
    status,
    createdAt: new Date(T0).toISOString(),
    lastSeenAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + 90 * 24 * 60 * 60 * 1000).toISOString(),
    confirmedBy: status === "confirmed" ? "admin" : null,
    confirmedAt: status === "confirmed" ? new Date(T0).toISOString() : null,
  };
}

let aliceProfileId = "";

beforeEach(async () => {
  access.unavailable = false;
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  aliceProfileId = (await profileStore().createOwned("alice", ALICE)).id;
});

describe("the public regular-nights read and a withdrawn reporter", () => {
  it("prints an open report with its reporter's handle while the account is in good standing", async () => {
    const rows = await publicRegularNightReports([report("r1")], T0);
    expect(rows.map((row) => [row.id, row.handle])).toEqual([["r1", "alice"]]);
  });

  it("drops the open report once the reporter's Social account is suspended", async () => {
    expect((await publicRegularNightReports([report("r1")], T0)).map((row) => row.handle)).toEqual(["alice"]);
    __setMemoryProfileWithdrawn(aliceProfileId, true);
    const rows = await publicRegularNightReports([report("r1"), report("r2", "confirmed")], T0);
    expect(rows.map((row) => row.id)).toEqual(["r2"]);
    expect(JSON.stringify(rows)).not.toContain("alice");
  });

  it("drops the open report once the reporter's auth account is banned", async () => {
    expect((await publicRegularNightReports([report("r1")], T0)).map((row) => row.handle)).toEqual(["alice"]);
    __setMemoryAuthUserBanned(ALICE, true);
    const rows = await publicRegularNightReports([report("r1")], T0);
    expect(rows).toEqual([]);
  });

  it("fails closed: an unavailable access check prints no handle at all", async () => {
    access.unavailable = true;
    const rows = await publicRegularNightReports([report("r1"), report("r2", "confirmed")], T0);
    expect(rows.map((row) => row.id)).toEqual(["r2"]);
    expect(JSON.stringify(rows)).not.toContain("alice");
  });
});

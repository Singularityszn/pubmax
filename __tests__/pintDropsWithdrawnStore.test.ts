// The Supabase Pint Drop store is the seam every server-rendered venue surface
// reads (the ledger and bar-tab pages pick it directly), so withdrawal is
// proved here against its public reads: a withdrawn author's named and
// anonymous drops leave the venue read and the legacy lane, while the author's
// own read (the account export) keeps them whole.

import { afterEach, describe, expect, it, vi } from "vitest";

const table = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/storeBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storeBackend")>();
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order", "limit"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: table.rows, error: null }).then(resolve, reject);
  return { ...actual, admin: () => ({ from: () => chain }) };
});

import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { supabasePintDropStore } from "@/lib/pintDropsStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

function row(id: string, handle: string, visibility: string): Record<string, unknown> {
  return {
    id,
    venue_id: "withdrawal-test-venue",
    handle,
    drink: "",
    price_gbp: 4.2,
    passed_down_note: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  __resetMemoryProfileWithdrawals();
  __resetMemoryProfiles();
  table.rows = [];
});

describe("supabasePintDropStore withdrawal", () => {
  it("withholds a withdrawn author's named and anonymous drops from venue reads", async () => {
    __setMemoryProfileWithdrawn(__seedMemoryOwnedProfile("karansdad", "user-karansdad").id, true);
    table.rows = [
      row("named", "karansdad", "public"),
      row("anon", "karansdad", "anonymous"),
      row("alice", "alice", "public"),
    ];

    const venue = await supabasePintDropStore.listVisible("withdrawal-test-venue");
    expect(venue.map((drop) => drop.id)).toEqual(["alice"]);

    table.rows = [row("legacy-named", "karansdad", "legacy"), row("legacy-alice", "alice", "legacy")];
    const legacy = await supabasePintDropStore.listLegacyForVenue("withdrawal-test-venue");
    expect(legacy.map((drop) => drop.id)).toEqual(["legacy-alice"]);
  });

  it("keeps the withdrawn author's own drops in their export read", async () => {
    __setMemoryProfileWithdrawn(__seedMemoryOwnedProfile("karansdad", "user-karansdad").id, true);
    table.rows = [row("named", "karansdad", "public"), row("anon", "karansdad", "anonymous")];

    const own = await supabasePintDropStore.listVisible(
      "withdrawal-test-venue",
      { handle: "karansdad" },
      "karansdad",
    );
    expect(own.map((drop) => drop.id).sort()).toEqual(["anon", "named"]);
  });
});

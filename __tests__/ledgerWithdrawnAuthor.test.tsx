// The server-rendered Ledger reads a venue's drops straight from the Pint Drop
// store, not through /api/pint-drops. Withdrawal lives at that store seam, so
// a withdrawn author's drops must never reach the rendered page, while the
// rest of the venue's ledger renders as before.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import LedgerPage from "@/app/ledger/[id]/page";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const rows = JSON.parse(
  readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8"),
) as VenuePrice[];
const venue = defined(groupVenuePrices(rows)[0]);

function drop(id: string, handle: string) {
  return {
    id,
    venueId: venue.id,
    handle,
    drink: "",
    priceGbp: 4.2,
    passedDownNote: `note from ${handle}`,
    era: "",
    provenance: "contributor" as const,
    status: "visible" as const,
    createdAt: "2026-09-01T20:00:00.000Z",
  };
}

async function renderLedger(): Promise<string> {
  const element = await LedgerPage({ params: Promise.resolve({ id: venue.id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

afterEach(() => {
  __resetMemoryProfileWithdrawals();
  __resetMemoryProfiles();
  __resetPintDrops();
});

describe("the Ledger page and a withdrawn author", () => {
  it("renders the venue's other drops and never the withdrawn author's", async () => {
    addPintDrop(drop("drop-alice", "ledger_alice"));
    addPintDrop(drop("drop-karansdad", "karansdad"));

    const before = await renderLedger();
    expect(before).toContain("ledger_alice");
    expect(before).toContain("karansdad");

    __setMemoryProfileWithdrawn(__seedMemoryOwnedProfile("karansdad", "user-karansdad").id, true);
    const after = await renderLedger();
    expect(after).toContain("ledger_alice");
    expect(after).not.toContain("karansdad");
  });
});

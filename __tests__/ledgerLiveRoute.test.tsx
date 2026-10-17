// The Ledger's live half (task vercel-f2-seo-cdn, option a). The /ledger/[id]
// document is prerendered and held by the CDN, so nothing a drinker wrote may
// be in it; GET /api/ledger/[id] reads the logbook, the drop-derived story lines
// and the Family Table per request instead. Withdrawal still lives at the Pint
// Drop store seam, so a withdrawn author's drops never reach the route's
// answer, while the rest of the venue's ledger answers as before. The Family
// Table opens in full only to its own author.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import { GET } from "@/app/api/ledger/[id]/route";
import LedgerPage from "@/app/ledger/[id]/page";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import type { LedgerLog } from "@/lib/ledgerLog.server";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const rows = JSON.parse(
  readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8"),
) as VenuePrice[];
const venue = defined(groupVenuePrices(rows)[0]);

function drop(id: string, handle: string, extra: Partial<PintDrop> = {}): PintDrop {
  return {
    id,
    venueId: venue.id,
    handle,
    drink: "",
    priceGbp: 4.2,
    passedDownNote: `note from ${handle}`,
    era: "",
    provenance: "contributor",
    status: "visible",
    createdAt: "2026-09-01T20:00:00.000Z",
    ...extra,
  };
}

async function readLedger(id: string, query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/ledger/${encodeURIComponent(id)}${query}`), {
    params: Promise.resolve({ id }),
  });
}

async function readLog(query = ""): Promise<LedgerLog> {
  const res = await readLedger(venue.id, query);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toMatch(/no-store/);
  return (await res.json()) as LedgerLog;
}

async function renderDocument(): Promise<string> {
  const element = await LedgerPage({ params: Promise.resolve({ id: venue.id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

afterEach(() => {
  __resetMemoryProfileWithdrawals();
  __resetMemoryProfiles();
  __resetPintDrops();
});

describe("GET /api/ledger/[id] and a withdrawn author", () => {
  it("answers the venue's other drops and never the withdrawn author's", async () => {
    addPintDrop(drop("drop-alice", "ledger_alice"));
    addPintDrop(drop("drop-karansdad", "karansdad"));

    const before = JSON.stringify(await readLog());
    expect(before).toContain("ledger_alice");
    expect(before).toContain("karansdad");

    __setMemoryProfileWithdrawn(__seedMemoryOwnedProfile("karansdad", "user-karansdad").id, true);
    const after = JSON.stringify(await readLog());
    expect(after).toContain("ledger_alice");
    expect(after).not.toContain("karansdad");
  });
});

describe("GET /api/ledger/[id]", () => {
  it("puts public drops in the logbook and the story, and legacy drops only at the Family Table", async () => {
    addPintDrop(drop("drop-public", "ledger_alice"));
    addPintDrop(
      drop("drop-legacy", "grandad_bert", {
        visibility: "legacy",
        passedDownNote: "Grandad proposed here in 1962.",
      }),
    );

    const log = await readLog();
    expect(log.entries.map((entry) => entry.id)).toEqual(["drop-public"]);
    expect(JSON.stringify(log.claims)).toContain("note from ledger_alice");
    expect(JSON.stringify(log.claims)).not.toContain("1962");
    expect(log.familyEntries).toHaveLength(1);
  });

  it("redacts the Family Table for a stranger and opens it to its own author", async () => {
    addPintDrop(
      drop("drop-legacy", "grandad_bert", {
        visibility: "legacy",
        passedDownNote: "Grandad proposed here in 1962.",
      }),
    );

    const stranger = JSON.stringify((await readLog()).familyEntries);
    expect(stranger).not.toContain("1962");
    expect(stranger).not.toContain("grandad_bert");

    // ?viewer= is the dev/test stand-in for the bearer token
    // (lib/pintDropViewer.ts); production resolves the handle from the JWT.
    const author = JSON.stringify((await readLog("?viewer=grandad_bert")).familyEntries);
    expect(author).toContain("1962");
  });

  it("answers 404 in the error envelope for an id that is not a pub", async () => {
    const res = await readLedger("venue-does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the cached Ledger document", () => {
  it("carries the pub and none of the drinkers' words, public or legacy", async () => {
    addPintDrop(drop("drop-public", "ledger_alice"));
    addPintDrop(
      drop("drop-legacy", "grandad_bert", {
        visibility: "legacy",
        passedDownNote: "Grandad proposed here in 1962.",
      }),
    );

    const markup = await renderDocument();
    expect(markup).toContain(venue.name);
    expect(markup).toContain("Opening the logbook.");
    expect(markup).not.toContain("ledger_alice");
    expect(markup).not.toContain("grandad_bert");
    expect(markup).not.toContain("1962");
  });
});

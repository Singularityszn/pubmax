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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import { GET } from "@/app/api/ledger/[id]/route";
import { GET as readPintDrops } from "@/app/api/pint-drops/route";
import { GET as readVenue } from "@/app/api/venue/[id]/route";
import LedgerPage from "@/app/ledger/[id]/page";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import type { LedgerLog } from "@/lib/ledgerLog.server";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
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

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T16:00:00Z"));
});

afterEach(() => {
  vi.restoreAllMocks();
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
  it("uses the same refreshed Small Beer menu row as the venue sheet", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T18:00:00Z"));
    const id = "venue-19mn6ss";
    const response = await readLedger(id);
    const sheet = await readVenue(new Request(`http://localhost/api/venue/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(sheet.status).toBe(200);
    const body = await response.json();
    const sheetBody = await sheet.json();
    expect(sheetBody.venue.bundlePrices.listed).toEqual({
      priceGbp: 5, sourceUrl: "https://www.smallbeern8.co.uk/drinks", observedAt: "2026-10-23T16:15:47.970Z",
    });
    expect(body.priceRecord).toMatchObject({
      lane: { lane: "listed", listed: sheetBody.venue.bundlePrices.listed },
      drinkName: "Session IPA , 4.0%, Two by Two (Newcastle)",
      publisher: "smallbeern8.co.uk",
      reads: { bundle: "ready", sourced: "ready" },
    });
  });

  it("returns the public pint report that the sheet uses, with its original source and date", async () => {
    addPintDrop(drop("hatton-price", "ledger_alice", {
      venueId: "venue-1vle947", drink: "Lager", measure: "pint", priceGbp: 4.7,
      createdAt: "2026-09-06T01:22:18.585Z",
    }));
    const response = await readLedger("venue-1vle947");
    expect(await response.json()).toMatchObject({
      pintPrice: {
        dropId: "hatton-price", drink: "Lager", measure: "pint", priceGbp: 4.7,
        createdAt: "2026-09-06T01:22:18.585Z", handle: "ledger_alice", state: "aged-out",
      },
      priceRecord: { lane: { lane: "aged", agedPrice: 4.7 } },
    });
  });

  it.each(["venue-1vle947", venue.id, defined(groupVenuePrices(rows)[1]).id])(
    "selects the latest valid public pint at %s and keeps its source timestamp",
    async (venueId) => {
      const latest = "2026-10-22T23:30:00Z";
      for (const item of [
        drop("older", "older_drinker", { venueId, drink: "Lager", priceGbp: 4.1, createdAt: "2026-08-01T12:00:00Z" }),
        drop("latest", "latest_drinker", { venueId, drink: "Lager", priceGbp: 5.2, createdAt: latest }),
        drop("half", "half_drinker", { venueId, drink: "Lager", measure: "half", priceGbp: 2.6, createdAt: "2026-10-23T12:00:00Z" }),
        drop("other", "other_drinker", { venueId, drink: "Wine", measure: "other", measureLabel: "175 ml", priceGbp: 8, createdAt: "2026-10-23T12:00:00Z" }),
        drop("future", "future_drinker", { venueId, priceGbp: 8, createdAt: "2099-10-23T12:00:00Z" }),
        drop("invalid", "invalid_drinker", { venueId, priceGbp: 7, createdAt: "unknown" }),
        drop("private", "private_drinker", { venueId, visibility: "friends", priceGbp: 9, createdAt: "2026-10-23T12:00:00Z" }),
        drop("hidden", "hidden_drinker", { venueId, status: "hidden", priceGbp: 9, createdAt: "2026-10-23T12:00:00Z" }),
        drop("demo", "demo_drinker", { venueId, provenance: "demo", priceGbp: 9, createdAt: "2026-10-23T12:00:00Z" }),
      ]) addPintDrop(item);
      const publicResponse = await readPintDrops(new Request(`http://localhost/api/pint-drops?venueId=${venueId}`));
      expect(publicResponse.status).toBe(200);
      const publicBody = await publicResponse.json();
      expect(publicBody.drops).toEqual(expect.arrayContaining([expect.objectContaining({
        id: "latest", priceGbp: 5.2, drink: "Lager", createdAt: latest,
      })]));
      const response = await readLedger(venueId);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({ pintPrice: {
        dropId: "latest", priceGbp: 5.2, drink: "Lager", measure: "pint",
        createdAt: latest, handle: "latest_drinker", state: "logged-once",
      } });
    },
  );

  it("does not invent a pint price from a half, a private report, or an invalid date", async () => {
    addPintDrop(drop("half-only", "half_drinker", { measure: "half" }));
    addPintDrop(drop("private-only", "private_drinker", { visibility: "friends" }));
    addPintDrop(drop("bad-date", "bad_date_drinker", { createdAt: "unknown" }));
    expect((await readLog()).pintPrice).toBeNull();
  });

  it("withholds a single figure when current reports disagree", async () => {
    addPintDrop(drop("split-a", "alice", { drink: "Lager", priceGbp: 4.5, createdAt: "2026-10-22T19:00:00Z" }));
    addPintDrop(drop("split-b", "bert", { drink: "Lager", priceGbp: 4.7, createdAt: "2026-10-22T20:00:00Z" }));
    expect((await readLog()).pintPrice).toMatchObject({ state: "disputed", priceGbp: null, split: { prices: [4.5, 4.7], reporters: 2 } });
  });

  it.each([venue.id, defined(groupVenuePrices(rows)[1]).id])(
    "keeps a corroborated public price and its timestamp ahead of published inputs at %s",
    async (venueId) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T18:00:00Z"));
      addPintDrop(drop("first-paid", "alice", { venueId, drink: "Lager", priceGbp: 6, authorityKey: "independent-alice", createdAt: "2026-10-23T16:00:00Z" }));
      addPintDrop(drop("second-paid", "bert", { venueId, drink: "Lager", priceGbp: 6, authorityKey: "independent-bert", createdAt: "2026-10-23T17:00:00Z" }));
      const response = await readLedger(venueId);
      expect(await response.json()).toMatchObject({
        pintPrice: { priceGbp: 6, state: "corroborated", createdAt: "2026-10-23T17:00:00Z" },
        priceRecord: { lane: { lane: "contributor", contributorPrice: 6 } },
      });
    },
  );

  it("never derives its selected lane from private, non-pint or future reports", async () => {
    addPintDrop(drop("future-pair-a", "alice", { priceGbp: 9.99, authorityKey: "alice", createdAt: "2099-10-23T16:00:00Z" }));
    addPintDrop(drop("future-pair-b", "bert", { priceGbp: 9.99, authorityKey: "bert", createdAt: "2099-10-23T16:00:00Z" }));
    addPintDrop(drop("private-pair-a", "alice", { priceGbp: 9.99, authorityKey: "alice", visibility: "friends" }));
    addPintDrop(drop("private-pair-b", "bert", { priceGbp: 9.99, authorityKey: "bert", visibility: "friends" }));
    addPintDrop(drop("half-pair-a", "alice", { priceGbp: 9.99, authorityKey: "alice", measure: "half" }));
    addPintDrop(drop("half-pair-b", "bert", { priceGbp: 9.99, authorityKey: "bert", measure: "half" }));
    const body = await readLog();
    expect(body.pintPrice).toBeNull();
    expect(body.priceRecord.lane?.lane).not.toBe("contributor");
    expect(JSON.stringify(body.priceRecord)).not.toContain("9.99");
  });

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

  it("answers a retryable 503 in the error envelope when the logbook read fails", async () => {
    vi.spyOn(memoryPintDropStore, "listLegacyForVenue").mockRejectedValueOnce(
      new Error("store unreachable"),
    );
    const res = await readLedger(venue.id);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
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

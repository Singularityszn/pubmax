import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  type AnchorSourceHead,
  applyVerification,
  idsCoveredByPartialVerifications,
  parseVerificationLimit,
  remainingBatchSize,
  selectVerificationBatch,
  summarizeVerification,
  verifyRowWithPlaces,
} from "@/scripts/verify_famous_venues.mjs";

type Row = { id: string; name: string; observedAt: string; expiresAt: string };

const row = (id: string): Row => ({
  id,
  name: id,
  observedAt: "2026-08-25",
  expiresAt: "2026-09-24",
});

describe("verify:famous-venues --write plan", () => {
  it("re-stamps confirmed rows, drops closed rows and keeps unverified rows unchanged", () => {
    const packs = new Map([
      ["bars.json", [row("bar-open"), row("bar-closed"), row("bar-timeout")]],
      ["late_food.json", [row("food-429")]],
    ]);

    const next = applyVerification(
      packs,
      [
        { id: "bar-open", outcome: "confirmed" },
        { id: "bar-closed", outcome: "closed" },
        { id: "bar-timeout", outcome: "unverified" },
        { id: "food-429", outcome: "unverified" },
      ],
      "2026-09-24",
    );

    expect(next.get("bars.json")).toEqual([
      { ...row("bar-open"), observedAt: "2026-09-24", expiresAt: "2026-10-24" },
      row("bar-timeout"),
    ]);
    expect(next.get("late_food.json")).toEqual([row("food-429")]);
  });

  it("buckets checks by outcome, counting confirmed rows and listing closed and unverified ids", () => {
    expect(
      summarizeVerification([
        { id: "bar-operational", outcome: "confirmed" },
        { id: "food-operational", outcome: "confirmed" },
        { id: "bar-no-confident-match", outcome: "unverified" },
        { id: "bar-closed", outcome: "closed" },
      ]),
    ).toEqual({
      rowsChecked: 4,
      confirmed: 2,
      closed: ["bar-closed"],
      unverified: ["bar-no-confident-match"],
    });
  });
});

const ROOT = path.resolve(__dirname, "..");
const placesFixture = (name: string) =>
  JSON.parse(
    readFileSync(path.join(ROOT, "__tests__", "fixtures", "famous_venues", "places", name), "utf8"),
  );

type GuardedRow = Row & {
  address: string;
  borough: string;
  lat: number;
  lng: number;
  sourceUrl: string;
  story: { sourceUrl: string };
  fameGates: Array<{ sourceUrl: string }>;
  anchor?: { sourceUrl: string };
};

const wongKei = (anchorUrl?: string): GuardedRow => ({
  ...row("food-wong-kei"),
  name: "Wong Kei",
  address: "41-43 Wardour Street, London W1D 6PY",
  borough: "Westminster",
  lat: 51.51173,
  lng: -0.13265,
  sourceUrl: "https://wongkei.example/wardour-street",
  story: { sourceUrl: "https://wongkei.example/wardour-street/story" },
  fameGates: [{ sourceUrl: "https://press.example/wong-kei" }],
  ...(anchorUrl ? { anchor: { sourceUrl: anchorUrl } } : {}),
});

describe("verify:famous-venues anchor guard", () => {
  const operational = async () => placesFixture("operational_match.json");
  const live: AnchorSourceHead = async () => ({ status: 200, location: null });

  async function renewal(venue: GuardedRow, head: AnchorSourceHead = live) {
    const check = await verifyRowWithPlaces(venue, operational, head);
    const next = applyVerification(new Map([["late_food.json", [venue]]]), [check], "2026-10-05");
    return { check, renewed: next.get("late_food.json")?.[0] };
  }

  it("renews a Places match whose anchor page answers under one of the row's own sources", async () => {
    const head = vi.fn(live);
    const { check, renewed } = await renewal(
      wongKei("https://wongkei.example/wardour-street/menu.pdf"),
      head,
    );
    expect(head).toHaveBeenCalledWith("https://wongkei.example/wardour-street/menu.pdf");
    expect(check).toMatchObject({ outcome: "confirmed", result: "places_operational" });
    expect(renewed?.observedAt).toBe("2026-10-05");
  });

  it.each([
    [
      "an anchor page that redirects elsewhere",
      "https://wongkei.example/wardour-street/menu",
      async () => ({ status: 301, location: "/wardour-street/new-menu" }),
      "anchor_source_redirected",
    ],
    [
      "an anchor page off the row's own sources",
      "https://wongkei.example/old-bar/menu",
      live,
      "anchor_source_not_row_source",
    ],
    [
      "an anchor page that cannot be reached",
      "https://wongkei.example/wardour-street/menu",
      async () => {
        throw new Error("ECONNRESET");
      },
      "anchor_source_unreachable",
    ],
    ["a removed anchor", undefined, live, "anchor_missing"],
  ])("keeps the row unverified and unrenewed for %s", async (_label, anchorUrl, head, result) => {
    const venue = wongKei(anchorUrl);
    const { check, renewed } = await renewal(venue, head);
    expect(check).toMatchObject({ outcome: "unverified", result });
    expect(renewed).toEqual(venue);
  });

  it("still drops a permanently closed row whatever its anchor", async () => {
    const check = await verifyRowWithPlaces(
      wongKei(),
      async () => placesFixture("permanently_closed.json"),
      live,
    );
    expect(check.outcome).toBe("closed");
  });
});

function batchEntry(id: string, observedAt: string) {
  return { file: "bars.json", row: { id, observedAt, expiresAt: "2026-10-25" } };
}

describe("verify:famous-venues daily batch", () => {
  it("checks the oldest observedAt first and stops at the limit", () => {
    const entries = [
      batchEntry("bar-new", "2026-09-25"),
      batchEntry("bar-old-b", "2026-08-25"),
      batchEntry("bar-old-a", "2026-08-25"),
    ];
    expect(selectVerificationBatch(entries, { limit: 2 }).map((entry) => entry.row.id)).toEqual([
      "bar-old-a",
      "bar-old-b",
    ]);
  });

  const seedIds = ["bar-done", "bar-withheld", "bar-next"];
  const entries = [
    batchEntry("bar-done", "2026-08-25"),
    batchEntry("bar-withheld", "2026-08-25"),
    batchEntry("bar-next", "2026-09-25"),
  ];

  it("skips rows a partial batch already checked and still offers rows from a full re-verify", () => {
    const partial = {
      verifiedAt: "2026-10-03",
      checks: [{ id: "bar-done" }, { id: "bar-withheld" }],
    };
    const full = {
      verifiedAt: "2026-09-25",
      checks: [{ id: "bar-done" }, { id: "bar-withheld" }, { id: "bar-next" }],
    };
    const skipIds = idsCoveredByPartialVerifications([partial, full], seedIds);
    expect(skipIds).toEqual(["bar-done", "bar-withheld"]);
    expect(
      selectVerificationBatch(entries, { limit: 40, skipIds }).map((entry) => entry.row.id),
    ).toEqual(["bar-next"]);
  });

  it("offers rows again once earlier partial batches together covered the seed", () => {
    const earlier = [
      {
        verifiedAt: "2026-08-25",
        checks: [{ id: "bar-done" }, { id: "bar-withheld" }, { id: "bar-next" }],
      },
      { verifiedAt: "2026-09-01", checks: [{ id: "bar-done" }, { id: "bar-withheld" }] },
      { verifiedAt: "2026-09-02", checks: [{ id: "bar-next" }] },
    ];
    const skipIds = idsCoveredByPartialVerifications(earlier, seedIds);
    expect(skipIds).toEqual([]);
    expect(
      selectVerificationBatch(entries, { limit: 40, skipIds }).map((entry) => entry.row.id),
    ).toEqual(["bar-done", "bar-withheld", "bar-next"]);

    const resumed = [...earlier, { verifiedAt: "2026-10-03", checks: [{ id: "bar-done" }] }];
    expect(idsCoveredByPartialVerifications(resumed, seedIds)).toEqual(["bar-done"]);
  });

  it("keeps a finished re-verification closed when the seed gains a row", () => {
    const finished = [
      {
        verifiedAt: "2026-09-25",
        checks: [{ id: "bar-done" }, { id: "bar-withheld" }, { id: "bar-next" }, { id: "bar-gone" }],
      },
      {
        verifiedAt: "2026-10-03",
        checks: [{ id: "bar-done" }, { id: "bar-withheld" }, { id: "bar-next" }],
      },
    ];
    const grownSeed = [...seedIds, "bar-added"];
    expect(idsCoveredByPartialVerifications(finished, seedIds)).toEqual([]);
    expect(idsCoveredByPartialVerifications(finished, grownSeed)).toEqual([]);

    const resumed = [...finished, { verifiedAt: "2026-10-20", checks: [{ id: "bar-done" }] }];
    const skipIds = idsCoveredByPartialVerifications(resumed, grownSeed);
    expect(skipIds).toEqual(["bar-done"]);
    expect(
      selectVerificationBatch([...entries, batchEntry("bar-added", "2026-10-15")], {
        limit: 40,
        skipIds,
      }).map((entry) => entry.row.id),
    ).toEqual(["bar-withheld", "bar-next", "bar-added"]);
  });

  it("counts today's checks against the batch and rejects a non-positive limit", () => {
    expect(remainingBatchSize(40, 0)).toBe(40);
    expect(remainingBatchSize(40, 10)).toBe(30);
    expect(remainingBatchSize(40, 40)).toBe(0);
    expect(parseVerificationLimit(["--write"])).toBeNull();
    expect(parseVerificationLimit(["--limit", "40"])).toBe(40);
    expect(() => parseVerificationLimit(["--limit", "0"])).toThrow(/positive integer/);
  });
});

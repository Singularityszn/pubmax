import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AnchorSourceHead,
  applyVerification,
  idsCoveredByPartialVerifications,
  parseVerificationLimit,
  remainingBatchSize,
  runVerification,
  selectVerificationBatch,
  summarizeVerification,
  verifyRowWithPlaces,
} from "@/scripts/verify_famous_venues.mjs";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});

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
    ["a trailing slash", "https://wongkei.example/wardour-street/menu/"],
    ["www.", "https://www.wongkei.example/wardour-street/menu"],
    ["a trailing slash in a relative location", "/wardour-street/menu/"],
  ])("renews an anchor page whose redirect only adds %s", async (_label, location) => {
    const { check, renewed } = await renewal(
      wongKei("https://wongkei.example/wardour-street/menu"),
      async () => ({ status: 301, location }),
    );
    expect(check).toMatchObject({ outcome: "confirmed", result: "places_operational" });
    expect(renewed?.observedAt).toBe("2026-10-05");
  });

  it.each([
    [
      "an anchor page whose domain now redirects to another site",
      "https://wongkei.example/wardour-street",
      async () => ({ status: 301, location: "https://www.iraqgoals.tv/" }),
      "anchor_source_redirected",
    ],
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

describe("famous verifier targeted durable continuation", () => {
  let root: string;
  let stateRoot: string;
  let famous: string;
  let receipt: string;
  const day = () => new Date("2026-10-21T12:00:00.000Z");
  const venues = ["a", "b", "c"].map((id) => ({
    ...wongKei("https://wongkei.example/wardour-street/menu"),
    id,
    anchor: { sourceUrl: "https://wongkei.example/wardour-street/menu", observedAt: "2026-08-25" },
  }));
  const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const packs = () => json(path.join(famous, "bars.json"));
  const args = (ids = "a,b,c", evidence = receipt) => ["--write", "--ids", ids, "--spent-receipt", evidence];
  const network = () => vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("places.googleapis.com")) return Response.json(placesFixture("operational_match.json").body);
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n");
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    throw new Error("Unexpected mocked request");
  });
  const run = (fetchImpl: typeof fetch, argv = args(), now = day) => runVerification({
    argv, root, stateRoot, fetchImpl, now, apiKey: "fake-test-key",
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Live fetch denied in this suite"); }));
    root = mkdtempSync(path.join(tmpdir(), "pubmax-famous-mock-"));
    stateRoot = path.join(root, "state");
    famous = path.join(root, "data", "famous_venues");
    mkdirSync(famous, { recursive: true });
    for (const file of ["bars.json", "late_food.json", "restaurants.json"]) {
      writeFileSync(path.join(famous, file), JSON.stringify(file === "bars.json" ? venues : []));
    }
    receipt = path.join(root, "receipt.json");
    writeFileSync(receipt, JSON.stringify({ placesCalls: 98, maxPlacesCalls: 100 }));
  });
  afterEach(() => {
    vi.mocked(renameSync).mockRestore();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it("retains two renewals from 98 spent calls, refuses a third, and cannot reset through a copied receipt", async () => {
    const fetchImpl = network();
    await expect(run(fetchImpl)).rejects.toThrow(/budget/);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("places.googleapis.com"))).toHaveLength(2);
    expect(packs().map((v: Row) => v.observedAt)).toEqual(["2026-10-21", "2026-10-21", "2026-08-25"]);
    expect(packs()[0].anchor.observedAt).toBe("2026-08-25");
    const artifact = json(path.join(famous, "verification_2026-10-21.json"));
    expect(artifact.checks.map((c: { id: string }) => c.id)).toEqual(["a", "b"]);
    const copy = path.join(root, "copied-receipt.json");
    writeFileSync(copy, readFileSync(receipt));
    const resumed = network();
    await expect(run(resumed, args("a,b,c", copy))).rejects.toThrow(/halt|budget/);
    expect(resumed).not.toHaveBeenCalled();
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("OPERATIONAL");
    expect(serialized).not.toContain("41-43 Wardour St, London W1D 6PY, UK");
    expect(serialized).not.toContain("fake-test-key");
  });

  it("uses a finite receipt ceiling before another provider dispatch", async () => {
    writeFileSync(receipt, JSON.stringify({ placesCalls: 39, maxPlacesCalls: 40 }));
    const fetchImpl = network();
    await expect(run(fetchImpl)).rejects.toThrow(/budget/);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("places.googleapis.com"))).toHaveLength(1);
    expect(packs().map((venue: Row) => venue.observedAt)).toEqual(["2026-10-21", "2026-08-25", "2026-08-25"]);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    expect(json(path.join(task, "checkpoint.json")).placesCalls).toBe(40);
    const resumed = network();
    await expect(run(resumed)).rejects.toThrow(/halt|budget/);
    expect(resumed).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 101, "40", null])("refuses the invalid receipt ceiling %s before transport", async (maxPlacesCalls) => {
    writeFileSync(receipt, JSON.stringify({ placesCalls: 0, maxPlacesCalls }));
    const fetchImpl = network();
    await expect(run(fetchImpl)).rejects.toThrow(/receipt budget/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(packs()).toEqual(venues);
  });

  it("keeps an exhausted original 100-request receipt blocked", async () => {
    writeFileSync(receipt, JSON.stringify({ placesCalls: 100, maxPlacesCalls: 100 }));
    const fetchImpl = network();
    await expect(run(fetchImpl, args("a"))).rejects.toThrow(/budget/);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("places.googleapis.com"))).toHaveLength(0);
    expect(packs()).toEqual(venues);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    expect(json(path.join(task, "checkpoint.json")).placesCalls).toBe(100);
  });

  it("refuses a durable counter above its receipt ceiling before transport", async () => {
    writeFileSync(receipt, JSON.stringify({ placesCalls: 0, maxPlacesCalls: 1 }));
    const initial = network();
    await run(initial, args("a"));
    expect(initial.mock.calls.filter(([url]) => String(url).includes("places.googleapis.com"))).toHaveLength(1);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    const checkpointPath = path.join(task, "checkpoint.json");
    const checkpoint = json(checkpointPath);
    checkpoint.placesCalls = 2;
    writeFileSync(checkpointPath, JSON.stringify(checkpoint));
    const resumed = network();
    await expect(run(resumed, args("a"))).rejects.toThrow(/checkpoint counters/);
    expect(resumed).not.toHaveBeenCalled();
  });

  it.each(["missing", "a,a"])("refuses invalid target %s without transport", async (ids) => {
    const fetchImpl = network();
    await expect(run(fetchImpl, args(ids))).rejects.toThrow(/unknown|duplicate/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an immutable receipt with explicit targets and rejects a malformed count", async () => {
    const fetchImpl = network();
    await expect(run(fetchImpl, ["--ids", "a"])).rejects.toThrow(/receipt/);
    writeFileSync(receipt, '{"placesCalls":-1,"maxPlacesCalls":100}');
    await expect(run(fetchImpl)).rejects.toThrow(/receipt/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["failure", "429"])("counts provider %s, retains completed rows, and never repeats the failed row", async (failure) => {
    let searches = 0;
    const base = network();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("places.googleapis.com") && ++searches === 2) {
        if (failure === "429") return new Response(null, { status: 429, headers: { "retry-after": "60" } });
        throw new Error("fixture interruption");
      }
      return base(url, init);
    });
    await expect(run(fetchImpl)).rejects.toThrow(/halt|429|provider/);
    expect(packs()[0].observedAt).toBe("2026-10-21");
    expect(packs()[1]).toEqual(venues[1]);
    const resumed = network();
    await expect(run(resumed)).rejects.toThrow(/halt/);
    expect(resumed).not.toHaveBeenCalled();
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    expect(json(path.join(task, "checkpoint.json")).placesCalls).toBe(100);
  });

  it("replays the old check without another call and counts only the new day's artifact call", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to) === path.join(famous, "verification_2026-10-21.json")) throw new Error("fixture output interruption");
      return actual.renameSync(from, to);
    });
    const fetchImpl = network();
    await expect(run(fetchImpl, args("a,b"))).rejects.toThrow(/output interruption/);
    expect(packs()[0].observedAt).toBe("2026-10-21");
    vi.mocked(renameSync).mockImplementation(actual.renameSync);
    const resumed = network();
    await run(resumed, args("a,b"), () => new Date("2026-10-22T12:00:00Z"));
    expect(resumed.mock.calls.filter(([url]) => String(url).includes("places.googleapis.com"))).toHaveLength(1);
    expect(packs()[0].observedAt).toBe("2026-10-21");
    expect(packs()[1].observedAt).toBe("2026-10-22");
    expect(json(path.join(famous, "verification_2026-10-21.json")).checks[0].checkedAt).toBe("2026-10-21T12:00:00.000Z");
    expect(json(path.join(famous, "verification_2026-10-21.json")).summary.placesLiveApiCalls).toBe(1);
    expect(json(path.join(famous, "verification_2026-10-22.json")).summary.placesLiveApiCalls).toBe(1);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    expect(json(path.join(task, "checkpoint.json")).placesCalls).toBe(100);
  });

  it("rejects third-party pack changes instead of replaying across them", async () => {
    await run(network(), args("a"));
    const changed = packs(); changed[1].name = "Another owner's edit";
    writeFileSync(path.join(famous, "bars.json"), JSON.stringify(changed));
    const resumed = network();
    await expect(run(resumed, args("a"))).rejects.toThrow(/changed|preimage|unrelated/);
    expect(resumed).not.toHaveBeenCalled();
    expect(packs()[1].name).toBe("Another owner's edit");
  });

  it("keeps a completed provider dispatch indeterminate until its derived check is durable", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to).endsWith("checkpoint.json")) {
        const next = json(String(from));
        if (next.active?.kind === "places" && next.lastResponse?.kind === "places") {
          actual.renameSync(from, to);
          throw new Error("fixture crash after response checkpoint");
        }
      }
      return actual.renameSync(from, to);
    });
    await expect(run(network(), args("a"))).rejects.toThrow(/crash after response/);
    vi.mocked(renameSync).mockImplementation(actual.renameSync);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    expect(json(path.join(task, "checkpoint.json")).placesCalls).toBe(99);
    const resumed = network();
    await expect(run(resumed, args("a"))).rejects.toThrow(/EEXIST/);
    // Simulate an operator releasing this fixture's dead writer, never a live lock.
    rmSync(path.join(task, "lock"));
    await expect(run(resumed, args("a"))).rejects.toThrow(/indeterminate/);
    expect(resumed).not.toHaveBeenCalled();
    expect(packs()[0]).toEqual(venues[0]);
  });

  it("counts an oversized provider body and halts without storing its content", async () => {
    const base = network();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes("places.googleapis.com")
      ? new Response(new Uint8Array(1024 * 1024 + 1)) : base(url, init));
    await expect(run(fetchImpl, args("a"))).rejects.toThrow(/provider/);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    const checkpoint = json(path.join(task, "checkpoint.json"));
    expect(checkpoint.placesCalls).toBe(99);
    expect(checkpoint.halt).toMatch(/provider/);
    expect(packs()[0]).toEqual(venues[0]);
  });

  it("preserves immutable snapshots and refuses scope changes or a damaged checkpoint", async () => {
    await run(network(), args("a"));
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    const snapshotDir = path.join(task, "snapshots");
    const before = readdirSync(snapshotDir).map((name) => [name, readFileSync(path.join(snapshotDir, name), "utf8")]);
    const resumed = network();
    await expect(run(resumed, args("b"))).rejects.toThrow(/scope|target/);
    await run(resumed, args("a"));
    expect(resumed).not.toHaveBeenCalled();
    expect(readdirSync(snapshotDir).map((name) => [name, readFileSync(path.join(snapshotDir, name), "utf8")])).toEqual(before);
    rmSync(path.join(task, "checkpoint.json"));
    await expect(run(resumed, args("a"))).rejects.toThrow(/checkpoint/);
    expect(resumed).not.toHaveBeenCalled();
  });
});

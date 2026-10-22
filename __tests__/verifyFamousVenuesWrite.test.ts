import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

describe("famous verifier source 429 quarantine", () => {
  let root: string;
  let stateRoot: string;
  let famous: string;
  let receipt: string;
  type Checkpoint = {
    halt?: string | null;
    active?: unknown;
    journal?: unknown;
    lastResponse?: Record<string, unknown>;
    records: Array<{ id: string; status: string }>;
    expected: Record<string, string | null>;
  };
  const venue = (id: string, origin: string, anchor = `${origin}/menu`) => ({
    ...wongKei(anchor),
    id,
    sourceUrl: `${origin}/`,
    story: { sourceUrl: `${origin}/` },
    fameGates: [{ sourceUrl: `${origin}/` }],
  });
  const venues = [
    venue("a-done", "https://done.example"),
    venue("b-blocked", "https://blocked.example"),
    venue("c-held", "https://held.example"),
    venue("d-alias", "https://www.held.example"),
    venue("e-free", "https://free.example"),
    venue("f-offsource", "https://off.example", "https://elsewhere.example/menu"),
  ];
  const args = (...extra: string[]) =>
    ["--write", "--ids", venues.map((item) => item.id).join(","), "--spent-receipt", receipt, ...extra];
  const quarantine = (hash: string) => args("--quarantine-source-429", hash);
  const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const taskDir = () => path.join(stateRoot, readdirSync(stateRoot)[0]);
  const checkpointFile = () => path.join(taskDir(), "checkpoint.json");
  const files = (dir: string) => readdirSync(dir).sort().map((name) => [name, readFileSync(path.join(dir, name))] as const);
  const snapshots = () => files(path.join(taskDir(), "snapshots"));
  const outputs = () => files(famous);
  const statuses = (checkpoint: Checkpoint) => checkpoint.records.map((record) => [record.id, record.status]);
  const host = (url: string | URL | Request) => new URL(String(url)).hostname;
  const onHeld = (url: string | URL | Request) => host(url).replace(/^www\./, "") === "held.example";
  const network = () => vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (host(url) === "places.googleapis.com") return Response.json(placesFixture("operational_match.json").body);
    if (onHeld(url)) return new Response(null, { status: 429, headers: { "retry-after": "60" } });
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n");
    if (init?.method === "HEAD") return new Response(null, { status: host(url) === "blocked.example" ? 403 : 200 });
    throw new Error("Unexpected mocked request");
  });
  const denied = () => vi.fn(async () => { throw new Error("A quarantine sends no request"); });
  const run = (fetchImpl: typeof fetch, argv = args(), apiKey = "fake-test-key") => runVerification({
    argv, root, stateRoot, fetchImpl, apiKey, now: () => new Date("2026-10-21T12:00:00.000Z"),
  });
  const halt = async () => {
    await expect(run(network())).rejects.toThrow(/robots HTTP 429/);
    return readFileSync(checkpointFile());
  };
  const rewritten = (edit: (checkpoint: Checkpoint) => void) => (bytes: Buffer) => {
    const checkpoint = JSON.parse(bytes.toString("utf8"));
    edit(checkpoint);
    const next = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`);
    return { bytes: next, hash: sha256(next) };
  };
  const legacy = (checkpoint: Checkpoint, ...blocked: string[]) => {
    checkpoint.lastResponse = { kind: "robots", status: 429 };
    for (const record of checkpoint.records) {
      if (blocked.includes(record.id)) Object.assign(record, { status: "source-blocked", finding: "anchor_source_unreachable" });
    }
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Live fetch denied in this suite"); }));
    root = mkdtempSync(path.join(tmpdir(), "pubmax-famous-quarantine-"));
    stateRoot = path.join(root, "state");
    famous = path.join(root, "data", "famous_venues");
    mkdirSync(famous, { recursive: true });
    for (const file of ["bars.json", "late_food.json", "restaurants.json"]) {
      writeFileSync(path.join(famous, file), JSON.stringify(file === "late_food.json" ? venues : []));
    }
    receipt = path.join(root, "receipt.json");
    writeFileSync(receipt, JSON.stringify({ placesCalls: 21, maxPlacesCalls: 40 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it("quarantines a recorded robots 429 operator with no request or key, then continues only independent rows", async () => {
    const original = await halt();
    const hash = sha256(original);
    const halted = JSON.parse(original.toString("utf8"));
    expect(halted.halt).toBe("robots HTTP 429");
    expect(halted.active).toBeNull();
    expect(halted.lastResponse).toEqual({
      kind: "robots", status: 429, retryAfter: "60", id: "c-held", origin: "https://held.example",
    });
    expect(statuses(halted)).toEqual([
      ["a-done", "completed"], ["b-blocked", "source-blocked"], ["c-held", "pending"],
      ["d-alias", "pending"], ["e-free", "pending"], ["f-offsource", "pending"],
    ]);
    const priorSnapshots = snapshots();
    const priorOutputs = outputs();

    const quiet = denied();
    await expect(run(quiet, quarantine(hash), "")).resolves.toMatchObject({
      rowsChecked: 1, confirmed: 1, sourceBlocked: ["b-blocked", "c-held", "d-alias"], placesCalls: 22, sourceCalls: halted.sourceCalls, exitCode: 0,
    });
    expect(quiet).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const quarantined = json(checkpointFile());
    expect(quarantined.halt).toBeNull();
    expect(quarantined.active).toBeNull();
    expect(quarantined.journal).toBeNull();
    for (const key of ["placesCalls", "sourceCalls", "receiptHash", "scopeHash", "expected", "sourceHashes", "records", "lastResponse"]) {
      expect(quarantined[key], key).toEqual(halted[key]);
    }
    expect(quarantined.sourceQuarantines).toEqual([{
      checkpointSha256: hash, id: "c-held", operator: "https://held.example", kind: "robots", status: 429,
      reason: "source_http_429", binding: "recorded", disposition: "quarantined_without_request",
    }]);
    expect(quarantined.snapshots).toEqual([...halted.snapshots, hash]);
    expect(readFileSync(path.join(taskDir(), "snapshots", hash))).toEqual(original);
    expect(snapshots().filter(([name]) => name !== hash)).toEqual(priorSnapshots);
    expect(outputs()).toEqual(priorOutputs);

    const later = network();
    await expect(run(later)).resolves.toMatchObject({
      rowsChecked: 2, confirmed: 2, sourceBlocked: ["b-blocked", "c-held", "d-alias", "f-offsource"], placesCalls: 23, exitCode: 0,
    });
    expect(later.mock.calls.map(([url]) => host(url))).toEqual(["free.example", "free.example", "places.googleapis.com"]);
    expect(statuses(json(checkpointFile()))).toEqual([
      ["a-done", "completed"], ["b-blocked", "source-blocked"], ["c-held", "pending"],
      ["d-alias", "pending"], ["e-free", "completed"], ["f-offsource", "source-blocked"],
    ]);

    const settled = readFileSync(checkpointFile());
    const replay = denied();
    await expect(run(replay, quarantine(hash), "")).rejects.toThrow(/Source 429 quarantine refused/);
    const reentry = network();
    await expect(run(reentry)).resolves.toMatchObject({ rowsChecked: 2, placesCalls: 23 });
    expect(replay).not.toHaveBeenCalled();
    expect(reentry).not.toHaveBeenCalled();
    expect(readFileSync(checkpointFile())).toEqual(settled);
  });

  it("reports a quarantined pending row as blocked and fails a full default run while it stays held", async () => {
    writeFileSync(path.join(famous, "late_food.json"), JSON.stringify([venues[2]]));
    const priorOutputs = outputs();
    const full = ["--write"];
    const first = network();
    await expect(run(first, full)).rejects.toThrow(/Verification halted: robots HTTP 429/);
    expect(first.mock.calls.map(([url]) => String(url))).toEqual(["https://held.example/robots.txt"]);
    const original = readFileSync(checkpointFile());
    const halted = JSON.parse(original.toString("utf8"));
    expect(json(path.join(taskDir(), "snapshots", halted.receiptHash))).toEqual({
      kind: "famous-venues-daily", day: "2026-10-21", placesCalls: 0, maxPlacesCalls: 100,
    });
    expect(halted).toMatchObject({ halt: "robots HTTP 429", active: null, journal: null, placesCalls: 0 });
    expect(statuses(halted)).toEqual([["c-held", "pending"]]);

    const quiet = denied();
    await expect(run(quiet, [...full, "--quarantine-source-429", sha256(original)], "")).resolves.toMatchObject({
      rowsChecked: 0, sourceBlocked: ["c-held"], placesCalls: 0, exitCode: 1,
    });
    const quarantined = readFileSync(checkpointFile());
    const priorSnapshots = snapshots();
    const later = denied();
    await expect(run(later, full)).resolves.toEqual({
      rowsChecked: 0, confirmed: 0, closed: [], unverified: [], sourceBlocked: ["c-held"],
      placesCalls: 0, sourceCalls: halted.sourceCalls, exitCode: 1,
    });
    expect(quiet).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(readFileSync(checkpointFile())).toEqual(quarantined);
    expect(snapshots()).toEqual(priorSnapshots);
    expect(outputs()).toEqual(priorOutputs);
    const final = json(checkpointFile());
    for (const key of ["placesCalls", "sourceCalls", "receiptHash", "scopeHash", "expected", "sourceHashes", "records", "lastResponse"]) {
      expect(final[key], key).toEqual(halted[key]);
    }
    expect(final.sourceQuarantines).toEqual([expect.objectContaining({ id: "c-held", operator: "https://held.example" })]);
  });

  it("infers the held row from the legacy wire shape only through the sequential cursor and its anchor", async () => {
    const halted = JSON.parse((await halt()).toString("utf8"));
    halted.lastResponse = { kind: "robots", status: 429 };
    const legacyBytes = Buffer.from(`${JSON.stringify(halted, null, 2)}\n`);
    writeFileSync(checkpointFile(), legacyBytes);
    const quiet = denied();
    await expect(run(quiet, quarantine(sha256(legacyBytes)), "")).resolves.toMatchObject({ placesCalls: 22 });
    expect(quiet).not.toHaveBeenCalled();
    const quarantined = json(checkpointFile());
    expect(quarantined.sourceQuarantines).toEqual([expect.objectContaining({
      checkpointSha256: sha256(legacyBytes), id: "c-held", operator: "https://held.example", binding: "inferred",
    })]);
    expect(quarantined.lastResponse).toEqual({ kind: "robots", status: 429 });
    expect(quarantined.records).toEqual(halted.records);
    const later = network();
    await expect(run(later)).resolves.toMatchObject({ placesCalls: 23 });
    expect(later.mock.calls.some(([url]) => onHeld(url))).toBe(false);
  });

  const refusals: Array<[string, (bytes: Buffer) => { bytes: Buffer; hash: string }]> = [
    ["a hash of other bytes", (bytes) => ({ bytes, hash: sha256(Buffer.concat([bytes, Buffer.from(" ")])) })],
    ["a returned Places 429", rewritten((checkpoint) => {
      checkpoint.halt = "places HTTP 429";
      checkpoint.lastResponse = { kind: "places", status: 429 };
    })],
    ["an unknown response kind", rewritten((checkpoint) => {
      checkpoint.halt = "firecrawl HTTP 429";
      checkpoint.lastResponse = { kind: "firecrawl", status: 429 };
    })],
    ["no returned status, as after a timeout", rewritten((checkpoint) => { delete checkpoint.lastResponse; })],
    ["a non-429 source response", rewritten((checkpoint) => { checkpoint.lastResponse = { kind: "robots", status: 503 }; })],
    ["no durable halt", rewritten((checkpoint) => { checkpoint.halt = null; })],
    ["an active reservation", rewritten((checkpoint) => { checkpoint.active = { id: "c-held", kind: "robots" }; })],
    ["an unresolved write journal", rewritten((checkpoint) => {
      const late = readFileSync(path.join(famous, "late_food.json"), "utf8");
      checkpoint.journal = { files: [{ file: "late_food.json", bytes: late, before: checkpoint.expected["late_food.json"], after: sha256(late) }] };
    })],
    ["a recorded boundary for another row", rewritten((checkpoint) => { checkpoint.lastResponse = { ...checkpoint.lastResponse, id: "e-free" }; })],
    ["a recorded boundary on another operator", rewritten((checkpoint) => {
      checkpoint.lastResponse = { ...checkpoint.lastResponse, origin: "https://free.example" };
    })],
    ["partial boundary evidence", rewritten((checkpoint) => { checkpoint.lastResponse = { kind: "robots", status: 429, id: "c-held" }; })],
    ["an ambiguous legacy cursor", rewritten((checkpoint) => legacy(checkpoint, "e-free"))],
    ["a legacy cursor row with no source boundary", rewritten((checkpoint) => legacy(checkpoint, "c-held", "d-alias", "e-free"))],
  ];

  it.each(refusals)("refuses a source 429 quarantine with %s and changes nothing", async (_label, prepare) => {
    const { bytes, hash } = prepare(await halt());
    writeFileSync(checkpointFile(), bytes);
    const priorSnapshots = snapshots();
    const priorOutputs = outputs();
    const quiet = denied();
    await expect(run(quiet, quarantine(hash), "")).rejects.toThrow(/Source 429 quarantine refused/);
    expect(quiet).not.toHaveBeenCalled();
    expect(readFileSync(checkpointFile())).toEqual(bytes);
    expect(snapshots()).toEqual(priorSnapshots);
    expect(outputs()).toEqual(priorOutputs);
  });

  it("refuses a quarantine across an unrelated producer edit", async () => {
    const hash = sha256(await halt());
    const bytes = readFileSync(checkpointFile());
    writeFileSync(path.join(famous, "restaurants.json"), JSON.stringify([{ id: "another-owner" }]));
    const quiet = denied();
    await expect(run(quiet, quarantine(hash), "")).rejects.toThrow(/preimage/);
    expect(quiet).not.toHaveBeenCalled();
    expect(readFileSync(checkpointFile())).toEqual(bytes);
  });

  it.each<[string, string[], RegExp]>([
    ["an acknowledgment beside it", ["--quarantine-source-429", "a".repeat(64), "--acknowledge-http-429", "b".repeat(64)], /Source 429 quarantine refused/],
    ["an invocation bound beside it", ["--quarantine-source-429", "a".repeat(64), "--max-new-places-calls", "1"], /Source 429 quarantine refused/],
    ["a malformed hash", ["--quarantine-source-429", "HELD"], /Source 429 quarantine refused/],
    ["no checkpoint for its receipt", ["--quarantine-source-429", "a".repeat(64)], /Source 429 quarantine refused: no checkpoint/],
    ["a caller-supplied row", ["--quarantine-source-429", "a".repeat(64), "--source-id", "c-held"], /Unknown or duplicate option/],
  ])("refuses a source 429 quarantine with %s before any state or request", async (_label, extra, refusal) => {
    const quiet = denied();
    await expect(run(quiet, args(...extra), "")).rejects.toThrow(refusal);
    expect(quiet).not.toHaveBeenCalled();
    expect(existsSync(stateRoot)).toBe(false);
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
    vi.useRealTimers();
    vi.mocked(renameSync).mockRestore();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it("publishes the daily report on the same receipt without another request", async () => {
    await expect(run(network(), [])).resolves.toMatchObject({ rowsChecked: 3, placesCalls: 3 });
    expect(packs()).toEqual(venues);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    const checkpointPath = path.join(task, "checkpoint.json");
    const reported = json(checkpointPath);
    const quiet = vi.fn(async () => { throw new Error("Daily publication must not send a request"); });
    await expect(run(quiet, ["--write"])).resolves.toMatchObject({ rowsChecked: 3, placesCalls: 3 });
    const published = json(checkpointPath);
    expect(published.scopeHash).toBe(reported.scopeHash);
    expect(published.receiptHash).toBe(reported.receiptHash);
    expect(published.sourceCalls).toBe(reported.sourceCalls);
    expect(quiet).not.toHaveBeenCalled();
    expect(json(path.join(famous, "verification_2026-10-21.json")).checks).toHaveLength(3);
  });

  it("publishes recorded report checks without another request or budget allowance", async () => {
    const reportArgs = args("a,b").filter((arg) => arg !== "--write");
    const fetchImpl = network();
    await expect(run(fetchImpl, reportArgs)).resolves.toMatchObject({ rowsChecked: 2, placesCalls: 100 });
    expect(packs()).toEqual(venues);
    expect(existsSync(path.join(famous, "verification_2026-10-21.json"))).toBe(false);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    const checkpointPath = path.join(task, "checkpoint.json");
    const reported = json(checkpointPath);
    expect(reported.records.every((record: { applied?: boolean }) => !record.applied)).toBe(true);
    const beforeSnapshots = readdirSync(path.join(task, "snapshots"));
    const quiet = vi.fn(async () => { throw new Error("Publication must not send a request"); });
    await expect(run(quiet, args("a,b"))).resolves.toMatchObject({ rowsChecked: 2, placesCalls: 100 });
    expect(quiet).not.toHaveBeenCalled();
    const published = json(checkpointPath);
    for (const key of ["receiptHash", "scopeHash", "placesCalls", "sourceCalls", "sourceHashes"]) {
      expect(published[key]).toEqual(reported[key]);
    }
    expect(published.records.every((record: { applied?: boolean }) => record.applied)).toBe(true);
    expect(readdirSync(path.join(task, "snapshots"))).toEqual(expect.arrayContaining(beforeSnapshots));
    expect(packs().map((venue: Row) => venue.observedAt)).toEqual(["2026-10-21", "2026-10-21", "2026-08-25"]);
    expect(json(path.join(famous, "verification_2026-10-21.json")).summary.placesLiveApiCalls).toBe(2);
    await run(quiet, reportArgs);
    await run(quiet, args("a,b"));
    expect(quiet).not.toHaveBeenCalled();
  });

  it("refuses a report-to-write transition for an older mode-bound checkpoint", async () => {
    const reportArgs = args("a").filter((arg) => arg !== "--write");
    await run(network(), reportArgs);
    const task = path.join(stateRoot, readdirSync(stateRoot)[0]);
    const checkpointPath = path.join(task, "checkpoint.json");
    const legacy = json(checkpointPath);
    legacy.version = 1;
    legacy.scopeHash = createHash("sha256").update(JSON.stringify({ write: false, limit: null, ids: ["a"], receiptHash: legacy.receiptHash })).digest("hex");
    writeFileSync(checkpointPath, JSON.stringify(legacy));
    const before = readFileSync(checkpointPath);
    const quiet = vi.fn(async () => { throw new Error("Older state must stay closed"); });
    await expect(run(quiet, args("a"))).rejects.toThrow(/scope or target mismatch/);
    expect(quiet).not.toHaveBeenCalled();
    expect(readFileSync(checkpointPath)).toEqual(before);
    expect(packs()).toEqual(venues);
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

  type Prepared = { bytes: Buffer; hash: string };
  type DurableCheckpoint = {
    halt?: string | null;
    active?: { id: string; kind: string } | null;
    lastResponse?: { kind: string; status: number };
    journal?: unknown;
    expected: Record<string, string | null>;
  };
  type Transport = ReturnType<typeof network>;
  const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const taskDir = () => path.join(stateRoot, readdirSync(stateRoot)[0]);
  const checkpointFile = () => path.join(taskDir(), "checkpoint.json");
  const snapshotEntries = () => readdirSync(path.join(taskDir(), "snapshots")).sort()
    .map((name) => [name, readFileSync(path.join(taskDir(), "snapshots", name))] as const);
  const fundReceipt = (placesCalls: number, maxPlacesCalls = 100) =>
    writeFileSync(receipt, JSON.stringify({ placesCalls, maxPlacesCalls }));
  const placesDispatches = (fetchImpl: Transport) =>
    fetchImpl.mock.calls.filter(([url]) => String(url).includes("places.googleapis.com")).length;
  const lastDispatch = (fetchImpl: Transport) => String(fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1]?.[0]);
  const placesFailure = (failAt: number, failure: () => Response) => {
    let searches = 0;
    const base = network();
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      String(url).includes("places.googleapis.com") && ++searches === failAt ? failure() : base(url, init));
  };
  const known429 = () => new Response(null, { status: 429, headers: { "retry-after": "60" } });
  const acknowledge = (hash: string, ids = "a,b,c") => [...args(ids), "--acknowledge-http-429", hash];
  const bounded = (bound: string, ids = "a,b,c") => [...args(ids), "--max-new-places-calls", bound];
  const statuses = (checkpoint: { records: Array<{ id: string; status: string }> }) =>
    checkpoint.records.map((record) => [record.id, record.status]);
  const present = (value: Record<string, unknown> | undefined) =>
    Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item != null));
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const quota429 = (body: unknown, retryAfter: string) => () => Response.json(body, {
    status: 429, headers: { "retry-after": retryAfter, "x-debug-trace": "HEADER_CANARY" },
  });
  const endlessBody = (trace = { pulls: 0, cancelled: false }) => new ReadableStream<Uint8Array>({
    pull(controller) {
      trace.pulls += 1;
      if (trace.pulls > 64) controller.error(new Error("fixture endless body overran its bound"));
      else controller.enqueue(new Uint8Array(64 * 1024).fill(123));
    },
    cancel() {
      trace.cancelled = true;
    },
  });

  it("completes a known returned Places 429 recovery bound to the exact checkpoint hash without resetting accounting", async () => {
    fundReceipt(90);
    const first = placesFailure(2, known429);
    await expect(run(first)).rejects.toThrow(/places HTTP 429/i);
    expect(placesDispatches(first)).toBe(2);
    const original = readFileSync(checkpointFile());
    const hash = sha256(original);
    const halted = JSON.parse(original.toString("utf8"));
    expect(halted.placesCalls).toBe(92);
    expect(halted.halt).toMatch(/^places HTTP 429$/i);
    expect(statuses(halted)).toEqual([["a", "completed"], ["b", "pending"], ["c", "pending"]]);
    const priorSnapshots = snapshotEntries();

    const resumed = network();
    const recovering = run(resumed, acknowledge(hash));
    await expect(recovering).resolves.toMatchObject({
      rowsChecked: 3, confirmed: 3, closed: [], unverified: [], sourceBlocked: [], placesCalls: 94, exitCode: 0,
    });
    const summary = await recovering;
    expect(placesDispatches(resumed)).toBe(2);
    expect(summary.sourceCalls).toBe(halted.sourceCalls + resumed.mock.calls.length - 2);
    const recovered = json(checkpointFile());
    expect(recovered.placesCalls).toBe(94);
    expect(recovered.sourceCalls).toBe(summary.sourceCalls);
    expect(recovered.halt ?? null).toBeNull();
    expect(recovered.active ?? null).toBeNull();
    expect(recovered.journal ?? null).toBeNull();
    expect(statuses(recovered)).toEqual([["a", "completed"], ["b", "completed"], ["c", "completed"]]);
    expect(recovered.records[0]).toEqual(halted.records[0]);
    expect(recovered.receiptHash).toBe(halted.receiptHash);
    expect(recovered.scopeHash).toBe(halted.scopeHash);
    expect(recovered.sourceHashes).toEqual(halted.sourceHashes);
    expect(recovered.http429Acknowledgments).toEqual([{ checkpointSha256: hash, id: "b" }]);
    expect(recovered.snapshots).toHaveLength(halted.snapshots.length + 1);
    expect(recovered.snapshots).toEqual(expect.arrayContaining([...halted.snapshots, hash]));
    expect(readFileSync(path.join(taskDir(), "snapshots", hash))).toEqual(original);
    expect(snapshotEntries().filter(([name]) => name !== hash)).toEqual(priorSnapshots);
    expect(packs().map((venue: Row) => venue.observedAt)).toEqual(["2026-10-21", "2026-10-21", "2026-10-21"]);
    const artifact = json(path.join(famous, "verification_2026-10-21.json"));
    expect(artifact.checks.map((check: { id: string }) => check.id)).toEqual(["a", "b", "c"]);
    expect(artifact.summary.placesLiveApiCalls).toBe(3);

    const later = network();
    await expect(run(later)).resolves.toMatchObject({ rowsChecked: 3, placesCalls: 94 });
    expect(later).not.toHaveBeenCalled();
    expect(readdirSync(stateRoot)).toHaveLength(1);
  });

  it("refuses to replay a used Places 429 acknowledgment", async () => {
    fundReceipt(90);
    await expect(run(placesFailure(2, known429))).rejects.toThrow(/places HTTP 429/i);
    const hash = sha256(readFileSync(checkpointFile()));
    await expect(run(network(), acknowledge(hash))).resolves.toMatchObject({ placesCalls: 94 });
    const bytes = readFileSync(checkpointFile());
    const resumed = network();
    await expect(run(resumed, acknowledge(hash))).rejects.toThrow(/HTTP 429 acknowledgment refused/);
    expect(resumed).not.toHaveBeenCalled();
    expect(readFileSync(checkpointFile())).toEqual(bytes);
  });

  const rewritten = (edit: (checkpoint: DurableCheckpoint) => void) => (bytes: Buffer): Prepared => {
    const checkpoint = JSON.parse(bytes.toString("utf8"));
    edit(checkpoint);
    const next = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`);
    return { bytes: next, hash: sha256(next) };
  };
  const refusedAcknowledgments: Array<[string, (bytes: Buffer) => Prepared]> = [
    ["a hash of other bytes", (bytes) => ({ bytes, hash: sha256(Buffer.concat([bytes, Buffer.from(" ")])) })],
    ["a stale hash from before a rewrite", (bytes) => ({ bytes: Buffer.concat([bytes, Buffer.from("\n")]), hash: sha256(bytes) })],
    ["the hash of another immutable snapshot", (bytes) => ({ bytes, hash: JSON.parse(bytes.toString("utf8")).snapshots[0] })],
    ["a source 429 response", rewritten((checkpoint) => { checkpoint.lastResponse = { kind: "robots", status: 429 }; })],
    ["a non-429 Places response", rewritten((checkpoint) => { checkpoint.lastResponse = { kind: "places", status: 503 }; })],
    ["no response evidence", rewritten((checkpoint) => { delete checkpoint.lastResponse; })],
    ["no durable halt", rewritten((checkpoint) => { checkpoint.halt = null; })],
    ["an unrelated halt", rewritten((checkpoint) => { checkpoint.halt = "provider request failed"; })],
    ["no active reservation", rewritten((checkpoint) => { checkpoint.active = null; })],
    ["a reservation for a completed row", rewritten((checkpoint) => { checkpoint.active = { id: "a", kind: "places" }; })],
    ["a reservation for an unknown row", rewritten((checkpoint) => { checkpoint.active = { id: "zz", kind: "places" }; })],
    ["a source reservation", rewritten((checkpoint) => { checkpoint.active = { id: "b", kind: "head" }; })],
    ["an unresolved write journal", rewritten((checkpoint) => {
      const bars = readFileSync(path.join(famous, "bars.json"), "utf8");
      checkpoint.journal = { files: [{ file: "bars.json", bytes: bars, before: checkpoint.expected["bars.json"], after: sha256(bars) }] };
    })],
  ];

  it.each(refusedAcknowledgments)("refuses a Places 429 acknowledgment with %s and leaves accounting untouched", async (_label, prepare) => {
    fundReceipt(90);
    await expect(run(placesFailure(2, known429))).rejects.toThrow(/places HTTP 429/i);
    const { bytes, hash } = prepare(readFileSync(checkpointFile()));
    writeFileSync(checkpointFile(), bytes);
    const priorSnapshots = snapshotEntries();
    const resumed = network();
    await expect(run(resumed, acknowledge(hash))).rejects.toThrow(/HTTP 429 acknowledgment refused/);
    expect(resumed).not.toHaveBeenCalled();
    expect(readFileSync(checkpointFile())).toEqual(bytes);
    expect(snapshotEntries()).toEqual(priorSnapshots);
    expect(packs()[1]).toEqual(venues[1]);
  });

  const haltedElsewhere: Array<[string, number, string, () => Transport, RegExp, number]> = [
    ["an exhausted original grant", 98, "a,b", () => placesFailure(2, known429), /places HTTP 429/i, 100],
    ["a source 429", 90, "a,b,c", () => {
      const base = network();
      return vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/robots.txt")
        ? new Response(null, { status: 429, headers: { "retry-after": "60" } }) : base(url, init));
    }, /robots HTTP 429/, 90],
    ["an unrelated provider halt", 90, "a,b,c", () => placesFailure(2, () => new Response("{}", { status: 503 })), /provider HTTP 503/, 92],
  ];

  it.each(haltedElsewhere)("refuses a Places 429 acknowledgment after %s", async (_label, spent, ids, transport, halt, spentAfter) => {
    fundReceipt(spent);
    await expect(run(transport(), args(ids))).rejects.toThrow(halt);
    const bytes = readFileSync(checkpointFile());
    expect(JSON.parse(bytes.toString("utf8")).placesCalls).toBe(spentAfter);
    const resumed = network();
    await expect(run(resumed, acknowledge(sha256(bytes), ids))).rejects.toThrow(/HTTP 429 acknowledgment refused/);
    expect(resumed).not.toHaveBeenCalled();
    expect(readFileSync(checkpointFile())).toEqual(bytes);
  });

  it("refuses a Places 429 acknowledgment for a receipt without a checkpoint", async () => {
    const fetchImpl = network();
    await expect(run(fetchImpl, acknowledge(sha256("{}")))).rejects.toThrow(/HTTP 429 acknowledgment refused/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(path.join(stateRoot, sha256(readFileSync(receipt))))).toBe(false);
    expect(packs()).toEqual(venues);
  });

  it("keeps a crashed Places reservation fail-closed and unacknowledgeable", async () => {
    fundReceipt(90);
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to).endsWith("checkpoint.json")) {
        const next = json(String(from));
        if (next.active?.kind === "places" && next.active.id === "b") {
          actual.renameSync(from, to);
          throw new Error("fixture crash after reservation checkpoint");
        }
      }
      return actual.renameSync(from, to);
    });
    const first = network();
    await expect(run(first)).rejects.toThrow(/crash after reservation/);
    vi.mocked(renameSync).mockImplementation(actual.renameSync);
    expect(placesDispatches(first)).toBe(1);
    // Simulate an operator releasing this fixture's dead writer, never a live lock.
    rmSync(path.join(taskDir(), "lock"));
    const bytes = readFileSync(checkpointFile());
    expect(JSON.parse(bytes.toString("utf8")).placesCalls).toBe(92);
    const resumed = network();
    await expect(run(resumed, acknowledge(sha256(bytes)))).rejects.toThrow(/HTTP 429 acknowledgment refused/);
    expect(readFileSync(checkpointFile())).toEqual(bytes);
    await expect(run(resumed)).rejects.toThrow(/indeterminate/);
    expect(resumed).not.toHaveBeenCalled();
    expect(packs()[1]).toEqual(venues[1]);
  });

  it("stops an invocation at its new Places bound and continues the same task under another bound", async () => {
    fundReceipt(90);
    const first = network();
    await expect(run(first, bounded("1"))).resolves.toMatchObject({ rowsChecked: 1, confirmed: 1, placesCalls: 91, exitCode: 0 });
    expect(placesDispatches(first)).toBe(1);
    expect(lastDispatch(first)).toContain("places.googleapis.com");
    const paused = json(checkpointFile());
    expect(paused.placesCalls).toBe(91);
    expect(paused.sourceCalls).toBe(first.mock.calls.length - 1);
    expect(paused.halt ?? null).toBeNull();
    expect(paused.active ?? null).toBeNull();
    expect(statuses(paused)).toEqual([["a", "completed"], ["b", "pending"], ["c", "pending"]]);
    expect(packs().map((venue: Row) => venue.observedAt)).toEqual(["2026-10-21", "2026-08-25", "2026-08-25"]);

    const second = network();
    await expect(run(second, bounded("2"))).resolves.toMatchObject({ rowsChecked: 3, confirmed: 3, placesCalls: 93, exitCode: 0 });
    expect(placesDispatches(second)).toBe(2);
    const finished = json(checkpointFile());
    expect(finished.placesCalls).toBe(93);
    expect(finished.sourceCalls).toBe(paused.sourceCalls + second.mock.calls.length - 2);
    expect(finished.scopeHash).toBe(paused.scopeHash);
    expect(finished.receiptHash).toBe(paused.receiptHash);
    expect(statuses(finished)).toEqual([["a", "completed"], ["b", "completed"], ["c", "completed"]]);
    expect(readdirSync(stateRoot)).toHaveLength(1);
    expect(json(path.join(famous, "verification_2026-10-21.json")).summary.placesLiveApiCalls).toBe(3);

    const third = network();
    await expect(run(third)).resolves.toMatchObject({ rowsChecked: 3, placesCalls: 93 });
    expect(third).not.toHaveBeenCalled();
  });

  it("retries only the acknowledged row under a one-call invocation bound", async () => {
    fundReceipt(90);
    await expect(run(placesFailure(2, known429))).rejects.toThrow(/places HTTP 429/i);
    const hash = sha256(readFileSync(checkpointFile()));
    const resumed = network();
    await expect(run(resumed, [...acknowledge(hash), "--max-new-places-calls", "1"]))
      .resolves.toMatchObject({ rowsChecked: 2, placesCalls: 93, exitCode: 0 });
    expect(placesDispatches(resumed)).toBe(1);
    expect(lastDispatch(resumed)).toContain("places.googleapis.com");
    const paused = json(checkpointFile());
    expect(paused.halt ?? null).toBeNull();
    expect(paused.active ?? null).toBeNull();
    expect(statuses(paused)).toEqual([["a", "completed"], ["b", "completed"], ["c", "pending"]]);
    const later = network();
    await expect(run(later)).resolves.toMatchObject({ rowsChecked: 3, placesCalls: 94 });
    expect(placesDispatches(later)).toBe(1);
    expect(json(checkpointFile()).http429Acknowledgments).toEqual([{ checkpointSha256: hash, id: "b" }]);
  });

  it("lets the original receipt ceiling win over a larger invocation bound", async () => {
    fundReceipt(99);
    const fetchImpl = network();
    await expect(run(fetchImpl, bounded("5"))).rejects.toThrow(/Places budget exhausted/);
    expect(placesDispatches(fetchImpl)).toBe(1);
    expect(json(checkpointFile()).placesCalls).toBe(100);
    expect(packs().map((venue: Row) => venue.observedAt)).toEqual(["2026-10-21", "2026-08-25", "2026-08-25"]);
    const resumed = network();
    await expect(run(resumed, bounded("1"))).rejects.toThrow(/halt|budget/);
    expect(resumed).not.toHaveBeenCalled();
    expect(json(checkpointFile()).placesCalls).toBe(100);
  });

  it.each(["0", "-1", "1.5", "two"])("refuses the invocation bound %s before transport", async (bound) => {
    const fetchImpl = network();
    await expect(run(fetchImpl, bounded(bound))).rejects.toThrow(/--max-new-places-calls must be a positive integer/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(stateRoot)).toBe(false);
    expect(packs()).toEqual(venues);
  });

  it("persists only allowlisted Places 429 quota evidence beside hostile error text", async () => {
    const fetchImpl = placesFailure(2, quota429({
      error: {
        code: 429,
        message: "Quota exceeded MESSAGE_CANARY for key fake-test-key",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "RATE_LIMIT_EXCEEDED",
            domain: "googleapis.com",
            metadata: {
              quota_metric: "places.googleapis.com/search_text_requests",
              quota_limit: "SearchTextRequestsPerMinutePerProject",
              consumer: "projects/123456789012",
              service: "places.googleapis.com",
              note: "METADATA_CANARY https://evil.example/collect",
            },
          },
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ subject: "SUBJECT_CANARY", description: "DESCRIPTION_CANARY" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" },
          { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "HELP_CANARY", url: "https://evil.example/help" }] },
        ],
      },
    }, "60"));
    await expect(run(fetchImpl, args("a,b"))).rejects.toThrow(/places HTTP 429/i);
    const text = readFileSync(checkpointFile(), "utf8");
    const checkpoint = JSON.parse(text);
    expect(checkpoint.halt).toMatch(/^places HTTP 429$/i);
    expect(present(checkpoint.lastResponse)).toEqual({
      kind: "places",
      status: 429,
      errorStatus: "RESOURCE_EXHAUSTED",
      quotaMetric: "places.googleapis.com/search_text_requests",
      quotaLimit: "SearchTextRequestsPerMinutePerProject",
      quotaConsumer: "projects/123456789012",
      retryDelay: "30s",
      retryAfter: "60",
    });
    for (const leaked of ["CANARY", "evil.example", "fake-test-key", "Quota exceeded", "OPERATIONAL", "41-43 Wardour St, London W1D 6PY, UK"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it.each<[string, unknown, string]>([
    ["identifiers outside their known patterns", {
      error: {
        code: 429,
        message: "MESSAGE_CANARY",
        status: "STATUS_CANARY",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "RATE_LIMIT_EXCEEDED",
            domain: "googleapis.com",
            metadata: {
              quota_metric: "https://evil.example/METRIC_CANARY",
              quota_limit: "Limit LIMIT_CANARY <script>",
              consumer: "projects/123456789012/../CONSUMER_CANARY",
            },
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "-30s" },
        ],
      },
    }, "60 RETRY_AFTER_CANARY"],
    ["values of the wrong type", {
      error: {
        code: "429",
        status: ["RESOURCE_EXHAUSTED"],
        message: { text: "MESSAGE_CANARY" },
        details: { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s", note: "DETAILS_CANARY" },
      },
    }, "-1"],
  ])("drops Places 429 evidence with %s and invents no reset window", async (_label, body, retryAfter) => {
    await expect(run(placesFailure(1, quota429(body, retryAfter)), args("a"))).rejects.toThrow(/places HTTP 429/i);
    const text = readFileSync(checkpointFile(), "utf8");
    expect(present(JSON.parse(text).lastResponse)).toEqual({ kind: "places", status: 429 });
    expect(text).not.toContain("CANARY");
    expect(text).not.toContain("evil.example");
  });

  it.each<[string, () => ConstructorParameters<typeof Response>[0]]>([
    ["missing", () => null],
    ["malformed", () => '{"error":{"status":"RESOURCE_EXHAUSTED","message":"MESSAGE_CANARY"'],
    ["oversized", () => new Uint8Array(1024 * 1024 + 1).fill(123)],
    ["unreadable", () => new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("UNREADABLE_CANARY")); } })],
    ["endless", () => endlessBody()],
  ])("keeps a returned Places 429 known when its body is %s", async (_label, body) => {
    const failure = () => new Response(body(), { status: 429, headers: { "retry-after": "45" } });
    await expect(run(placesFailure(1, failure), args("a"))).rejects.toThrow(/places HTTP 429/i);
    const bytes = readFileSync(checkpointFile());
    const checkpoint = JSON.parse(bytes.toString("utf8"));
    expect(checkpoint.halt).toMatch(/^places HTTP 429$/i);
    expect(checkpoint.placesCalls).toBe(99);
    expect(present(checkpoint.lastResponse)).toEqual({ kind: "places", status: 429, retryAfter: "45" });
    expect(bytes.toString("utf8")).not.toContain("CANARY");
    const resumed = network();
    await expect(run(resumed, acknowledge(sha256(bytes), "a"))).resolves.toMatchObject({ confirmed: 1, placesCalls: 100 });
    expect(placesDispatches(resumed)).toBe(1);
  });

  it("cancels an endless Places 429 body within the Places byte bound", async () => {
    const trace = { pulls: 0, cancelled: false };
    const failure = () => new Response(endlessBody(trace), { status: 429 });
    await expect(run(placesFailure(1, failure), args("a"))).rejects.toThrow(/places HTTP 429/i);
    expect(trace.cancelled).toBe(true);
    expect(trace.pulls).toBeLessThanOrEqual((1024 * 1024) / (64 * 1024) + 2);
    expect(json(checkpointFile()).halt).toMatch(/^places HTTP 429$/i);
  });

  it("keeps a stalled Places 429 body known at the 20 second deadline and aborts its dispatch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const dispatched: { signal?: AbortSignal | null } = {};
      const base = network();
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (!String(url).includes("places.googleapis.com")) return base(url, init);
        dispatched.signal = init?.signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(new Error("STALLED_CANARY aborted")), { once: true });
          },
        }), { status: 429, headers: { "retry-after": "45" } });
      });
      const outcome = run(fetchImpl, args("a")).then(() => null, (error: Error) => error);
      await vi.advanceTimersByTimeAsync(20_000);
      await flush();
      await flush();
      const settled = await Promise.race([outcome, Promise.resolve("still pending")]);
      expect(settled).toBeInstanceOf(Error);
      expect(String(settled)).toMatch(/places HTTP 429/i);
      expect(dispatched.signal?.aborted).toBe(true);
      const checkpoint = json(checkpointFile());
      expect(checkpoint.halt).toMatch(/^places HTTP 429$/i);
      expect(checkpoint.placesCalls).toBe(99);
      expect(present(checkpoint.lastResponse)).toEqual({ kind: "places", status: 429, retryAfter: "45" });
    } finally {
      vi.useRealTimers();
    }
  });
});

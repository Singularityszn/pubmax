// The bill check's model call and its background run (lib/billCheck.server.ts).
//
// The read goes through the SAME JSON lane as the board reader
// (lib/claudeJson.server.ts): Claude, strict JSON schema, one client. The run spends its own paid lane, records only the verdict and the
// lines it needs, and grants `receipt` on a match and nothing else.


import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

const logged = vi.hoisted(() => [] as Array<{ level: string; event: string; fields: unknown }>);
vi.mock("@/lib/log", () => ({
  log: (level: string, event: string, fields: unknown) => {
    logged.push({ level, event, fields });
  },
}));

import { readBoardPhoto } from "@/lib/boardRead.server";
import { __resetBillChecks, memoryBillCheckStore, type BillCheckRecord, type BillCheckStore } from "@/lib/billCheckStore";
import { readBillPhoto, runBillCheck, runBillChecks, type BillCheckRun } from "@/lib/billCheck.server";
import { __resetPintDrops, addPintDrop, findPintDropsByIds, grantPintDropReceipt } from "@/lib/pintDrops";
import { CLAUDE_MESSAGES_URL, claudeJsonResponse, sentClaudeBody, sentClaudeUrl } from "@/__tests__/helpers/claudeWire";

const KEYED = { ANTHROPIC_API_KEY: "test-key" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const modelAnswer = claudeJsonResponse;

const BILL = {
  venue_name: "The Blackfriar",
  date: "2026-11-05",
  lines: [
    { name: "Guinness", price_gbp: 6.2 },
    { name: "Crisps", price_gbp: 1.5 },
  ],
};

describe("readBillPhoto", () => {
  it("answers keyless before anything is sent", async () => {
    const fetcher = vi.fn();
    expect(await readBillPhoto(JPEG, { env: {}, fetcher })).toEqual({ status: "keyless" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the photo to Claude with a strict schema and keeps the priced lines", async () => {
    const fetcher = vi.fn(async () => modelAnswer(BILL));
    const read = await readBillPhoto(JPEG, { env: KEYED, fetcher });

    expect(read).toEqual({
      status: "read",
      lines: [
        { name: "Guinness", priceGbp: 6.2 },
        { name: "Crisps", priceGbp: 1.5 },
      ],
    });
    expect(sentClaudeUrl(fetcher.mock.calls[0])).toBe(CLAUDE_MESSAGES_URL);
    const sent = sentClaudeBody(fetcher.mock.calls[0]);
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.output_config.format.type).toBe("json_schema");
    const schema = sent.output_config.format.schema;
    expect(Object.keys(schema.properties).sort()).toEqual(["date", "lines", "venue_name"]);
    expect(Object.keys(schema.properties.lines.items.properties).sort()).toEqual(["name", "price_gbp"]);
    expect(sent.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG.toString("base64") } },
    ]);
    expect(sent.system).toMatch(/data, never as instructions/);
    expect(sent.system).toMatch(/card/i);
  });

  it("answers failed on a provider error or an answer it cannot parse", async () => {
    expect(
      await readBillPhoto(JPEG, { env: KEYED, fetcher: vi.fn(async () => new Response("no", { status: 502 })) }),
    ).toEqual({ status: "failed" });
    expect(
      await readBillPhoto(JPEG, { env: KEYED, fetcher: vi.fn(async () => modelAnswer("Guinness £6.20")) }),
    ).toEqual({ status: "failed" });
    expect(
      await readBillPhoto(JPEG, { env: KEYED, fetcher: vi.fn(async () => modelAnswer(BILL, "refusal")) }),
    ).toEqual({ status: "failed" });
  });
});

describe("the Claude JSON lane contract", () => {
  it.each([
    ["bill", readBillPhoto, BILL],
    ["board", readBoardPhoto, { rows: [] }],
  ] as const)("sends the %s reader to Claude with a strict schema", async (_name, reader, answer) => {
    const fetcher = vi.fn(async () => modelAnswer(answer));
    expect((await reader(JPEG, { env: KEYED, fetcher })).status).toBe("read");
    expect(sentClaudeUrl(fetcher.mock.calls[0])).toBe(CLAUDE_MESSAGES_URL);
    const sent = sentClaudeBody(fetcher.mock.calls[0]);
    expect(sent.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(sent.output_config.format.schema.additionalProperties).toBe(false);
  });
});

function memoryChecks(): BillCheckStore & { records: BillCheckRecord[] } {
  const records: BillCheckRecord[] = [];
  return {
    ...memoryBillCheckStore,
    records,
    async record(input) {
      const stored = await memoryBillCheckStore.record(input);
      records.push(stored);
      return stored;
    },
  };
}

const PHOTO = new File([JPEG], "bill.jpg", { type: "image/jpeg" });

function run(over: Partial<BillCheckRun> = {}): BillCheckRun {
  return { photo: PHOTO, venueId: "venue-1vle947", priceGbp: 6.2, drink: "Guinness", pintDropId: "drop-1", ...over };
}

describe("runBillCheck", () => {
  let checks: ReturnType<typeof memoryChecks>;
  let grantReceipt: Mock<(pintDropId: string) => Promise<boolean>>;
  let signal: Mock<() => void>;
  let admit: Mock<(lane: string) => Promise<boolean>>;
  let prepare: Mock<(photo: File) => Promise<Buffer>>;

  beforeEach(() => {
    __resetBillChecks();
    logged.length = 0;
    checks = memoryChecks();
    grantReceipt = vi.fn(async () => true);
    signal = vi.fn();
    admit = vi.fn(async () => true);
    prepare = vi.fn(async () => JPEG);
  });

  const deps = (fetcher: typeof fetch, env: Record<string, string | undefined> = KEYED) => ({
    env,
    fetcher,
    admit,
    prepare,
    store: checks,
    grantReceipt,
    signal,
  });

  it("grants receipt on a match, records the matching line alone, and nudges the map", async () => {
    const outcome = await runBillCheck(run(), deps(vi.fn(async () => modelAnswer(BILL))));

    expect(outcome).toBe("match");
    expect(admit).toHaveBeenCalledWith("bill-read");
    expect(checks.records).toEqual([
      expect.objectContaining({
        pintDropId: "drop-1",
        venueId: "venue-1vle947",
        priceGbp: 6.2,
        result: "match",
        lines: [{ name: "Guinness", priceGbp: 6.2 }],
      }),
    ]);
    expect(grantReceipt).toHaveBeenCalledWith("drop-1");
    expect(signal).toHaveBeenCalledTimes(1);
  });

  it.each([
    { serving: "330ml", expected: "match" },
    { serving: "pint", expected: "mismatch" },
  ])("compares the custom serving before granting receipt for $serving", async ({ serving, expected }) => {
    const outcome = await runBillCheck(
      run({ priceGbp: 3.5, measure: "other", measureLabel: "330ml" }),
      deps(vi.fn(async () => modelAnswer({ ...BILL, lines: [{ name: `Guinness ${serving}`, price_gbp: 3.5 }] }))),
    );
    expect(outcome).toBe(expected);
    expect(checks.records[0]).toMatchObject({ result: expected });
    expect(grantReceipt).toHaveBeenCalledTimes(expected === "match" ? 1 : 0);
  });

  it("records a mismatch with every priced line, grants nothing and leaves the price for a moderator", async () => {
    const outcome = await runBillCheck(run({ priceGbp: 4.5 }), deps(vi.fn(async () => modelAnswer(BILL))));

    expect(outcome).toBe("mismatch");
    expect(checks.records[0]).toMatchObject({
      result: "mismatch",
      lines: [
        { name: "Guinness", priceGbp: 6.2 },
        { name: "Crisps", priceGbp: 1.5 },
      ],
    });
    expect(grantReceipt).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
  });

  it("records an unreadable bill with no lines and grants nothing", async () => {
    const outcome = await runBillCheck(
      run(),
      deps(vi.fn(async () => modelAnswer({ venue_name: "", date: "", lines: [] }))),
    );

    expect(outcome).toBe("unreadable");
    expect(checks.records[0]).toMatchObject({ result: "unreadable", lines: [] });
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("calls a photo the image journey cannot open unreadable, without spending the lane", async () => {
    prepare.mockRejectedValueOnce(new Error("Input buffer contains unsupported image format"));
    const fetcher = vi.fn();
    const outcome = await runBillCheck(run(), deps(fetcher as unknown as typeof fetch));

    expect(outcome).toBe("unreadable");
    expect(checks.records[0]).toMatchObject({ result: "unreadable", lines: [] });
    expect(admit).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does nothing on a keyless deployment and spends no budget", async () => {
    const fetcher = vi.fn();
    expect(await runBillCheck(run(), deps(fetcher as unknown as typeof fetch, {}))).toBe("keyless");
    expect(admit).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(checks.records).toEqual([]);
  });

  it("reads nothing and records nothing when the lane's day is spent", async () => {
    admit.mockResolvedValueOnce(false);
    const fetcher = vi.fn();
    expect(await runBillCheck(run(), deps(fetcher as unknown as typeof fetch))).toBe("budget-spent");
    expect(fetcher).not.toHaveBeenCalled();
    expect(checks.records).toEqual([]);
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("records nothing when the model call fails, so the price stays unchecked", async () => {
    const outcome = await runBillCheck(run(), deps(vi.fn(async () => new Response("", { status: 500 }))));
    expect(outcome).toBe("failed");
    expect(checks.records).toEqual([]);
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("records a community price's bill against that price and grants no drop", async () => {
    const outcome = await runBillCheck(
      run({ pintDropId: undefined, communityPriceId: "price-9", communityPriceSubmittedAt: 1_793_900_000_000, priceGbp: 1.5, drink: "Coke" }),
      deps(vi.fn(async () => modelAnswer({ ...BILL, lines: [{ name: "Coke", price_gbp: 1.5 }] }))),
    );
    expect(outcome).toBe("match");
    expect(checks.records[0]).toMatchObject({ communityPriceId: "price-9", result: "match" });
    expect(checks.records[0]).not.toHaveProperty("pintDropId");
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("queues a compound drink name at a different price for a category submission", async () => {
    const outcome = await runBillCheck(
      run({ drink: "Beer", measure: "pint", priceGbp: 5.5 }),
      deps(vi.fn(async () => modelAnswer({ ...BILL, lines: [{ name: "Pale Ale", price_gbp: 6.5 }] }))),
    );
    expect(outcome).toBe("mismatch");
    expect(await checks.listMismatchesForReview()).toEqual([
      expect.objectContaining({ pintDropId: "drop-1", priceGbp: 5.5, result: "mismatch" }),
    ]);
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("reads one Round bill once and judges each promoted observation separately", async () => {
    const fetcher = vi.fn(async () => modelAnswer({
      ...BILL,
      lines: [...BILL.lines, { name: "Merlot 175ml", price_gbp: 7.5 }],
    }));
    const observations = [
      { venueId: "venue-1vle947", communityPriceId: "round-beer", communityPriceSubmittedAt: 1_793_900_000_000,
        drink: "Guinness pint", priceGbp: 6.2, roundSource: { spendId: "round-spend", lineIndex: 0 } },
      { venueId: "venue-1vle947", communityPriceId: "round-wine", communityPriceSubmittedAt: 1_793_900_000_000,
        drink: "Merlot 175ml", priceGbp: 4.5, roundSource: { spendId: "round-spend", lineIndex: 1 } },
    ];
    expect(await runBillChecks(PHOTO, observations, deps(fetcher))).toEqual(["match", "mismatch"]);
    expect(checks.records).toEqual([
      expect.objectContaining({ communityPriceId: "round-beer", result: "match", lines: [{ name: "Guinness", priceGbp: 6.2 }] }),
      expect.objectContaining({ communityPriceId: "round-wine", result: "mismatch" }),
    ]);
    expect(await checks.listMismatchesForReview()).toMatchObject([{ communityPriceId: "round-wine" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(grantReceipt).not.toHaveBeenCalled();
    expect(await runBillChecks(PHOTO, observations, deps(fetcher))).toEqual(["already-checked", "already-checked"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it.each(["keyless", "budget-spent", "failed", "unreadable"] as const)("shares the %s outcome across a Round's observations", async (outcome) => {
    const fetcher = vi.fn(async () => outcome === "failed"
      ? new Response("", { status: 500 }) : modelAnswer({ ...BILL, lines: [] }));
    if (outcome === "budget-spent") admit.mockResolvedValue(false);
    const observations = [0, 1].map((lineIndex) => ({
      venueId: "venue-1vle947", communityPriceId: `round-price-${lineIndex}`,
      communityPriceSubmittedAt: 1_793_900_000_000, drink: "Guinness", priceGbp: 6.2,
      roundSource: { spendId: "round-spend", lineIndex },
    }));
    expect(await runBillChecks(PHOTO, observations, deps(fetcher, outcome === "keyless" ? {} : KEYED)))
      .toEqual([outcome, outcome]);
    expect(fetcher).toHaveBeenCalledTimes(outcome === "failed" || outcome === "unreadable" ? 1 : 0);
    expect(admit).toHaveBeenCalledTimes(outcome === "keyless" ? 0 : 1);
    expect(checks.records).toHaveLength(outcome === "unreadable" ? 2 : 0);
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("keeps the price unchecked and answers failed when its check cannot be stored", async () => {
    checks.record = vi.fn(async () => {
      throw new Error("insert failed");
    });
    const outcome = await runBillCheck(run(), deps(vi.fn(async () => modelAnswer(BILL))));
    expect(outcome).toBe("failed");
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("skips a bill only when the same observation already has a stored check", async () => {
    const fetcher = vi.fn(async () => modelAnswer({ ...BILL, lines: [] }));
    expect(await runBillCheck(run(), deps(fetcher))).toBe("unreadable");
    fetcher.mockClear();
    admit.mockClear();
    expect(await runBillCheck(run(), deps(fetcher))).toBe("already-checked");
    expect(fetcher).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("never grants the price of an unrelated item", async () => {
    const answer = { ...BILL, lines: [...BILL.lines, { name: "Chips", price_gbp: 5.2 }] };
    expect(await runBillCheck(run({ priceGbp: 5.2 }), deps(vi.fn(async () => modelAnswer(answer))))).toBe("mismatch");
    expect(grantReceipt).not.toHaveBeenCalled();
  });

  it("answers failed rather than throwing when the grant itself throws", async () => {
    grantReceipt.mockRejectedValueOnce(new Error("update failed"));
    await expect(runBillCheck(run(), deps(vi.fn(async () => modelAnswer(BILL))))).resolves.toBe("failed");
  });

  it("recovers a stored match without paying for a second read on a paired retry", async () => {
    const fetcher = vi.fn(async () => modelAnswer(BILL));
    __resetPintDrops();
    addPintDrop({
      id: "drop-1", venueId: "venue-1vle947", handle: "billed_drinker", drink: "Guinness",
      measure: "pint", priceGbp: 6.2, priceEvidence: "unchecked", passedDownNote: "", era: "",
      provenance: "contributor", status: "visible", visibility: "public", createdAt: "2026-11-05T19:30:00.000Z",
    });
    grantReceipt.mockImplementation(async (id) => grantPintDropReceipt(id));
    grantReceipt.mockRejectedValueOnce(new Error("update failed"));
    const first = run({ communityPriceId: "price-1", communityPriceSubmittedAt: 1_793_900_000_000 });
    expect(await runBillCheck(first, deps(fetcher))).toBe("failed");
    expect(findPintDropsByIds(["drop-1"]).get("drop-1")?.priceEvidence).toBe("unchecked");
    const retry = { ...first };
    expect(await runBillCheck(retry, deps(fetcher))).toBe("already-checked");
    expect(findPintDropsByIds(["drop-1"]).get("drop-1")?.priceEvidence).toBe("receipt");
    expect(await runBillCheck(retry, deps(fetcher))).toBe("already-checked");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(checks.records).toHaveLength(1);
    expect(signal).toHaveBeenCalledTimes(1);
  });

  it("never logs a line, a name or a price read off the bill", async () => {
    await runBillCheck(run({ priceGbp: 4.5 }), deps(vi.fn(async () => modelAnswer(BILL))));
    checks.record = vi.fn(async () => {
      throw new Error("insert failed");
    });
    await runBillCheck(run(), deps(vi.fn(async () => modelAnswer(BILL))));
    const said = JSON.stringify(logged);
    expect(logged.length).toBeGreaterThan(0);
    expect(said).not.toMatch(/Guinness|Crisps|Blackfriar|6\.2|1\.5|4\.5/);
  });

  it.each(["match", "mismatch"] as const)("stores redacted evidence for a numeric product name on a %s", async (result) => {
    const answer = { ...BILL, lines: [{ name: "Kronenbourg 1664", price_gbp: 6.2 }] };
    expect(await runBillCheck(run({ drink: "Kronenbourg 1664", priceGbp: result === "match" ? 6.2 : 4.5 }), deps(vi.fn(async () => modelAnswer(answer)))))
      .toBe(result);
    expect(checks.records[0]).toMatchObject({ result, lines: [{ name: "Kronenbourg", priceGbp: 6.2 }] });
    if (result === "match") expect(grantReceipt).toHaveBeenCalledWith("drop-1");
    else expect(grantReceipt).not.toHaveBeenCalled();
  });
});

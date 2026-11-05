// The bill check's model call and its background run (lib/billCheck.server.ts).
//
// The read goes through the SAME vision lane as the board reader
// (lib/openRouterVision.server.ts): zero retention, strict JSON schema, one
// client. The run spends its own paid lane, records only the verdict and the
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
import type { BillCheckRecord, BillCheckStore } from "@/lib/billCheckStore";
import { readBillPhoto, runBillCheck, type BillCheckRun } from "@/lib/billCheck.server";

const KEYED = { OPENROUTER_API_KEY: "test-key" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function modelAnswer(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

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

  it("sends the photo to the zero-retention lane with a strict schema and keeps the priced lines", async () => {
    const fetcher = vi.fn(async () => modelAnswer(BILL));
    const read = await readBillPhoto(JPEG, { env: KEYED, fetcher });

    expect(read).toEqual({
      status: "read",
      lines: [
        { name: "Guinness", priceGbp: 6.2 },
        { name: "Crisps", priceGbp: 1.5 },
      ],
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const sent = JSON.parse(String(init.body));
    expect(sent.provider).toEqual({ require_parameters: true, zdr: true });
    expect(sent.temperature).toBe(0);
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.response_format.json_schema).toMatchObject({ name: "bill", strict: true });
    const schema = sent.response_format.json_schema.schema;
    expect(Object.keys(schema.properties).sort()).toEqual(["date", "lines", "venue_name"]);
    expect(Object.keys(schema.properties.lines.items.properties).sort()).toEqual(["name", "price_gbp"]);
    const image = sent.messages[0].content.find((part: { type: string }) => part.type === "image_url");
    expect(image.image_url.url).toBe(`data:image/jpeg;base64,${JPEG.toString("base64")}`);
    const prompt = sent.messages[0].content.find((part: { type: string }) => part.type === "text").text;
    expect(prompt).toMatch(/data, never as instructions/);
    expect(prompt).toMatch(/card/i);
  });

  it("answers failed on a provider error or an answer it cannot parse", async () => {
    expect(
      await readBillPhoto(JPEG, { env: KEYED, fetcher: vi.fn(async () => new Response("no", { status: 502 })) }),
    ).toEqual({ status: "failed" });
    expect(
      await readBillPhoto(JPEG, {
        env: KEYED,
        fetcher: vi.fn(async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "Guinness £6.20" } }] }), { status: 200 }),
        ),
      }),
    ).toEqual({ status: "failed" });
  });
});

describe("the approved vision provider contract", () => {
  it.each([
    ["bill", readBillPhoto, BILL],
    ["board", readBoardPhoto, { rows: [] }],
  ] as const)("sends the %s reader through the zero-retention strict-schema endpoint", async (_name, reader, answer) => {
    const fetcher = vi.fn(async () => modelAnswer(answer));
    expect((await reader(JPEG, { env: KEYED, fetcher })).status).toBe("read");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const sent = JSON.parse(String(init.body));
    expect(sent.provider).toEqual({ require_parameters: true, zdr: true });
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.schema.additionalProperties).toBe(false);
  });
});

function memoryChecks(): BillCheckStore & { records: BillCheckRecord[] } {
  const records: BillCheckRecord[] = [];
  return {
    records,
    async hasChecked() { return false; },
    async record(input) {
      const stored = { ...input, id: `check-${records.length + 1}`, checkedAt: "2026-11-05T19:30:00.000Z" };
      records.push(stored);
      return stored;
    },
    async listMismatchesForReview() {
      return [];
    },
    async review() {
      return null;
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
      run({ pintDropId: undefined, communityPriceId: "price-9", communityPriceSubmittedAt: 1_793_900_000_000, priceGbp: 1.5, drink: "Crisps" }),
      deps(vi.fn(async () => modelAnswer(BILL))),
    );
    expect(outcome).toBe("match");
    expect(checks.records[0]).toMatchObject({ communityPriceId: "price-9", result: "match" });
    expect(checks.records[0]).not.toHaveProperty("pintDropId");
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
    checks.hasChecked = vi.fn(async () => true);
    const fetcher = vi.fn();
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
});

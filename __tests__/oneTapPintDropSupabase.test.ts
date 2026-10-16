import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deletePhotos,
  ensureProfile,
  rpc,
  toDTOWithPhotos,
  uploadPhoto,
} = vi.hoisted(() => ({
  deletePhotos: vi.fn(),
  ensureProfile: vi.fn(),
  rpc: vi.fn(),
  toDTOWithPhotos: vi.fn(),
  uploadPhoto: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ rpc }),
  };
});

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ ensure: ensureProfile }),
}));

vi.mock("@/lib/pintDropsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDropsStore")>();
  return {
    ...actual,
    deletePhotos,
    toDTOWithPhotos,
    uploadPhoto,
  };
});

import * as oneTapModule from "@/lib/oneTapPintDrop.server";
import { toDTO } from "@/lib/pintDropsStore";

type PairWriter = (
  input: {
    venueId: string;
    handle: string;
    drinkCategory: "beer";
    priceGbp: number;
    actor: string;
    verifiedAccountId?: string;
  },
  photos?: { pint: File | null; venue: File | null },
) => Promise<
  | { ok: true; price: { priceGbp: number }; drop: { priceGbp: number } }
  | { ok: false; kind: string; message: string }
>;

function pairWriter(): PairWriter | undefined {
  return (oneTapModule as unknown as { writeOneTapPricePair?: PairWriter })
    .writeOneTapPricePair;
}

type ReceiptArgs = Readonly<{
  p_drop_id: string;
  p_submitted_at?: string;
  p_drop_submitted_at?: string;
  p_requested_price_pennies?: number;
}>;

function validReceipt(
  args: ReceiptArgs,
  overrides: Record<string, unknown> = {},
) {
  return {
    price_id: "00000000-0000-4000-8000-000000000140",
    price_pennies: 510,
    requested_price_pennies: args.p_requested_price_pennies ?? 420,
    submitted_at: "2026-08-31T20:00:00.000Z",
    drop_submitted_at:
      args.p_submitted_at ??
      args.p_drop_submitted_at ??
      "2026-08-31T19:00:00.000Z",
    drop_id: args.p_drop_id,
    venue_id: "venue-xjf3n0",
    drink_category: "beer",
    ...overrides,
  };
}

const INPUT = {
  venueId: "venue-xjf3n0",
  handle: "karan",
  drinkCategory: "beer" as const,
  priceGbp: 4.2,
  actor: "profile:test",
  verifiedAccountId: "account-a",
};

beforeEach(() => {
  deletePhotos.mockReset();
  deletePhotos.mockResolvedValue(undefined);
  ensureProfile.mockReset();
  ensureProfile.mockResolvedValue(undefined);
  rpc.mockReset();
  toDTOWithPhotos.mockReset();
  toDTOWithPhotos.mockImplementation(
    async (drop: import("@/lib/pintDropsStore").PersistableDrop) => toDTO(drop),
  );
  uploadPhoto.mockReset();
  uploadPhoto.mockResolvedValue("venue-xjf3n0/drop-a/pint.jpg");
});

describe("writeOneTapPricePair durable receipt", () => {
  it("commits through one named RPC and uses its stored winning price", async () => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc.mockImplementation(async (_name: string, args: ReceiptArgs) => ({
      data: [validReceipt(args)],
      error: null,
    }));

    const outcome = await write(INPUT);

    expect(rpc).toHaveBeenCalledWith("create_one_tap_price_pair", {
      p_actor: "profile:test",
      p_authority_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_contributor_handle: "karan",
      p_drink: "Beer",
      p_drink_category: "beer",
      p_drop_id: expect.any(String),
      p_handle: "karan",
      p_pint_photo_key: null,
      p_price_pennies: 420,
      p_submitted_at: expect.any(String),
      p_venue_id: "venue-xjf3n0",
      p_venue_photo_key: null,
    });
    expect(outcome).toMatchObject({
      ok: true,
      price: { priceGbp: 5.1 },
      drop: { priceGbp: 5.1 },
    });
  });

  it.each([50, 3_001])(
    "refuses out-of-envelope receipt pennies %s",
    async (pricePennies) => {
      const write = pairWriter();
      expect(write).toBeTypeOf("function");
      if (!write) return;
      rpc.mockImplementation(async (_name: string, args: ReceiptArgs) => ({
        data: [validReceipt(args, { price_pennies: pricePennies })],
        error: null,
      }));

      await expect(write(INPUT)).resolves.toMatchObject({
        ok: false,
        kind: "storage",
      });
    },
  );

  it.each([
    ["wrong Venue", { venue_id: "venue-other" }],
    ["wrong drink category", { drink_category: "wine" }],
    ["invalid timestamp", { submitted_at: "not-a-date" }],
    ["wrong drop timestamp", { drop_submitted_at: "2026-08-31T18:00:00.000Z" }],
    ["wrong requested price", { requested_price_pennies: 430 }],
  ])("refuses a receipt with %s", async (_case, override) => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc.mockImplementation(async (_name: string, args: ReceiptArgs) => ({
      data: [validReceipt(args, override)],
      error: null,
    }));

    await expect(write(INPUT)).resolves.toMatchObject({
      ok: false,
      kind: "storage",
    });
  });

  it("does not delete committed photo objects when response URL signing fails", async () => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc.mockImplementation(async (_name: string, args: ReceiptArgs) => ({
      data: [validReceipt(args)],
      error: null,
    }));
    toDTOWithPhotos.mockRejectedValueOnce(new Error("signing unavailable"));

    const outcome = await write(INPUT, {
      pint: new File(["photo"], "pint.jpg", { type: "image/jpeg" }),
      venue: null,
    });

    expect(outcome).toMatchObject({
      ok: true,
      price: { priceGbp: 5.1 },
      drop: { priceGbp: 5.1, pintPhotoUrl: null },
    });
    expect(deletePhotos).not.toHaveBeenCalled();
  });

  it("recovers a committed pair after the RPC response is lost", async () => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc.mockImplementation(async (name: string, args: ReceiptArgs) => {
      if (name === "create_one_tap_price_pair") {
        return { data: null, error: { message: "response timed out" } };
      }
      return { data: [validReceipt(args)], error: null };
    });

    const outcome = await write(INPUT, {
      pint: new File(["photo"], "pint.jpg", { type: "image/jpeg" }),
      venue: null,
    });

    expect(outcome).toMatchObject({
      ok: true,
      price: { priceGbp: 5.1 },
      drop: { venueId: "venue-xjf3n0", priceGbp: 5.1 },
    });
    expect(rpc).toHaveBeenLastCalledWith("recover_one_tap_price_pair", {
      p_actor: "profile:test",
      p_drink_category: "beer",
      p_drop_id: expect.any(String),
      p_drop_submitted_at: expect.any(String),
      p_requested_price_pennies: 420,
    });
    expect(deletePhotos).not.toHaveBeenCalled();
  });

  it("cleans uploaded photos only after recovery confirms no pair committed", async () => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "write rejected" },
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const outcome = await write(INPUT, {
      pint: new File(["photo"], "pint.jpg", { type: "image/jpeg" }),
      venue: null,
    });

    expect(outcome).toMatchObject({ ok: false, kind: "storage" });
    expect(rpc).toHaveBeenLastCalledWith("recover_one_tap_price_pair", {
      p_actor: "profile:test",
      p_drink_category: "beer",
      p_drop_id: expect.any(String),
      p_drop_submitted_at: expect.any(String),
      p_requested_price_pennies: 420,
    });
    expect(deletePhotos).toHaveBeenCalledWith([
      "venue-xjf3n0/drop-a/pint.jpg",
    ]);
  });

  it("keeps uploaded photos when recovery cannot confirm the pair state", async () => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce({
        data: null,
        error: { message: "recovery unavailable" },
      });

    const outcome = await write(INPUT, {
      pint: new File(["photo"], "pint.jpg", { type: "image/jpeg" }),
      venue: null,
    });

    expect(outcome).toMatchObject({ ok: false, kind: "storage" });
    expect(rpc).toHaveBeenLastCalledWith("recover_one_tap_price_pair", {
      p_actor: "profile:test",
      p_drink_category: "beer",
      p_drop_id: expect.any(String),
      p_drop_submitted_at: expect.any(String),
      p_requested_price_pennies: 420,
    });
    expect(deletePhotos).not.toHaveBeenCalled();
  });

  it("does not trust or clean up after a mismatched recovered pair", async () => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockImplementationOnce(async (_name: string, args: ReceiptArgs) => ({
        data: [validReceipt(args, { venue_id: "venue-other" })],
        error: null,
      }));

    const outcome = await write(INPUT, {
      pint: new File(["photo"], "pint.jpg", { type: "image/jpeg" }),
      venue: null,
    });

    expect(outcome).toMatchObject({ ok: false, kind: "storage" });
    expect(deletePhotos).not.toHaveBeenCalled();
  });

  it("recovers a committed pair when its receipt envelope is malformed", async () => {
    const write = pairWriter();
    expect(write).toBeTypeOf("function");
    if (!write) return;
    rpc.mockImplementation(async (name: string, args: ReceiptArgs) => ({
      data: [
        validReceipt(
          args,
          name === "create_one_tap_price_pair"
            ? { venue_id: "venue-other" }
            : {},
        ),
      ],
      error: null,
    }));

    await expect(write(INPUT)).resolves.toMatchObject({
      ok: true,
      price: { priceGbp: 5.1 },
      drop: { venueId: "venue-xjf3n0", priceGbp: 5.1 },
    });
    expect(deletePhotos).not.toHaveBeenCalled();
  });
});

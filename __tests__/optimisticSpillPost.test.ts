import { describe, expect, it, vi } from "vitest";

import {
  buildOptimisticSpillRetryFormData,
  buildOptimisticSpillRetryPayload,
  buildOptimisticSpillDrop,
  createOptimisticSpillPhotoPreview,
  failOptimisticSpill,
  markOptimisticSpillRetrying,
  mergeOptimisticSpillDrops,
  readOptimisticSpills,
  reconcileOptimisticSpill,
  revokeOptimisticSpillPhotoPreview,
  upsertOptimisticSpill,
  writeOptimisticSpills,
  type StoredOptimisticSpill,
} from "@/lib/optimisticSpillPost";
import type { PintDropDTO } from "@/lib/feed";

function serverDrop(overrides: Partial<PintDropDTO> = {}): PintDropDTO {
  return {
    id: "server-1",
    handle: "karan",
    priceGbp: 5.8,
    drink: "Pale ale",
    passedDownNote: "By the dartboard",
    era: "",
    provenance: "contributor",
    venueId: "venue-1",
    createdAt: "2026-07-07T21:02:00.000Z",
    vibeTags: ["proper"],
    pintPhotoUrl: "https://cdn.example/pint.jpg",
    venuePhotoUrl: null,
    venueName: "The Crown",
    venueMapUrl: "/map?sel=venue-1",
    ...overrides,
  };
}

describe("optimistic Spill posting", () => {
  it("builds a final-card-shaped uploading draft with local photo previews", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      venueName: "The Crown",
      handle: " karan ",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the dartboard",
      era: "",
      visibility: "public",
      vibeTags: ["proper"],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });

    expect(draft).toMatchObject({
      id: "optimistic-client-1",
      handle: "karan",
      priceGbp: 5.8,
      provenance: "contributor",
      venueName: "The Crown",
      venueMapUrl: "/map?sel=venue-1",
      pintPhotoUrl: "blob:http://localhost/pint",
      optimistic: {
        state: "uploading",
        message: "Posting Spill, uploading photo",
        uploadProgress: 0,
        canRetry: false,
        clientRequestId: "client-1",
      },
    });
  });

  it("builds city-scoped map URLs for prefixed venue ids", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-oxf",
      venueId: "venue-oxf-16404bl",
      venueName: "Turf Tavern",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the alley",
      era: "",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });

    expect(draft.venueMapUrl).toBe("/map/oxford?sel=venue-oxf-16404bl");
  });

  it("reconciles a draft with the authoritative server response", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the dartboard",
      era: "",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const stored: StoredOptimisticSpill[] = [{ clientRequestId: "client-1", drop: draft }];

    expect(reconcileOptimisticSpill(stored, "client-1", serverDrop())).toEqual([
      { clientRequestId: "client-1", drop: serverDrop() },
    ]);
  });

  it("marks a failed draft honestly and keeps it retryable", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "",
      drink: "",
      passedDownNote: "Story only",
      era: "1980s",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const retry = buildOptimisticSpillRetryPayload({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "",
      drink: "",
      passedDownNote: "Story only",
      era: "1980s",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      receiptPhotoUrl: null,
      measure: "pint" as const,
      measureLabel: "",
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const stored: StoredOptimisticSpill[] = [{ clientRequestId: "client-1", drop: draft, retry }];

    expect(failOptimisticSpill(stored, "client-1", "Network or storage error — try again.")).toEqual([
      {
        clientRequestId: "client-1",
        retry,
        drop: {
          ...draft,
          optimistic: {
            state: "failed",
            message: "Network or storage error — try again.",
            uploadProgress: null,
            canRetry: true,
            clientRequestId: "client-1",
          },
        },
      },
    ]);
  });

  it("stores the original retry payload without flattening the public card", () => {
    const input = {
      clientRequestId: "client-1",
      venueId: "venue-1",
      venueName: "The Crown",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "By the dartboard",
      era: "",
      visibility: "anonymous" as const,
      vibeTags: ["proper"],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      receiptPhotoUrl: null,
      measure: "pint" as const,
      measureLabel: "",
      createdAt: "2026-07-07T21:00:00.000Z",
    };
    const draft = buildOptimisticSpillDrop(input);

    expect(upsertOptimisticSpill([], draft, buildOptimisticSpillRetryPayload(input))).toEqual([
      {
        clientRequestId: "client-1",
        drop: draft,
        retry: {
          clientRequestId: "client-1",
          venueId: "venue-1",
          venueName: "The Crown",
          handle: "karan",
          priceGbp: "5.8",
          drink: "Pale ale",
          passedDownNote: "By the dartboard",
          era: "",
          visibility: "anonymous",
          vibeTags: ["proper"],
          pintPhotoUrl: "blob:http://localhost/pint",
          venuePhotoUrl: null,
          receiptPhotoUrl: null,
          measure: "pint",
          measureLabel: "",
        },
      },
    ]);
  });

  it("rebuilds multipart retry data from the stored payload and local blob previews", async () => {
    const preview = createOptimisticSpillPhotoPreview(new Blob(["photo"], { type: "image/png" }));
    try {
      const payload = buildOptimisticSpillRetryPayload({
        clientRequestId: "client-1",
        venueId: "venue-1",
        handle: "karan",
        priceGbp: "5.8",
        drink: "Pale ale",
        passedDownNote: "By the dartboard",
        era: "",
        visibility: "public",
        vibeTags: ["proper", "riverside"],
        pintPhotoUrl: preview,
        venuePhotoUrl: null,
        receiptPhotoUrl: null,
        measure: "pint" as const,
        measureLabel: "",
        createdAt: "2026-07-07T21:00:00.000Z",
      });

      const form = await buildOptimisticSpillRetryFormData(payload);

      expect(form.get("clientRequestId")).toBe("client-1");
      expect(form.get("venueId")).toBe("venue-1");
      expect(form.get("handle")).toBe("karan");
      expect(form.get("priceGbp")).toBe("5.8");
      expect(form.get("visibility")).toBe("public");
      expect(form.getAll("vibe_tags")).toEqual(["proper", "riverside"]);
      expect(form.get("pint_photo")).toBeInstanceOf(Blob);
      expect(await (form.get("pint_photo") as Blob).text()).toBe("photo");
    } finally {
      revokeOptimisticSpillPhotoPreview(preview);
    }
  });

  it("never persists a blob: preview, and refuses the photo retry after reload", async () => {
    const input = {
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "",
      era: "",
      visibility: "public" as const,
      vibeTags: [],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      receiptPhotoUrl: null,
      measure: "pint" as const,
      measureLabel: "",
      createdAt: "2026-07-07T21:00:00.000Z",
    };
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    writeOptimisticSpills(
      storage,
      upsertOptimisticSpill([], buildOptimisticSpillDrop(input), buildOptimisticSpillRetryPayload(input)),
    );
    expect([...memory.values()].join("")).not.toContain("blob:");
    vi.resetModules();
    const reloaded = await import("@/lib/optimisticSpillPost");
    const stored = reloaded.readOptimisticSpills(storage)[0]!;
    expect(stored.drop.pintPhotoUrl).toBeNull();
    expect(stored.retry).toMatchObject({ pintPhotoUrl: null, photoNotKept: true });
    await expect(buildOptimisticSpillRetryFormData(stored.retry!)).rejects.toThrow(
      "Photo preview is no longer available.",
    );

    // An entry written before the rule is cleaned on the way back in.
    memory.set(
      "pubmax:optimistic-spill-posts:v1",
      JSON.stringify([{ clientRequestId: "client-1", drop: buildOptimisticSpillDrop(input) }]),
    );
    expect(readOptimisticSpills(storage)[0]?.drop.pintPhotoUrl).toBeNull();
  });

  it("marks a failed draft as retrying before the retry request settles", () => {
    const draft = buildOptimisticSpillDrop({
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "karan",
      priceGbp: "5.8",
      drink: "Pale ale",
      passedDownNote: "",
      era: "",
      visibility: "public",
      vibeTags: [],
      pintPhotoUrl: "blob:http://localhost/pint",
      venuePhotoUrl: null,
      createdAt: "2026-07-07T21:00:00.000Z",
    });
    const failed = failOptimisticSpill(
      [{ clientRequestId: "client-1", drop: draft }],
      "client-1",
      "Network or storage error — try again.",
    );

    expect(markOptimisticSpillRetrying(failed, "client-1")).toEqual([
      {
        clientRequestId: "client-1",
        drop: {
          ...draft,
          optimistic: {
            state: "uploading",
            message: "Retrying Spill, uploading photo",
            uploadProgress: 0,
            canRetry: false,
            clientRequestId: "client-1",
          },
        },
      },
    ]);
  });

  it("merges local optimistic drops ahead of server drops without duplicating reconciled ids", () => {
    const local = [
      { clientRequestId: "client-1", drop: serverDrop({ id: "server-1" }) },
      {
        clientRequestId: "client-2",
        drop: buildOptimisticSpillDrop({
          clientRequestId: "client-2",
          venueId: "venue-2",
          handle: "sam",
          priceGbp: "4.5",
          drink: "Lager",
          passedDownNote: "",
          era: "",
          visibility: "public",
          vibeTags: [],
          pintPhotoUrl: null,
          venuePhotoUrl: null,
          createdAt: "2026-07-07T21:03:00.000Z",
        }),
      },
    ];

    expect(mergeOptimisticSpillDrops([serverDrop({ id: "server-1" })], local).map((d) => d.id)).toEqual([
      "server-1",
      "optimistic-client-2",
    ]);
  });

  describe("a retry posts exactly what the drinker submitted", () => {
    const memoryStorage = () => {
      const memory = new Map<string, string>();
      return {
        memory,
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => void memory.set(key, value),
        removeItem: (key: string) => void memory.delete(key),
      };
    };
    const halfWithNoPhotos = {
      clientRequestId: "client-1",
      venueId: "venue-1",
      handle: "owl",
      priceGbp: "3.40",
      drink: "Guinness",
      passedDownNote: "",
      era: "",
      visibility: "public" as const,
      vibeTags: [],
      pintPhotoUrl: null,
      venuePhotoUrl: null,
      receiptPhotoUrl: null,
      measure: "half" as const,
      measureLabel: "",
      createdAt: "2026-07-07T21:00:00.000Z",
    };

    it("sends a half as a half after the payload goes through storage", async () => {
      const storage = memoryStorage();
      writeOptimisticSpills(
        storage,
        upsertOptimisticSpill(
          [],
          buildOptimisticSpillDrop(halfWithNoPhotos),
          buildOptimisticSpillRetryPayload(halfWithNoPhotos),
        ),
      );
      const form = await buildOptimisticSpillRetryFormData(readOptimisticSpills(storage)[0]!.retry!);

      expect(form.get("measure")).toBe("half");
      expect(form.get("measureLabel")).toBe("");
      expect(form.get("priceGbp")).toBe("3.40");
    });

    it.each(["public", "anonymous"] as const)("keeps %s stars through failure, storage and retry", async (visibility) => {
      const input = { ...halfWithNoPhotos, visibility, rating: 4 as const };
      const storage = memoryStorage();
      writeOptimisticSpills(storage, upsertOptimisticSpill(
        [], buildOptimisticSpillDrop(input), buildOptimisticSpillRetryPayload(input),
      ));
      writeOptimisticSpills(storage, failOptimisticSpill(readOptimisticSpills(storage), "client-1", "Offline"));
      const freshStorage = memoryStorage();
      freshStorage.setItem("pubmax:optimistic-spill-posts:v1", storage.getItem("pubmax:optimistic-spill-posts:v1")!);
      const [restored] = readOptimisticSpills(freshStorage);
      expect(restored?.drop).toMatchObject({ rating: 4, handle: visibility === "anonymous" ? "a PUBMAXXER" : "owl" });
      const form = await buildOptimisticSpillRetryFormData(restored!.retry!);
      expect(form.get("rating")).toBe("4");
      expect(form.get("visibility")).toBe(visibility);
      expect(form.get("measure")).toBe("half");
    });

    it("keeps the label of an other measure", async () => {
      const form = await buildOptimisticSpillRetryFormData(
        buildOptimisticSpillRetryPayload({ ...halfWithNoPhotos, measure: "other", measureLabel: "175ml" }),
      );

      expect(form.get("measure")).toBe("other");
      expect(form.get("measureLabel")).toBe("175ml");
    });

    it.each([
      ["pintPhotoUrl", "pint_photo"],
      ["venuePhotoUrl", "venue_photo"],
      ["receiptPhotoUrl", "receipt_photo"],
    ] as const)("keeps a live %s through storage and refuses it after release", async (slot, field) => {
      const preview = createOptimisticSpillPhotoPreview(new Blob(["attached evidence"], { type: "image/jpeg" }));
      const withPhoto = { ...halfWithNoPhotos, [slot]: preview };
      const storage = memoryStorage();
      try {
        writeOptimisticSpills(
          storage,
          upsertOptimisticSpill([], buildOptimisticSpillDrop(withPhoto), buildOptimisticSpillRetryPayload(withPhoto)),
        );
        writeOptimisticSpills(storage, failOptimisticSpill(readOptimisticSpills(storage), "client-1", "Offline"));
        writeOptimisticSpills(storage, markOptimisticSpillRetrying(readOptimisticSpills(storage), "client-1"));
        expect([...storage.memory.values()].join("")).not.toContain("blob:");
        const form = await buildOptimisticSpillRetryFormData(readOptimisticSpills(storage)[0]!.retry!);
        expect(form.get("measure")).toBe("half");
        expect(form.get("priceGbp")).toBe("3.40");
        expect(await (form.get(field) as Blob).text()).toBe("attached evidence");

        revokeOptimisticSpillPhotoPreview(preview);
        await expect(
          buildOptimisticSpillRetryFormData(readOptimisticSpills(storage)[0]!.retry!),
        ).rejects.toThrow("Photo preview is no longer available.");
      } finally {
        revokeOptimisticSpillPhotoPreview(preview);
      }
    });

    it("refuses a bill retry after reload loses the live handoff", async () => {
      const preview = createOptimisticSpillPhotoPreview(new Blob(["bill"], { type: "image/jpeg" }));
      const withBill = { ...halfWithNoPhotos, receiptPhotoUrl: preview };
      const storage = memoryStorage();
      try {
        writeOptimisticSpills(
          storage,
          upsertOptimisticSpill([], buildOptimisticSpillDrop(withBill), buildOptimisticSpillRetryPayload(withBill)),
        );
        vi.resetModules();
        const reloaded = await import("@/lib/optimisticSpillPost");
        await expect(
          reloaded.buildOptimisticSpillRetryFormData(reloaded.readOptimisticSpills(storage)[0]!.retry!),
        ).rejects.toThrow("Photo preview is no longer available.");
      } finally {
        revokeOptimisticSpillPhotoPreview(preview);
      }
    });

    it("refuses an entry stored before the measure was kept, never posting it as a pint", async () => {
      const storage = memoryStorage();
      const legacyRetry: Partial<ReturnType<typeof buildOptimisticSpillRetryPayload>> =
        buildOptimisticSpillRetryPayload(halfWithNoPhotos);
      delete legacyRetry.measure;
      delete legacyRetry.measureLabel;
      delete legacyRetry.receiptPhotoUrl;
      storage.setItem(
        "pubmax:optimistic-spill-posts:v1",
        JSON.stringify([
          { clientRequestId: "client-1", drop: buildOptimisticSpillDrop(halfWithNoPhotos), retry: legacyRetry },
        ]),
      );

      await expect(
        buildOptimisticSpillRetryFormData(readOptimisticSpills(storage)[0]!.retry!),
      ).rejects.toThrow("Open the map and post it again.");
    });
  });
});

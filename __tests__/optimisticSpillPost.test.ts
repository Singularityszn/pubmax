import { describe, expect, it } from "vitest";

import {
  buildOptimisticSpillDrop,
  failOptimisticSpill,
  mergeOptimisticSpillDrops,
  reconcileOptimisticSpill,
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
        message: "Posting Spill — uploading photo",
        uploadProgress: 0,
        canRetry: false,
        clientRequestId: "client-1",
      },
    });
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
    const stored: StoredOptimisticSpill[] = [{ clientRequestId: "client-1", drop: draft }];

    expect(failOptimisticSpill(stored, "client-1", "Network or storage error — try again.")).toEqual([
      {
        clientRequestId: "client-1",
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
});

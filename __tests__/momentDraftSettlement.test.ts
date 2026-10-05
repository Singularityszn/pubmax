// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyMomentSaveReceipt,
  createMomentDraft,
  deleteMomentDraft,
  loadMomentDraft,
  momentMediaKey,
  momentSubmissionMetadata,
  saveMomentDraft,
  settleMomentDraftProgress,
  type MomentDraftV1,
  type MomentMediaDraft,
  type MomentSaveReceipt,
} from "@/lib/momentDraft";

// The real draft store. jsdom has no IndexedDB, so every call here takes the
// store's own localStorage fallback lane - the lane a browser uses when
// IndexedDB is unavailable, which keeps metadata and no photo bytes. The
// IndexedDB lane itself is not executed here.

const OWNER = "account-a";

function photo(id: string): MomentMediaDraft {
  return {
    id, type: "image", name: `${id}.jpg`, mimeType: "image/jpeg", size: 4, blob: new Blob(["jpeg"]),
    objectUrl: null, width: null, height: null, focalX: 0.5, focalY: 0.5, alt: "",
  };
}

function captionDraft(owner = OWNER): MomentDraftV1 {
  return { ...createMomentDraft(owner), caption: "A night worth keeping", revision: 1 };
}

function confirmedReceipt(draft: MomentDraftV1): MomentSaveReceipt {
  return {
    uploadedMedia: draft.media.map((item) => ({
      ...momentSubmissionMetadata(draft, true), key: momentMediaKey(item), altText: item.alt ?? "",
    })),
    sentCaption: { ...momentSubmissionMetadata(draft, draft.media.length > 0), text: draft.caption },
    sentTitle: draft.memoryTitle.trim() || "Tonight's Memory",
    serverMemoryId: "memory-1",
  };
}

beforeEach(() => {
  expect(typeof indexedDB).toBe("undefined");
  localStorage.clear();
  // Every write in these tests lands in the same millisecond.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T21:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Moment save receipts on the fallback lane", () => {
  it("keeps a confirmed Memory id for the same account to resume", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await settleMomentDraftProgress(OWNER, draft.id, { uploadedMedia: [], sentCaption: null, sentTitle: null, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft(OWNER)).toMatchObject({ id: draft.id, serverMemoryId: "memory-1", caption: "A night worth keeping" });
  });

  it("clears the draft once the server holds everything in it", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await settleMomentDraftProgress(OWNER, draft.id, confirmedReceipt(draft));
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("never recreates a draft a sign-out purged", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await deleteMomentDraft(OWNER);
    await settleMomentDraftProgress(OWNER, draft.id, { uploadedMedia: [], sentCaption: null, sentTitle: null, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("keeps a newer edit of the same draft written in the same millisecond", async () => {
    const draft = { ...captionDraft(), media: [photo("one")] };
    await saveMomentDraft(draft);
    await saveMomentDraft({ ...draft, caption: "A newer visit's caption", revision: 2 });
    await settleMomentDraftProgress(OWNER, draft.id, confirmedReceipt(draft));
    expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "A newer visit's caption", serverMemoryId: "memory-1" });
  });

  it("touches only its own owner's draft", async () => {
    const guest = captionDraft("guest");
    const mine = captionDraft();
    await saveMomentDraft(guest);
    await saveMomentDraft(mine);
    await settleMomentDraftProgress(OWNER, mine.id, confirmedReceipt(mine));
    await settleMomentDraftProgress("guest", mine.id, confirmedReceipt(mine));
    expect(await loadMomentDraft("guest")).toMatchObject({ id: guest.id, caption: guest.caption });
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("keeps a photo whose bytes a newer edit replaced after the original was confirmed", async () => {
    const original = { ...captionDraft(), media: [photo("one"), photo("two")] };
    // Fallback rows keep no photo bytes, so the confirmed photo is checked
    // through the receipt rule the store applies to every row.
    const cropped = { ...original, media: [{ ...photo("one"), version: "cropped-1" }, photo("two")] };
    const remaining = applyMomentSaveReceipt(cropped, confirmedReceipt({ ...original, media: [original.media[0]!] }));
    expect(remaining?.media.map((item) => `${item.id}@${item.version ?? ""}`)).toEqual(["one@cropped-1", "two@"]);
  });
});


describe("late Moment confirmations preserve newer submitted metadata", () => {
  it("keeps a newer photo description with the same photo bytes", () => {
    const submitted = { ...captionDraft(), media: [{ ...photo("one"), alt: "The old description" }] };
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, media: [{ ...submitted.media[0]!, alt: "The new description" }], revision: 2 };
    const remaining = applyMomentSaveReceipt(newer, receipt);
    expect(remaining?.media).toHaveLength(1);
    expect(remaining?.media[0]?.alt).toBe("The new description");
    expect(remaining?.serverMemoryId).toBe("memory-1");
  });

  it.each([
    ["venue", { venueId: "pub-two" }],
    ["time", { occurredAt: "2026-10-05T22:00:00.000Z" }],
  ] as const)("keeps newer photo %s metadata with the same photo bytes", (_, patch) => {
    const submitted = { ...captionDraft(), venueId: "pub-one", media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const remaining = applyMomentSaveReceipt({ ...submitted, ...patch, revision: 2 }, receipt);
    expect(remaining?.media.map((item) => item.id)).toEqual(["one"]);
    expect(remaining).toMatchObject({ ...patch, serverMemoryId: "memory-1" });
  });

  it.each([
    ["venue", { venueId: "pub-two" }],
    ["time", { occurredAt: "2026-10-05T22:00:00.000Z" }],
    ["text kind", { kind: "quote" }],
  ] as const)("keeps newer text-only %s metadata loadable with the same caption", async (_, patch) => {
    const submitted = { ...captionDraft(), venueId: "pub-one", kind: "side_quest" as const };
    const receipt = confirmedReceipt(submitted);
    await saveMomentDraft(submitted);
    await saveMomentDraft({ ...submitted, ...patch, revision: 2 });
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toMatchObject({
      ...patch, caption: submitted.caption, serverMemoryId: "memory-1",
    });
  });

  it("preserves a newer local night title without retaining confirmed caption content", async () => {
    const submitted = { ...captionDraft(), memoryTitle: "The first title" };
    const receipt = confirmedReceipt(submitted);
    await saveMomentDraft(submitted);
    await saveMomentDraft({ ...submitted, memoryTitle: "The newer title", revision: 2 });
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toMatchObject({
      memoryTitle: "The newer title", caption: "", serverMemoryId: "memory-1",
    });
  });
});

describe("Moment receipt normalization and independent content", () => {
  it("captures the effective photo and text wire metadata", () => {
    const draft = captionDraft();
    expect(momentSubmissionMetadata(draft, false)).toEqual({
      kind: "side_quest", venueId: null, occurredAt: "2026-10-05T21:00:00.000Z",
    });
    expect(momentSubmissionMetadata({ ...draft, kind: "quote", venueId: "pub-one" }, true)).toEqual({
      kind: "photo", venueId: "pub-one", occurredAt: "2026-10-05T21:00:00.000Z",
    });
  });

  it.each([undefined, ""])("consumes a confirmed photo with an omitted or empty description: %s", (alt) => {
    const submitted = { ...captionDraft(), media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const media = [{ ...submitted.media[0]!, alt }] as MomentMediaDraft[];
    expect(applyMomentSaveReceipt({ ...submitted, media }, receipt)).toBeNull();
  });

  it.each([undefined, null, ""])("consumes text with equivalent absent venue references: %s", async (venueId) => {
    const submitted = captionDraft();
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, venueId, kind: "side_quest" } as MomentDraftV1;
    await saveMomentDraft(newer);
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("consumes a confirmed photo while keeping independent new photo content and caption edits", () => {
    const submitted = { ...captionDraft(), media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, caption: "An independent new caption", media: [...submitted.media, photo("two")], revision: 2 };
    const remaining = applyMomentSaveReceipt(newer, receipt);
    expect(remaining?.media.map((item) => item.id)).toEqual(["two"]);
    expect(remaining?.caption).toBe("An independent new caption");
    expect(remaining?.serverMemoryId).toBe("memory-1");
  });

  it("consumes a matching later photo confirmation without retaining the same bytes twice", () => {
    const submitted = { ...captionDraft(), media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, media: [{ ...photo("one"), alt: "The later description" }] };
    receipt.uploadedMedia.push(...confirmedReceipt(newer).uploadedMedia);
    expect(applyMomentSaveReceipt(newer, receipt)).toBeNull();
  });

  it("consumes unchanged content with the wire default title and text kind", async () => {
    const submitted = captionDraft();
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, memoryTitle: "Tonight's Memory", kind: "side_quest" as const };
    await saveMomentDraft(newer);
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });
});

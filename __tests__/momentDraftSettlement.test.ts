// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyMomentSaveReceipt,
  createMomentDraft,
  deleteMomentDraft,
  loadMomentDraft,
  saveMomentDraft,
  settleMomentDraftProgress,
  type MomentDraftV1,
  type MomentMediaDraft,
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
    await settleMomentDraftProgress(OWNER, draft.id, { uploadedMediaKeys: [], sentCaption: null, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft(OWNER)).toMatchObject({ id: draft.id, serverMemoryId: "memory-1", caption: "A night worth keeping" });
  });

  it("clears the draft once the server holds everything in it", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await settleMomentDraftProgress(OWNER, draft.id, { uploadedMediaKeys: [], sentCaption: draft.caption, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("never recreates a draft a sign-out purged", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await deleteMomentDraft(OWNER);
    await settleMomentDraftProgress(OWNER, draft.id, { uploadedMediaKeys: [], sentCaption: null, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("keeps a newer edit of the same draft written in the same millisecond", async () => {
    const draft = { ...captionDraft(), media: [photo("one")] };
    await saveMomentDraft(draft);
    await saveMomentDraft({ ...draft, caption: "A newer visit's caption", revision: 2 });
    await settleMomentDraftProgress(OWNER, draft.id, {
      uploadedMediaKeys: ["one"], sentCaption: "A night worth keeping", serverMemoryId: "memory-1",
    });
    expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "A newer visit's caption", serverMemoryId: "memory-1" });
  });

  it("touches only its own owner's draft", async () => {
    const guest = captionDraft("guest");
    const mine = captionDraft();
    await saveMomentDraft(guest);
    await saveMomentDraft(mine);
    await settleMomentDraftProgress(OWNER, mine.id, { uploadedMediaKeys: [], sentCaption: mine.caption, serverMemoryId: "memory-1" });
    await settleMomentDraftProgress("guest", mine.id, { uploadedMediaKeys: [], sentCaption: mine.caption, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft("guest")).toMatchObject({ id: guest.id, caption: guest.caption });
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("keeps a photo whose bytes a newer edit replaced after the original was confirmed", async () => {
    const original = { ...captionDraft(), media: [photo("one"), photo("two")] };
    // Fallback rows keep no photo bytes, so the confirmed photo is checked
    // through the receipt rule the store applies to every row.
    const cropped = { ...original, media: [{ ...photo("one"), version: "cropped-1" }, photo("two")] };
    const remaining = applyMomentSaveReceipt(cropped, {
      uploadedMediaKeys: ["one"], sentCaption: original.caption, serverMemoryId: "memory-1",
    });
    expect(remaining?.media.map((item) => `${item.id}@${item.version ?? ""}`)).toEqual(["one@cropped-1", "two@"]);
  });
});


// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  createMomentDraft,
  deleteMomentDraft,
  loadMomentDraft,
  saveMomentDraft,
  settleMomentDraftProgress,
} from "@/lib/momentDraft";

// The real draft store. jsdom has no IndexedDB, so every call here takes the
// store's own localStorage fallback lane - the lane a browser uses when
// IndexedDB is unavailable. The IndexedDB lane itself is not executed here.

const OWNER = "account-a";

function captionDraft(owner = OWNER) {
  return { ...createMomentDraft(owner), caption: "A night worth keeping", revision: 1 };
}

beforeEach(() => {
  expect(typeof indexedDB).toBe("undefined");
  localStorage.clear();
});

describe("Moment save progress on the fallback lane", () => {
  it("keeps a confirmed Memory id for the same account to resume", async () => {
    const draft = captionDraft();
    const storedAt = await saveMomentDraft(draft);
    const settledAt = await settleMomentDraftProgress(OWNER, draft.id, storedAt, {
      media: [], caption: draft.caption, serverMemoryId: "memory-1",
    });
    expect(settledAt).not.toBeNull();
    expect(await loadMomentDraft(OWNER)).toMatchObject({ id: draft.id, serverMemoryId: "memory-1", caption: "A night worth keeping" });
  });

  it("clears the draft once nothing is left to upload", async () => {
    const draft = captionDraft();
    const storedAt = await saveMomentDraft(draft);
    expect(await settleMomentDraftProgress(OWNER, draft.id, storedAt, null)).not.toBeNull();
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("never recreates a draft a sign-out purged", async () => {
    const draft = captionDraft();
    const storedAt = await saveMomentDraft(draft);
    await deleteMomentDraft(OWNER);
    expect(await settleMomentDraftProgress(OWNER, draft.id, storedAt, {
      media: [], caption: draft.caption, serverMemoryId: "memory-1",
    })).toBeNull();
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("leaves a row another visit stored since untouched", async () => {
    const draft = captionDraft();
    const storedAt = await saveMomentDraft(draft);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await saveMomentDraft({ ...draft, caption: "A newer visit's caption", revision: 2 });
    expect(await settleMomentDraftProgress(OWNER, draft.id, storedAt, null)).toBeNull();
    expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "A newer visit's caption" });
  });

  it("touches only its own owner's draft", async () => {
    const guest = captionDraft("guest");
    const mine = captionDraft();
    await saveMomentDraft(guest);
    const storedAt = await saveMomentDraft(mine);
    await settleMomentDraftProgress(OWNER, mine.id, storedAt, null);
    expect(await loadMomentDraft("guest")).toMatchObject({ id: guest.id });
    expect(await settleMomentDraftProgress("guest", mine.id, storedAt, null)).toBeNull();
    expect(await loadMomentDraft("guest")).toMatchObject({ id: guest.id });
  });
});

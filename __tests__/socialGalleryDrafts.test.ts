import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSocialGalleryDraft,
  createSocialGalleryDraftItem,
  moveSocialGalleryDraftItem,
  readSocialGalleryDraft,
  removeSocialGalleryDraftItem,
  saveSocialGalleryDraft,
  type SocialGalleryDraftItem, type SocialGalleryLocalDraftItem,
} from "@/lib/socialGalleryDrafts";

function item(name: string): SocialGalleryLocalDraftItem {
  return createSocialGalleryDraftItem(new File([name], `${name}.heic`, { type: "image/heic" }), name);
}

function databaseFixture() {
  const request = {} as IDBOpenDBRequest;
  const read = {} as IDBRequest;
  const put = vi.fn();
  const remove = vi.fn();
  const get = vi.fn(() => read);
  const store = { put, delete: remove, get };
  const transaction = { objectStore: () => store } as unknown as IDBTransaction;
  const close = vi.fn();
  const db = { transaction: vi.fn(() => transaction), close, createObjectStore: vi.fn() };
  Object.defineProperty(request, "result", { value: db });
  const open = vi.fn(() => request);
  vi.stubGlobal("indexedDB", { open });
  return { request, read, transaction, close, put, remove, get, db, open };
}

async function open(request: IDBOpenDBRequest) {
  request.onsuccess!(new Event("success"));
  await Promise.resolve();
}

afterEach(() => vi.unstubAllGlobals());

describe("ordered gallery draft items", () => {
  it("creates stable separate item and upload UUIDs while keeping the original", () => {
    const original = new File(["phone bytes"], "night.heif", { type: "image/heif" });
    const first = createSocialGalleryDraftItem(original);
    const second = createSocialGalleryDraftItem(original);
    expect(first.original).toBe(original);
    expect(first.prepared).toBeUndefined();
    expect(first.altText).toBe("");
    expect(new Set([first.id, first.uploadKey, second.id, second.uploadKey]).size).toBe(4);
    expect(first.uploadKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("moves and removes without mutating order, identity, or upload receipts", () => {
    const first = Object.freeze({ ...item("first"), mediaId: "uploaded-1" });
    const second = Object.freeze(item("second"));
    const third = Object.freeze(item("third"));
    const original = Object.freeze([first, second, third]);
    const moved = moveSocialGalleryDraftItem(original, third.id, 0);
    expect(moved).toEqual([third, first, second]);
    expect(moved[1]).toBe(first);
    expect(removeSocialGalleryDraftItem(moved, second.id)).toEqual([third, first]);
    expect(original).toEqual([first, second, third]);
    expect(moveSocialGalleryDraftItem(original, first.id, 2)).toEqual([second, third, first]);
    expect(moveSocialGalleryDraftItem(original, "missing", 0)).toEqual(original);
    expect(() => moveSocialGalleryDraftItem(original, first.id, -1)).toThrow(RangeError);
    expect(() => moveSocialGalleryDraftItem(original, first.id, 1.5)).toThrow(RangeError);
  });
});

describe("gallery draft persistence", () => {
  it("stores retained photos without files alongside original local files", async () => {
    const fixture = databaseFixture();
    const retained = { source: "retained" as const, id: "existing", mediaId: "post-media", altText: "Existing view" };
    const local = item("new");
    const pending = saveSocialGalleryDraft("opaque:post-17", [retained, local]);
    await open(fixture.request);
    expect(fixture.put).toHaveBeenCalledWith([retained, local], "opaque:post-17");
    expect(fixture.put.mock.calls[0][0][0]).not.toHaveProperty("original");
    fixture.transaction.oncomplete!(new Event("complete"));
    await pending;
  });

  it("stores an ordered metadata snapshot under the complete existing opaque composer key", async () => {
    const fixture = databaseFixture();
    const first = { ...item("first"), prepared: new File(["jpeg"], "first.jpg", { type: "image/jpeg" }), mediaId: "pending-media-id" };
    const second = item("second");
    const items = [first, second];
    const originalKey = first.uploadKey;
    const pending = saveSocialGalleryDraft("pubmaxx:social-draft:server-account-hash:post-17", items);
    first.altText = "changed after save started";
    items.reverse();
    await open(fixture.request);
    const [saved, key] = fixture.put.mock.calls[0];
    expect(key).toBe("pubmaxx:social-draft:server-account-hash:post-17");
    expect(saved.map((entry: SocialGalleryDraftItem) => entry.id)).toEqual([first.id, second.id]);
    expect(saved[0]).toMatchObject({ altText: "first", uploadKey: originalKey, mediaId: "pending-media-id" });
    expect(saved[0].original).toBe(first.original);
    expect(saved[0].prepared).toBe(first.prepared);
    fixture.transaction.oncomplete!(new Event("complete"));
    await pending;
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it.each(["opaque-account-a:new", "opaque-account-a:post-17", "opaque-account-b:post-17"])("reads only the exact requested key %s", async (key) => {
    const fixture = databaseFixture();
    const items = [item("second"), { ...item("first"), mediaId: "already-uploaded" }];
    Object.defineProperty(fixture.read, "result", { value: items });
    const pending = readSocialGalleryDraft(key);
    await open(fixture.request);
    expect(fixture.get).toHaveBeenCalledExactlyOnceWith(key);
    fixture.read.onsuccess!(new Event("success"));
    fixture.transaction.oncomplete!(new Event("complete"));
    expect(await pending).toEqual(items);
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("waits for transaction commit and rejects aborted writes without deleting the prior draft", async () => {
    const fixture = databaseFixture();
    const pending = saveSocialGalleryDraft("opaque:new", [item("one")]);
    const settled = vi.fn();
    const refusal = expect(pending).rejects.toThrow("interrupted");
    void pending.then(settled, settled);
    await open(fixture.request);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    fixture.transaction.onabort!(new Event("abort"));
    await refusal;
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("rejects quota and read failures instead of reporting an empty draft", async () => {
    const fixture = databaseFixture();
    const error = new DOMException("Quota exceeded", "QuotaExceededError");
    Object.defineProperty(fixture.transaction, "error", { value: error });
    const pending = readSocialGalleryDraft("opaque:new");
    const refusal = expect(pending).rejects.toBe(error);
    await open(fixture.request);
    fixture.transaction.onerror!(new Event("error"));
    await refusal;
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("distinguishes an absent draft from an intentionally empty gallery", async () => {
    for (const value of [undefined, []]) {
      const fixture = databaseFixture();
      Object.defineProperty(fixture.read, "result", { value });
      const pending = readSocialGalleryDraft("opaque:new");
      await open(fixture.request);
      fixture.read.onsuccess!(new Event("success"));
      fixture.transaction.oncomplete!(new Event("complete"));
      expect(await pending).toEqual(value === undefined ? null : []);
    }
  });

  it("refuses excessive, duplicate, or malformed drafts before opening storage", async () => {
    const fixture = databaseFixture();
    const same = item("same");
    for (const items of [Array.from({ length: 11 }, () => item("photo")), [same, same], [{ ...same, original: {} }]]) {
      await expect(saveSocialGalleryDraft("opaque:new", items as SocialGalleryDraftItem[])).rejects.toThrow("unique upload keys");
    }
    await expect(saveSocialGalleryDraft(" ", [])).rejects.toThrow("account-bound draft key");
    expect(fixture.open).not.toHaveBeenCalled();
  });

  it("reports corrupt stored data instead of dropping individual photos", async () => {
    const fixture = databaseFixture();
    Object.defineProperty(fixture.read, "result", { value: [item("valid"), { original: "lost file" }] });
    const pending = readSocialGalleryDraft("opaque:new");
    const refusal = expect(pending).rejects.toThrow("Could not restore");
    await open(fixture.request);
    fixture.read.onsuccess!(new Event("success"));
    fixture.transaction.oncomplete!(new Event("complete"));
    await refusal;
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("deletes only the selected draft on an explicit clear", async () => {
    const fixture = databaseFixture();
    const pending = clearSocialGalleryDraft("opaque:post-17");
    await open(fixture.request);
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith("opaque:post-17");
    fixture.transaction.oncomplete!(new Event("complete"));
    await pending;
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("reports unavailable storage and closes a late connection after a blocked open", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(readSocialGalleryDraft("opaque:new")).rejects.toThrow("not available");
    const fixture = databaseFixture();
    const pending = readSocialGalleryDraft("opaque:new");
    const refusal = expect(pending).rejects.toThrow("busy");
    fixture.request.onblocked!(new Event("blocked") as IDBVersionChangeEvent);
    await refusal;
    await open(fixture.request);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.db.transaction).not.toHaveBeenCalled();
  });
});

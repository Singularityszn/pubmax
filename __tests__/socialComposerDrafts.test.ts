import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readSocialDraftPhoto,
  saveSocialDraftPhoto,
} from "@/lib/socialComposerDrafts";

function databaseFixture() {
  const request = {} as IDBOpenDBRequest;
  const read = {} as IDBRequest;
  const put = vi.fn();
  const remove = vi.fn();
  const store = { put, delete: remove, get: () => read };
  const transaction = { objectStore: () => store } as unknown as IDBTransaction;
  const close = vi.fn();
  const db = {
    transaction: () => transaction,
    close,
  } as unknown as IDBDatabase;
  Object.defineProperty(request, "result", { value: db });
  vi.stubGlobal("indexedDB", { open: () => request });
  return { request, read, transaction, close, put, remove };
}

async function open(request: IDBOpenDBRequest) {
  request.onsuccess!(new Event("success"));
  await Promise.resolve();
}

afterEach(() => vi.unstubAllGlobals());

describe("Social composer attachment drafts", () => {
  it("stores videos unchanged under the existing account scope", async () => {
    const fixture = databaseFixture();
    const video = new File(["video"], "night.mp4", { type: "video/mp4" });
    const pending = saveSocialDraftPhoto("alice:new", video);
    await open(fixture.request);
    expect(fixture.put).toHaveBeenCalledWith(video, "alice:new");
    fixture.transaction.oncomplete!(new Event("complete"));
    await pending;
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("reports an aborted write and closes its database connection", async () => {
    const fixture = databaseFixture();
    const pending = saveSocialDraftPhoto("alice:new", null);
    const refusal = expect(pending).rejects.toThrow(
      "Draft save was interrupted.",
    );
    await open(fixture.request);
    expect(fixture.remove).toHaveBeenCalledWith("alice:new");
    fixture.transaction.onabort!(new Event("abort"));
    await refusal;
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("restores a video with its MIME type and closes after a failed read", async () => {
    const fixture = databaseFixture();
    const video = new File(["video"], "night.mp4", { type: "video/mp4" });
    Object.defineProperty(fixture.read, "result", { value: video });
    const pending = readSocialDraftPhoto("alice:new");
    await open(fixture.request);
    fixture.read.onsuccess!(new Event("success"));
    expect(await pending).toBe(video);
    expect(fixture.close).toHaveBeenCalledOnce();

    const failed = databaseFixture();
    Object.defineProperty(failed.read, "error", {
      value: new Error("Storage unavailable"),
    });
    const read = readSocialDraftPhoto("alice:new");
    const refusal = expect(read).rejects.toThrow("Storage unavailable");
    await open(failed.request);
    failed.read.onerror!(new Event("error"));
    await refusal;
    expect(failed.close).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  action: vi.fn(), prepare: vi.fn(), read: vi.fn(), save: vi.fn(), clear: vi.fn(),
  readLegacy: vi.fn(), saveLegacy: vi.fn(), accountSignal: vi.fn(), media: vi.fn(),
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionJson: mocks.action }));
vi.mock("@/lib/authProviderRevision", () => ({ readProviderAccountSignal: mocks.accountSignal }));
vi.mock("@/lib/socialPhotoPreparation", () => ({
  SOCIAL_PHOTO_PICKER_ACCEPT: "image/jpeg,image/png,image/webp,image/heic,image/heif",
  prepareSocialGalleryPhoto: mocks.prepare,
}));
vi.mock("@/lib/socialGalleryDrafts", async (original) => ({
  ...await original<typeof import("@/lib/socialGalleryDrafts")>(),
  readSocialGalleryDraft: mocks.read, saveSocialGalleryDraft: mocks.save, clearSocialGalleryDraft: mocks.clear,
}));
vi.mock("@/lib/socialComposerDrafts", () => ({ readSocialDraftPhoto: mocks.readLegacy, saveSocialDraftPhoto: mocks.saveLegacy }));
vi.mock("@/components/social/SocialPostMedia", () => ({ default: mocks.media }));

import SocialComposer from "@/app/social/SocialComposer";
import { createSocialGalleryDraftItem, type SocialGalleryDraftItem } from "@/lib/socialGalleryDrafts";
import type { SocialPostDTO } from "@/lib/socialPosts";

let root: Root;
let host: HTMLDivElement;
let account: AbortController;
const saved = vi.fn();
const key = "pubmaxx:social-composer:v1:opaque-account:new";
const post: SocialPostDTO = {
  id: "post-17", kind: "standard", visibility: "private", body: "Original night", area: null,
  venueId: null, venueName: null, venueProjected: false, hashtags: [], commentPolicy: "locked",
  photo: { mediaId: "retained-1", altText: "Original view" },
  photos: [{ mediaId: "retained-1", altText: "Original view" }],
  moderationState: "approved", featureRequest: null, revision: 1, mutationVersion: 5,
  editedAt: null, createdAt: "2026-09-07T12:00:00Z", updatedAt: "2026-09-07T12:00:00Z",
  author: { handle: "alice" }, ownedByViewer: true,
};

function photo(name: string) { return new File([name], `${name}.heic`, { type: "image/heic" }); }
function response(body: unknown, status = 200) { return { response: new Response(JSON.stringify(body), { status }), body }; }
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((entry) => (entry.getAttribute("aria-label") ?? entry.textContent?.trim()) === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function change(label: string, value: string) {
  const control = [...host.querySelectorAll("label")].find((entry) => entry.textContent?.trim() === label)?.querySelector("input");
  if (!control) throw new Error(`Missing input: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function changeBody(value: string) {
  await act(async () => {
    const textarea = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount(existing?: SocialPostDTO, strict = false) {
  await act(async () => {
    const component = createElement(SocialComposer, { post: existing, draftScope: "opaque-account", onSaved: saved });
    root.render(strict ? createElement(StrictMode, {}, component) : component);
  });
  await click(existing ? "Edit post" : "New post");
}
async function choose(files: File[]) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Add photos"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function uploads() { return mocks.action.mock.calls.filter(([url]) => url === "/api/social/uploads/photos"); }
function commits() { return mocks.action.mock.calls.filter(([url]) => url !== "/api/social/uploads/photos"); }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.resetAllMocks();
  account = new AbortController();
  mocks.accountSignal.mockReturnValue(account.signal);
  mocks.read.mockResolvedValue(null);
  mocks.save.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
  mocks.readLegacy.mockResolvedValue(null);
  mocks.saveLegacy.mockResolvedValue(undefined);
  mocks.prepare.mockImplementation(async (originalFile: File) => ({
    outcome: "prepared", originalFile,
    file: new File(["JPEG pixels"], originalFile.name.replace(".heic", ".jpg"), { type: "image/jpeg" }), width: 1200, height: 900,
  }));
  mocks.media.mockReturnValue(createElement("span", {}, "Approved remote preview"));
  let uploadNumber = 0;
  mocks.action.mockImplementation(async (url: string) => url === "/api/social/uploads/photos"
    ? response({ upload: { mediaId: `upload-${++uploadNumber}` } }) : response({ error: "Connection lost" }, 503));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:prepared") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Social composer galleries", () => {
  it("times out a stalled upload after 120 seconds and retries without losing originals, keys, or receipts", async () => {
    vi.useFakeTimers();
    let finishLate!: (value: ReturnType<typeof response>) => void;
    mocks.action.mockResolvedValueOnce(response({ upload: { mediaId: "ready-first" } }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishLate = resolve; }));
    await mount();
    const originals = [photo("first"), photo("stalled")];
    await choose(originals);
    const pendingSignal = uploads()[1][1].signal as AbortSignal;
    const pendingKey = uploads()[1][1].headers["Idempotency-Key"];
    await act(async () => { await vi.advanceTimersByTimeAsync(119_999); });
    expect(pendingSignal.aborted).toBe(false);
    expect(host.textContent).toContain("Uploading photo…");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(pendingSignal.aborted).toBe(true);
    expect(host.textContent).toContain("Photo upload timed out. Try again.");
    expect(button("Retry photos").disabled).toBe(false);
    expect(mocks.save.mock.lastCall![1]).toMatchObject([
      { original: originals[0], mediaId: "ready-first" },
      { original: originals[1], uploadKey: pendingKey },
    ]);
    await click("Retry photos");
    expect(uploads()).toHaveLength(3);
    expect(uploads()[2][1].headers["Idempotency-Key"]).toBe(pendingKey);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    await act(async () => { finishLate(response({ upload: { mediaId: "late-stalled-response" } })); });
    expect(mocks.save.mock.lastCall![1][0].mediaId).toBe("ready-first");
    expect(mocks.save.mock.lastCall![1][1].mediaId).not.toBe("late-stalled-response");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("persists originals before preparation, uploads separately, and publishes only the described order", async () => {
    await mount(undefined, true);
    const pickers = host.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(pickers).toHaveLength(2);
    expect(pickers[0].getAttribute("aria-label")).toBe("Add photos");
    expect(pickers[0].multiple).toBe(true);
    expect(pickers[1].getAttribute("aria-label")).toBe("Add video");
    expect(pickers[1].accept).toBe("video/mp4");
    expect(pickers[1].multiple).toBe(false);
    const originals = [photo("canal"), photo("band")];
    await choose(originals);
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]);
    expect(mocks.save.mock.calls[0][0]).toBe(key);
    expect(mocks.save.mock.calls[0][1].map((item: SocialGalleryDraftItem) => item.source === "local" && item.original)).toEqual(originals);
    expect(uploads()).toHaveLength(2);
    expect(uploads()[0][1].body.get("photo").type).toBe("image/jpeg");
    expect(uploads()[0][2]).toEqual({ requiresIdentity: true });
    expect(uploads()[0][1].headers["Idempotency-Key"]).not.toBe(uploads()[1][1].headers["Idempotency-Key"]);
    expect(button("Post").disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[value="friends"]')!.checked).toBe(true);
    await change("Photo 1 description", "Canal walk");
    await change("Photo 2 description", "The band");
    await click("Move photo 2 earlier");
    expect(button("Move photo 1 earlier").disabled).toBe(true);
    expect(button("Move photo 2 later").disabled).toBe(true);
    await click("Post");
    const options = commits()[0][1];
    expect(JSON.parse(options.body)).toMatchObject({ visibility: "friends", gallery: [
      { mediaId: "upload-2", altText: "The band" }, { mediaId: "upload-1", altText: "Canal walk" },
    ] });
    expect(JSON.parse(options.body)).not.toHaveProperty("photoAltText");
    expect(JSON.parse(options.body)).not.toHaveProperty("tagHandles");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(host.textContent).not.toContain("Photo tags");
    expect(saved).not.toHaveBeenCalled();
  });

  it("retries a failed commit with the same upload IDs and post request key", async () => {
    await mount();
    await choose([photo("one")]);
    await change("Photo 1 description", "Friends by the canal");
    await click("Post");
    mocks.action.mockResolvedValueOnce(response({ post: { ...post, moderationState: "needs_review" } }, 202));
    await click("Post");
    expect(uploads()).toHaveLength(1);
    expect(commits()).toHaveLength(2);
    expect(commits()[1][1].body).toBe(commits()[0][1].body);
    expect(commits()[1][1].headers["Idempotency-Key"]).toBe(commits()[0][1].headers["Idempotency-Key"]);
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ moderationState: "needs_review" }));
    expect(mocks.clear).toHaveBeenCalledWith(key);
  });

  it("does not restore a posted gallery when draft deletion fails, and retries cleanup without posting again", async () => {
    let stored: SocialGalleryDraftItem[] | null = null;
    mocks.read.mockImplementation(async () => stored);
    mocks.save.mockImplementation(async (_key, items) => { stored = items; });
    mocks.clear.mockRejectedValue(new Error("Delete unavailable"));
    await mount();
    await choose([photo("posted")]);
    await change("Photo 1 description", "Friends by the canal");
    await changeBody("A saved night");
    mocks.action.mockResolvedValueOnce(response({ post }, 202));
    await click("Post");
    expect(saved).toHaveBeenCalledExactlyOnceWith(post);
    expect(stored).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ submitted: true });
    const submittedKey = commits()[0][1].headers["Idempotency-Key"];
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await mount();
    expect(host.querySelector('input[value="Friends by the canal"]')).toBeNull();
    expect(host.textContent).toContain("Post saved.");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button("Post").disabled).toBe(true);
    await click("Clear saved draft");
    expect(host.textContent).toContain("Post saved.");
    expect(commits()).toHaveLength(1);
    mocks.clear.mockImplementation(async () => { stored = null; });
    await click("Clear saved draft");
    await changeBody("A different night");
    await click("Post");
    expect(commits()).toHaveLength(2);
    expect(commits()[1][1].headers["Idempotency-Key"]).not.toBe(submittedKey);
    expect(JSON.parse(commits()[1][1].body)).not.toHaveProperty("gallery");
  });

  it.each(["pubmaxx:social-composer:v1:other-account:new", "pubmaxx:social-composer:v1:opaque-account:post-17"])(
    "keeps a submitted receipt isolated from another draft: %s", async (otherKey) => {
      const receipt = JSON.stringify({ submitted: true, requestKey: "submitted-key" });
      localStorage.setItem(otherKey, receipt);
      await mount();
      expect(host.textContent).not.toContain("Post saved.");
      await changeBody("My own draft");
      expect(button("Post").disabled).toBe(false);
      expect(localStorage.getItem(otherKey)).toBe(receipt);
      expect(mocks.read).toHaveBeenCalledWith(key);
    },
  );

  it("confirms a text post when photo storage is unavailable", async () => {
    mocks.clear.mockRejectedValue(new Error("Photo storage unavailable"));
    await mount();
    await changeBody("A walk together");
    mocks.action.mockResolvedValueOnce(response({ post }));
    await click("Post");
    expect(saved).toHaveBeenCalledExactlyOnceWith(post);
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the confirmed edit version when saved-draft cleanup succeeds later", async () => {
    await mount(post);
    await changeBody("The saved edit");
    const edited = { ...post, body: "The saved edit", mutationVersion: 6 };
    mocks.action.mockResolvedValueOnce(response({ post: edited }));
    mocks.clear.mockRejectedValueOnce(new Error("Delete unavailable"));
    await click("Save");
    expect(saved).toHaveBeenCalledExactlyOnceWith(edited);
    expect(button("Save").disabled).toBe(true);
    await click("Clear saved draft");
    expect(host.querySelector("textarea")?.value).toBe("The saved edit");
    await changeBody("Another edit");
    await click("Save");
    expect(JSON.parse(commits()[1][1].body).expectedMutationVersion).toBe(6);
  });

  it("retries only failed uploads with their original keys and keeps successful receipts", async () => {
    mocks.action.mockResolvedValueOnce(response({ upload: { mediaId: "first-upload" } }))
      .mockRejectedValueOnce(new TypeError("offline"));
    await mount();
    await choose([photo("one"), photo("two")]);
    expect(button("Post").disabled).toBe(true);
    expect(host.textContent).toContain("offline");
    const failedKey = uploads()[1][1].headers["Idempotency-Key"];
    await click("Retry photos");
    expect(uploads()).toHaveLength(3);
    expect(uploads()[2][1].headers["Idempotency-Key"]).toBe(failedKey);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.lastCall![1][0].mediaId).toBe("first-upload");
  });

  it("keeps an imported legacy photo while adding a gallery", async () => {
    const original = photo("legacy");
    mocks.readLegacy.mockResolvedValue(original);
    localStorage.setItem(key, JSON.stringify({ altText: "Older photo", body: "A night" }));
    await mount();
    await choose([photo("new")]);
    expect(mocks.save.mock.calls[0][1][0]).toMatchObject({ original, altText: "Older photo" });
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(uploads()).toHaveLength(2);
  });

  it("refreshes only an expired individual upload key and waits for an explicit retry", async () => {
    mocks.action.mockResolvedValueOnce(response({ upload: { mediaId: "ready-first" } }))
      .mockResolvedValueOnce(response({ code: "GALLERY_UPLOAD_UNAVAILABLE" }, 409));
    await mount();
    const originals = [photo("first"), photo("expired")];
    await choose(originals);
    expect(uploads()).toHaveLength(2);
    expect(button("Post").disabled).toBe(true);
    const expiredKey = uploads()[1][1].headers["Idempotency-Key"];
    const held = mocks.save.mock.lastCall![1];
    expect(held[0].mediaId).toBe("ready-first");
    expect(held[1]).toMatchObject({ original: originals[1], prepared: undefined, mediaId: undefined });
    expect(held[1].uploadKey).not.toBe(expiredKey);
    expect(host.textContent).toContain("upload expired");
    await click("Retry photos");
    expect(uploads()).toHaveLength(3);
    expect(uploads()[2][1].headers["Idempotency-Key"]).toBe(held[1].uploadKey);
    expect(mocks.prepare).toHaveBeenCalledTimes(3);
    expect(mocks.prepare.mock.lastCall![0]).toBe(originals[1]);
    expect(mocks.save.mock.lastCall![1][0].mediaId).toBe("ready-first");
  });

  it("allows explicit removal of unavailable retained photos without inventing files", async () => {
    await mount(post);
    mocks.action.mockResolvedValueOnce(response({ code: "GALLERY_UPLOAD_UNAVAILABLE" }, 409));
    await click("Save");
    expect(button("Save").disabled).toBe(true);
    await click("Remove photo 1");
    expect(host.querySelector('input[aria-label="Add video"]')).toBeNull();
    expect(button("Save").disabled).toBe(false);
    await click("Save");
    expect(JSON.parse(commits()[1][1].body)).toMatchObject({ expectedMutationVersion: 5, gallery: [] });
    expect(uploads()).toHaveLength(0);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("returns an empty new gallery to both pickers without losing words, audience, or restoring a removed legacy photo", async () => {
    mocks.readLegacy.mockResolvedValue(photo("old-single-photo"));
    localStorage.setItem(key, JSON.stringify({ body: "A quiet evening by the river", visibility: "private", altText: "Old photo" }));
    await mount();
    await choose([photo("new-photo")]);
    await click("Remove photo 1");
    await click("Remove photo 1");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Add photos"]')?.multiple).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Add video"]')?.disabled).toBe(false);
    expect(host.querySelector("textarea")?.value).toBe("A quiet evening by the river");
    expect(host.querySelector<HTMLInputElement>('input[value="private"]')?.checked).toBe(true);
    expect(host.querySelector("img")).toBeNull();
    expect(mocks.saveLegacy).toHaveBeenLastCalledWith(key, null);
    expect(mocks.save).toHaveBeenLastCalledWith(key, []);
    // An empty gallery snapshot also suppresses an older single-file draft after reload.
    mocks.read.mockResolvedValue([]);
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await mount();
    expect(host.querySelector('input[aria-label="Add video"]')).not.toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("textarea")?.value).toBe("A quiet evening by the river");
    expect(host.querySelector<HTMLInputElement>('input[value="private"]')?.checked).toBe(true);
  });

  it.each([false, true])("clears a photo storage error only after successful draft deletion (deletion fails: %s)", async (deletionFails) => {
    mocks.save.mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));
    if (deletionFails) mocks.clear.mockRejectedValue(new Error("Storage unavailable"));
    await mount();
    await changeBody("Original caption");
    await choose([photo("unsaved")]);
    expect(host.textContent).toContain("Your photos could not be saved on this device.");
    expect(uploads()).toHaveLength(0);
    await click("Clear draft");
    expect(mocks.clear).toHaveBeenCalledWith(key);
    expect(host.querySelector("textarea")?.value).toBe(deletionFails ? "Original caption" : "");
    if (deletionFails) {
      expect(host.querySelector(".socialComposerGallery li")).not.toBeNull();
      expect(host.textContent).toContain("Your photo draft could not be cleared. Try again.");
    }
    await changeBody("A walk by the river");
    expect(button("Post").disabled).toBe(deletionFails);
    if (!deletionFails) {
      expect(host.textContent).not.toContain("Your photos could not be saved on this device.");
      await click("Post");
      expect(JSON.parse(commits()[0][1].body)).toMatchObject({ body: "A walk by the river" });
    }
  });

  it("clears a text draft without requiring photo storage", async () => {
    mocks.clear.mockRejectedValue(new Error("Photo storage unavailable"));
    await mount();
    await changeBody("Text without photos");
    await click("Clear draft");
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("restores ordered upload receipts without uploading again", async () => {
    const local = { ...createSocialGalleryDraftItem(photo("restored"), "Saved description"), mediaId: "saved-upload" };
    mocks.read.mockResolvedValue([local]);
    await mount();
    expect(host.textContent).toContain("Photo ready");
    await click("Post");
    expect(uploads()).toHaveLength(0);
    expect(JSON.parse(commits()[0][1].body).gallery).toEqual([{ mediaId: "saved-upload", altText: "Saved description" }]);
  });

  it("keeps retained IDs during explicit expiry recovery and gives local photos new upload keys", async () => {
    await mount(post);
    await choose([photo("new")]);
    await change("Photo 2 description", "New view");
    const originalKey = uploads()[0][1].headers["Idempotency-Key"];
    mocks.action.mockResolvedValueOnce(response({ code: "GALLERY_UPLOAD_UNAVAILABLE" }, 409));
    await click("Save");
    expect(button("Save").disabled).toBe(true);
    const expiredPostKey = commits()[0][1].headers["Idempotency-Key"];
    expect(uploads()).toHaveLength(1);
    await click("Upload photos again");
    expect(uploads()).toHaveLength(2);
    expect(uploads()[1][1].headers["Idempotency-Key"]).not.toBe(originalKey);
    await click("Save");
    expect(commits()[1][1].headers["Idempotency-Key"]).not.toBe(expiredPostKey);
    expect(JSON.parse(commits()[1][1].body)).toMatchObject({ expectedMutationVersion: 5, visibility: "private",
      gallery: [{ mediaId: "retained-1", altText: "Original view" }, { mediaId: "upload-2", altText: "New view" }],
    });
  });

  it("delegates approved retained previews and keeps held photos behind a placeholder", async () => {
    await mount(post);
    expect(mocks.media).toHaveBeenCalledWith(expect.objectContaining({ media: { mediaId: "retained-1", altText: "Original view" } }), undefined);
    await act(async () => { root.unmount(); });
    mocks.media.mockClear();
    root = createRoot(host);
    await mount({ ...post, id: "held-post", moderationState: "needs_review" });
    expect(mocks.media).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Photo held for review");
  });

  it("holds stale gallery drafts until the latest post version and audience are loaded", async () => {
    mocks.read.mockResolvedValue([{ source: "retained", id: "old", mediaId: "old", altText: "Old image" }]);
    localStorage.setItem("pubmaxx:social-composer:v1:opaque-account:post-17", JSON.stringify({ galleryMode: true, visibility: "public", baseMutationVersion: 4 }));
    await mount(post);
    expect(button("Save").disabled).toBe(true);
    mocks.action.mockResolvedValueOnce(response({ post }));
    await click("Load latest");
    expect(host.querySelector<HTMLInputElement>('input[value="private"]')!.checked).toBe(true);
    await click("Save");
    expect(JSON.parse(commits()[1][1].body)).toMatchObject({ expectedMutationVersion: 5, visibility: "private",
      gallery: [{ mediaId: "retained-1", altText: "Original view" }],
    });
  });

  it("aborts an upload on account change and discards its late response", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    mocks.action.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await choose([photo("pending")]);
    expect(button("Post").disabled).toBe(true);
    const signal = uploads()[0][1].signal as AbortSignal;
    await act(async () => {
      account.abort();
      root.render(createElement(SocialComposer, { draftScope: "other-account", onSaved: saved }));
    });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(response({ upload: { mediaId: "late-old-account" } })); });
    expect(mocks.save.mock.calls.some((call) => (call[1] as SocialGalleryDraftItem[]).some((item) => item.mediaId === "late-old-account"))).toBe(false);
    expect(saved).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not upload when account change interrupts preparation", async () => {
    let finish!: (value: unknown) => void;
    mocks.prepare.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    const original = photo("pending");
    await choose([original]);
    const signal = mocks.prepare.mock.calls[0][1].signal as AbortSignal;
    await act(async () => { account.abort(); });
    expect(signal.aborted).toBe(true);
    await act(async () => { finish({ outcome: "prepared", originalFile: original, file: photo("late") }); });
    expect(uploads()).toHaveLength(0);
    expect(mocks.save.mock.lastCall![1][0]).not.toHaveProperty("prepared");
  });

  it("keeps unversioned gallery drafts blocked across a second restoration", async () => {
    mocks.read.mockResolvedValue([{ source: "retained", id: "old", mediaId: "old", altText: "Older view" }]);
    await mount(post);
    expect(button("Save").disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem("pubmaxx:social-composer:v1:opaque-account:post-17")!).baseMutationVersion).toBeNull();
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await mount(post);
    expect(button("Save").disabled).toBe(true);
    expect(commits()).toHaveLength(0);
  });

  it("blocks uploads when originals cannot be persisted, then retries the same originals", async () => {
    mocks.save.mockRejectedValueOnce(new Error("quota"));
    await mount();
    const original = photo("original");
    await choose([original]);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(uploads()).toHaveLength(0);
    expect(host.textContent).toContain("could not be saved");
    await click("Retry photos");
    expect(mocks.prepare).toHaveBeenCalledWith(original, { signal: expect.any(AbortSignal) });
    expect(uploads()).toHaveLength(1);
  });

  it("rejects eleven photos before preparation and removes photos without reuploading", async () => {
    await mount();
    await choose(Array.from({ length: 11 }, (_, index) => photo(String(index))));
    expect(host.textContent).toContain("up to 10");
    expect(mocks.prepare).not.toHaveBeenCalled();
    await choose([photo("one"), photo("two")]);
    await click("Remove photo 1");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    expect(document.activeElement?.closest("label")?.textContent).toBe("Photo 1 description");
    expect(host.textContent).toContain("Photo 1 removed.");
    expect(mocks.save.mock.lastCall![1]).toHaveLength(1);
    expect(mocks.save.mock.lastCall![1][0].mediaId).toBe("upload-2");
    expect(uploads()).toHaveLength(2);
  });
});

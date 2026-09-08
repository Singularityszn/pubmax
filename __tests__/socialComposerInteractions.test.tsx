// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authedActionJson: vi.fn(),
  authedActionFetch: vi.fn(),
  readSocialDraftPhoto: vi.fn(async (): Promise<File | null> => null),
  saveSocialDraftPhoto: vi.fn(async () => undefined),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionJson: mocks.authedActionJson,
  authedActionFetch: mocks.authedActionFetch,
}));
vi.mock("@/lib/socialComposerDrafts", () => ({
  readSocialDraftPhoto: mocks.readSocialDraftPhoto,
  saveSocialDraftPhoto: mocks.saveSocialDraftPhoto,
}));

import type { SocialPostDTO } from "@/lib/socialPosts";

import * as mediaPolicy from "@/lib/socialMediaPolicy";

import SocialComposer from "@/app/social/SocialComposer";

let host: HTMLDivElement;
let root: Root;
const key = "pubmaxx:social-composer:v1:alice:new";
const saved = vi.fn();

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

function input(
  label: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const found = [...host.querySelectorAll("label")].find(
    (item) => item.firstChild?.textContent?.trim() === label,
  );
  const control = found?.querySelector("input, select, textarea");
  if (!(
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
  )) {
    throw new Error(`Missing field: ${label}`);
  }
  return control;
}

async function change(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      control,
      value,
    );
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

async function mount() {
  await act(async () => {
    root.render(
      createElement(SocialComposer, { draftScope: "alice", onSaved: saved }),
    );
  });
  await act(async () => {
    button("New post").click();
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks();
  mocks.readSocialDraftPhoto.mockResolvedValue(null);
  mocks.saveSocialDraftPhoto.mockResolvedValue(undefined);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLElement.prototype, "focus");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Social composer interaction", () => {
  it("puts media first, defaults to friends, and waits for a location choice", async () => {
    await mount();
    const fields = host.querySelector(".socialComposerFields")!;
    expect(fields.firstElementChild?.className).toBe("socialComposerMedia");
    expect(
      host.querySelector<HTMLInputElement>('input[value="friends"]')?.checked,
    ).toBe(true);
    expect(
      [...host.querySelectorAll("details")].every((detail) => !detail.open),
    ).toBe(true);
    await change(input("Write post"), "A walk by the river with friends");
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      body: "A walk by the river with friends",
      visibility: "friends",
      venueId: null,
      area: "",
    });
    mocks.authedActionJson.mockResolvedValue({
      response: new Response("{}", { status: 503 }),
      body: { error: "Try again." },
    });
    await act(async () => {
      button("Post").click();
    });
    const options = mocks.authedActionJson.mock.calls[0][1];
    expect(JSON.parse(options.body)).toMatchObject({
      visibility: "friends",
      venueId: null,
      area: null,
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Try again.",
    );
  });

  it("preserves audience, policies, feature requests and text across unmounts", async () => {
    await mount();
    await change(input("Write post"), "Keep the band on next week");
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[value="private"]')!.click();
    });
    await act(async () => {
      host.querySelectorAll("details")[1].open = true;
    });
    await change(input("Post type"), "feature_request");
    await change(input("Comments"), "locked");
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);
    await mount();
    expect(input("Write post").value).toBe("Keep the band on next week");
    expect(
      host.querySelector<HTMLInputElement>('input[value="private"]')?.checked,
    ).toBe(true);
    expect(input("Post type").value).toBe("feature_request");
    expect(input("Comments").value).toBe("locked");
    await act(async () => {
      button("Clear draft").click();
    });
    expect(input("Write post").value).toBe("");
    expect(
      host.querySelector<HTMLInputElement>('input[value="friends"]')?.checked,
    ).toBe(true);
  });

  it("requires a legacy photo description and keeps restored bytes after a failed post", async () => {
    const photo = new File(["photo"], "friends.jpg", { type: "image/jpeg" });
    mocks.readSocialDraftPhoto.mockResolvedValue(photo);
    await mount();
    expect(button("Post").disabled).toBe(true);
    await change(input("Photo description"), "Friends beside the canal");
    expect(host.querySelector("img")?.alt).toBe("Friends beside the canal");
    mocks.authedActionJson.mockRejectedValue(new TypeError("Connection lost"));
    await act(async () => {
      button("Post").click();
    });
    const body = mocks.authedActionJson.mock.calls[0][1].body as FormData;
    expect(body.get("photo")).toBe(photo);
    expect(JSON.parse(body.get("post") as string)).toMatchObject({
      photoAltText: "Friends beside the canal",
      visibility: "friends",
    });
    expect(mocks.saveSocialDraftPhoto).toHaveBeenCalledWith(key, photo);
    expect(host.querySelector("img")).not.toBeNull();
    await act(async () => {
      button("Remove selected photo").click();
    });
    expect(host.querySelector("img")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("previews video without autoplay and submits only the video wire field", async () => {
    await mount();
    const validation = vi
      .spyOn(mediaPolicy, "inspectSocialVideo")
      .mockReturnValue({ width: 640, height: 360, durationSeconds: 4 });
    const video = new File(["mp4 fixture"], "band.mp4", { type: "video/mp4" });
    Object.defineProperty(video, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const picker = host.querySelector<HTMLInputElement>('input[accept*="video/mp4"]')!;
    await act(async () => {
      Object.defineProperty(picker, "files", { value: [video] });
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(validation).toHaveBeenCalledOnce();
    const preview = host.querySelector("video")!;
    expect(preview.controls).toBe(true);
    expect(preview.playsInline).toBe(true);
    expect(preview.autoplay).toBe(false);
    expect(preview.preload).toBe("metadata");
    expect(host.textContent).not.toContain("Photo tags");
    expect(button("Post").disabled).toBe(true);
    await change(input("Video description"), "The band plays beside the canal");
    mocks.authedActionJson.mockRejectedValue(new TypeError("Connection lost"));
    await act(async () => {
      button("Post").click();
    });
    const body = mocks.authedActionJson.mock.calls[0][1].body as FormData;
    expect(body.get("video")).toBe(video);
    expect(body.has("photo")).toBe(false);
    expect(JSON.parse(body.get("post") as string)).toMatchObject({
      photoAltText: "The band plays beside the canal",
      visibility: "friends",
    });
    expect(JSON.parse(body.get("post") as string)).not.toHaveProperty(
      "tagHandles",
    );
    expect(mocks.saveSocialDraftPhoto).toHaveBeenCalledWith(key, video);
    expect(button("Remove selected video")).toBeDefined();
  });

  it("refuses an oversized attachment and preserves the previous photo", async () => {
    const existing = new File(["photo"], "friends.jpg", { type: "image/jpeg" });
    mocks.readSocialDraftPhoto.mockResolvedValue(existing);
    await mount();
    const oversized = new File(["video"], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(oversized, "size", {
      value: mediaPolicy.SOCIAL_VIDEO_MAX_BYTES + 1,
    });
    const picker = host.querySelector<HTMLInputElement>('input[accept*="video/mp4"]')!;
    await act(async () => {
      Object.defineProperty(picker, "files", { value: [oversized] });
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "up to 4 MB",
    );
    expect(host.querySelector("img")).not.toBeNull();
    expect(host.querySelector("video")).toBeNull();
    expect(mocks.authedActionJson).not.toHaveBeenCalled();
  });

  it("claims Enter in venue search even without an active result", async () => {
    await mount();
    await change(input("Write post"), "A good night beside the canal");
    const venue = input("Venue - Friends only");
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => { venue.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.authedActionJson).not.toHaveBeenCalled();
    expect(button("Post").disabled).toBe(false);
  });

  it("wraps focus over collapsed controls and returns to the trigger on Escape", async () => {
    await mount();
    const last = host.querySelectorAll("summary")[1];
    await act(async () => {
      last.focus();
      last.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(button("Cancel"));
    await act(async () => {
      button("Cancel").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);
    await act(async () => {
      last.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button("New post"));
  });
});

const editPost: SocialPostDTO = {
  id: "edit-1", kind: "standard", visibility: "private", body: "Current private post",
  area: null, venueId: null, venueName: null, venueProjected: false, hashtags: [],
  commentPolicy: "locked", photo: null, moderationState: "approved", featureRequest: null,
  revision: 2, mutationVersion: 2, editedAt: null, createdAt: "2026-09-07T18:00:00Z",
  updatedAt: "2026-09-07T19:00:00Z", author: { handle: "alice" }, ownedByViewer: true,
};

async function edit(post: SocialPostDTO) {
  await act(async () => { root.render(createElement(SocialComposer, { post, draftScope: "alice", onSaved: saved })); });
  await act(async () => { button("Edit post").click(); });
}

describe("Social composer edit boundaries", () => {
  it("resolves approved attachments through the shared authenticated reader", async () => {
    mocks.authedActionFetch.mockResolvedValue(new Response(JSON.stringify({ url: "https://media.example.test/photo.jpg" })));
    await edit({ ...editPost, photo: { mediaId: "media-1", altText: "Friends together" } });
    expect(mocks.authedActionFetch).toHaveBeenCalledWith(
      "/api/social/media/media-1?format=json", expect.any(Object), { requiresIdentity: true },
    );
    expect(host.querySelector("img")?.src).toBe("https://media.example.test/photo.jpg");
    expect(host.querySelector('img[src^="/api/social/media/"]')).toBeNull();
  });

  it("names held attachments without requesting their bytes", async () => {
    await edit({ ...editPost, moderationState: "needs_review", photo: { mediaId: "held-1", altText: "Band", kind: "video", contentType: "video/mp4" } });
    expect(host.textContent).toContain("Video held for review. Preview is not available.");
    expect(mocks.authedActionFetch).not.toHaveBeenCalled();
    expect(host.querySelector("video, img")).toBeNull();
    expect(input("Video description").value).toBe("Band");
    expect(button("Remove video")).toBeDefined();
  });

  it.each([1, undefined])("blocks an older or unversioned edit draft (%s) until the latest privacy choices are loaded", async (baseMutationVersion) => {
    const draftKey = "pubmaxx:social-composer:v1:alice:edit-1";
    localStorage.setItem(draftKey, JSON.stringify({ body: "Older caption", visibility: "public", commentPolicy: "open", baseMutationVersion }));
    await edit(editPost);
    expect(input("Write post").value).toBe("Older caption");
    expect(button("Save").disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Load latest before saving");
    await act(async () => { button("Save").click(); });
    expect(mocks.authedActionJson).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(draftKey)!)).toMatchObject({ body: "Older caption", baseMutationVersion: baseMutationVersion ?? null });

    mocks.authedActionJson.mockResolvedValueOnce({ response: new Response("{}"), body: { post: editPost } });
    await act(async () => { button("Load latest").click(); });
    expect(input("Write post").value).toBe("Current private post");
    expect(host.querySelector<HTMLInputElement>('input[value="private"]')?.checked).toBe(true);
    expect(input("Comments").value).toBe("locked");
    expect(JSON.parse(localStorage.getItem(draftKey)!)).toMatchObject({ baseMutationVersion: 2, visibility: "private" });
    mocks.authedActionJson.mockResolvedValueOnce({ response: new Response("{}"), body: { post: editPost } });
    await act(async () => { button("Save").click(); });
    const write = mocks.authedActionJson.mock.calls.at(-1)![1];
    expect(JSON.parse(write.body)).toMatchObject({ expectedMutationVersion: 2, visibility: "private", commentPolicy: "locked" });
  });

  it("restores an edit based on the same revision without discarding the draft", async () => {
    localStorage.setItem("pubmaxx:social-composer:v1:alice:edit-1", JSON.stringify({ body: "Revised caption", visibility: "private", baseMutationVersion: 2 }));
    await edit(editPost);
    expect(input("Write post").value).toBe("Revised caption");
    expect(button("Save").disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

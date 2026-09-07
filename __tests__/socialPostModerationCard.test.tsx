// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialPostAdminHeldItem } from "@/lib/socialPostConsentStore";

const callbacks = vi.hoisted(() => new Map<string, () => void>());
vi.mock("next/image", () => ({
  default: (input: Record<string, unknown>) => {
    const props = { ...input };
    delete props.unoptimized;
    callbacks.set(String(props.src), props.onLoad as () => void);
    return createElement("img", props);
  },
}));

import SocialPostModerationCard, { socialPostReviewKey } from "@/app/admin/SocialPostModerationCard";

const photos = [
  { mediaId: "22222222-2222-4222-8222-222222222222", altText: "Friends outside" },
  { mediaId: "33333333-3333-4333-8333-333333333333", altText: "Friends beside the river" },
];
const post: SocialPostAdminHeldItem = {
  postId: "11111111-1111-4111-8111-111111111111", mediaId: photos[0].mediaId,
  photos, revision: 4, authorHandle: "alice", staffDisplayName: "Captain", body: "Friday evening",
  photoAltText: photos[0].altText, area: null, venueId: null, visibility: "friends", commentPolicy: "open",
  moderationClaim: "Review needed", moderationState: "needs_review",
  createdAt: "2026-09-07T20:00:00Z", updatedAt: "2026-09-07T20:00:00Z",
};
let host: HTMLDivElement;
let root: Root;
let decide: ReturnType<typeof vi.fn<(post: SocialPostAdminHeldItem, action: "approve" | "hide") => void>>;
function button(label: string) { return [...host.querySelectorAll("button")].find(button => button.textContent === label)!; }
async function render(value = post) {
  await act(async () => root.render(createElement(SocialPostModerationCard, {
    key: socialPostReviewKey(value), post: value, pendingAction: null, onDecision: decide,
  })));
}
async function imageEvent(index: number, event = "load") {
  await act(async () => host.querySelectorAll("img")[index].dispatchEvent(new Event(event)));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  callbacks.clear();
  decide = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("admin gallery previews", () => {
  it("shows every current photo in order and waits for every image before approval", async () => {
    await render();
    const images = [...host.querySelectorAll("img")];
    expect(images.map(image => image.alt)).toEqual(photos.map(photo => photo.altText));
    expect(images.every(image => image.getAttribute("loading") === "eager")).toBe(true);
    expect(images.map(image => image.getAttribute("src"))).toEqual(photos.map(photo => `/api/admin/social-posts/media/${photo.mediaId}?revision=4&attempt=0`));
    expect(button("Approve").disabled).toBe(true);
    expect(button("Hide").disabled).toBe(false);
    await imageEvent(0);
    await act(async () => button("Approve").click());
    expect(decide).not.toHaveBeenCalled();
    await imageEvent(1);
    expect(button("Approve").disabled).toBe(false);
    await act(async () => button("Approve").click());
    expect(decide).toHaveBeenCalledWith(post, "approve");
  });

  it("keeps Hide available when a preview fails and reloads all previews for a retry", async () => {
    await render();
    const staleLoads = [...callbacks.values()];
    await imageEvent(0);
    await imageEvent(1, "error");
    expect(button("Approve").disabled).toBe(true);
    expect(button("Hide").disabled).toBe(false);
    expect(host.textContent).toContain("Photo preview failed.");
    await act(async () => button("Reload previews").click());
    await act(async () => staleLoads.forEach(load => load()));
    expect(button("Approve").disabled).toBe(true);
    expect([...host.querySelectorAll("img")].every(image => image.src.endsWith("attempt=1"))).toBe(true);
    await imageEvent(0);
    expect(button("Approve").disabled).toBe(true);
    await imageEvent(1);
    expect(button("Approve").disabled).toBe(false);
  });

  it("does not reuse loaded previews after the revision changes", async () => {
    await render();
    const staleLoads = [...callbacks.values()];
    await imageEvent(0);
    await imageEvent(1);
    await render({ ...post, revision: 5 });
    expect(button("Approve").disabled).toBe(true);
    await act(async () => staleLoads.forEach(load => load()));
    expect(button("Approve").disabled).toBe(true);
    await imageEvent(0);
    await imageEvent(1);
    await act(async () => button("Approve").click());
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ revision: 5 }), "approve");
  });

  it("resets readiness when gallery membership or order changes", async () => {
    await render();
    await imageEvent(0);
    await imageEvent(1);
    await render({ ...post, mediaId: photos[1].mediaId, photos: [...photos].reverse() });
    expect(button("Approve").disabled).toBe(true);
    expect(host.querySelector("img")?.alt).toBe(photos[1].altText);
  });

  it("requires a legacy photo preview and preserves legacy video review", async () => {
    await render({ ...post, photos: undefined });
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(button("Approve").disabled).toBe(true);
    await imageEvent(0);
    expect(button("Approve").disabled).toBe(false);
    await render({ ...post, photos: undefined, media: { kind: "video", contentType: "video/mp4" } });
    const video = host.querySelector("video")!;
    expect(video.controls).toBe(true);
    expect(button("Approve").disabled).toBe(true);
    await act(async () => video.dispatchEvent(new Event("loadeddata")));
    expect(button("Approve").disabled).toBe(false);
    await act(async () => video.dispatchEvent(new Event("error")));
    expect(button("Approve").disabled).toBe(true);
  });

  it("allows text-only approval for legacy posts and explicitly empty galleries", async () => {
    for (const gallery of [undefined, []]) {
      await render({ ...post, mediaId: null, photoAltText: null, photos: gallery });
      expect(host.querySelectorAll("img,video")).toHaveLength(0);
      expect(button("Approve").disabled).toBe(false);
    }
  });
});

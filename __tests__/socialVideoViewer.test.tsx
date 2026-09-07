// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialPostDTO } from "@/lib/socialPosts";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: read }));

import SocialVideoViewer, { socialFeedVideos, type SocialFeedVideo } from "@/components/social/SocialVideoViewer";

const videos: SocialFeedVideo[] = Array.from({ length: 3 }, (_, index) => ({
  postId: `post-${index}`, revision: 1, authorHandle: `friend${index}`, body: `Evening ${index}`,
  media: { mediaId: `video-${index}`, altText: `Friends dancing ${index}`, kind: "video", contentType: "video/mp4" },
}));
let host: HTMLDivElement;
let root: Root;
let viewportHeight: number;
let resize: () => void;
let scrollDescriptor: PropertyDescriptor | undefined;
let showDescriptor: PropertyDescriptor | undefined;
let closeDescriptor: PropertyDescriptor | undefined;

function Harness({ initial = "post-0", items = videos }: { initial?: string; items?: SocialFeedVideo[] }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Watch videos</button>
    {open ? <SocialVideoViewer videos={items} initialPostId={initial} onClose={() => setOpen(false)} /> : null}
  </>;
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label || button.textContent === label)!;
}
function track() { return host.querySelector<HTMLDivElement>(".socialVideoViewer__track")!; }
function status() { return host.querySelector('footer [role="status"]')?.textContent; }
async function open(initial = "post-0") {
  await act(async () => root.render(createElement(Harness, { initial })));
  button("Watch videos").focus();
  await act(async () => button("Watch videos").click());
}
async function key(value: string, element: Element = track()) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(async () => { element.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  read.mockReset().mockImplementation(async (path: string) => ({ ok: true, json: async () => ({ url: `https://media.example/${path.split("/").at(-1)!.split("?")[0]}.mp4` }) }));
  viewportHeight = 600;
  resize = () => {};
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => viewportHeight);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  showDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const [prototype, property, descriptor] of [
    [HTMLElement.prototype, "scrollTo", scrollDescriptor],
    [HTMLDialogElement.prototype, "showModal", showDescriptor],
    [HTMLDialogElement.prototype, "close", closeDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(prototype, property, descriptor);
    else Reflect.deleteProperty(prototype, property);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("feed video viewer", () => {
  it("uses only actual current feed videos and respects explicit empty galleries", () => {
    const base: SocialPostDTO = {
      id: "a", kind: "standard", body: "Evening", photo: videos[0].media,
      author: { handle: "alice" }, revision: 1, mutationVersion: 1, visibility: "friends", commentPolicy: "open",
      area: null, venueId: null, hashtags: [], moderationState: "approved", featureRequest: null,
      editedAt: null, createdAt: "2026-09-07T20:00:00Z", updatedAt: "2026-09-07T20:00:00Z",
      ownedByViewer: false, venueName: null, venueProjected: false,
    };
    expect(socialFeedVideos([
      base, { ...base, id: "empty", photos: [] }, { ...base, id: "photo", photo: { mediaId: "photo", altText: "Pub" } },
      { ...base, id: "b", photo: videos[1].media },
    ]).map(video => [video.postId, video.media.mediaId])).toEqual([["a", "video-0"], ["b", "video-1"]]);
  });

  it("does no reads before opening, then authorizes only the selected native player without autoplay", async () => {
    await act(async () => root.render(createElement(Harness)));
    expect(read).not.toHaveBeenCalled();
    await open("post-1");
    expect(document.activeElement).toBe(button("Close video viewer"));
    expect(host.querySelector("dialog")?.open).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("/api/social/media/video-1?format=json", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }), { requiresIdentity: true });
    const player = host.querySelector("video")!;
    expect(player.getAttribute("aria-label")).toBe("Friends dancing 1");
    expect(player.controls).toBe(true);
    expect(player.playsInline).toBe(true);
    expect(player.autoplay).toBe(false);
    expect(track().scrollTop).toBe(600);
    expect(status()).toBe("Video 2 / 3");
  });

  it("pauses the previous player and moves one video at a time with controls and native scrolling", async () => {
    await open();
    const first = host.querySelector("video")!;
    const paused = vi.spyOn(first, "pause");
    await act(async () => button("Next video").click());
    expect(paused).toHaveBeenCalled();
    expect(first.isConnected).toBe(false);
    expect(host.querySelectorAll("video")).toHaveLength(1);
    expect(status()).toBe("Video 2 / 3");
    await act(async () => { track().scrollTop = 1200; track().dispatchEvent(new Event("scroll")); });
    expect(status()).toBe("Video 3 / 3");
    expect(button("Next video").disabled).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    await act(async () => button("Previous video").click());
    expect(status()).toBe("Video 2 / 3");
  });

  it("supports navigation keys while preserving native playback keys", async () => {
    await open();
    expect((await key("ArrowDown")).defaultPrevented).toBe(true);
    expect(status()).toBe("Video 2 / 3");
    expect((await key("ArrowDown", host.querySelector("video")!)).defaultPrevented).toBe(false);
    expect(status()).toBe("Video 2 / 3");
    await key("End");
    expect(status()).toBe("Video 3 / 3");
    await key("ArrowUp");
    expect(status()).toBe("Video 2 / 3");
    await key("Home");
    expect(status()).toBe("Video 1 / 3");
    expect(button("Previous video").disabled).toBe(true);
  });

  it("restores trigger focus and page scrolling when Escape or Close dismisses the dialog", async () => {
    document.body.style.overflow = "auto";
    await open();
    const player = host.querySelector("video")!;
    const paused = vi.spyOn(player, "pause");
    await act(async () => { host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(host.querySelector("dialog")).toBeNull();
    expect(paused).toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Watch videos"));
    expect(document.body.style.overflow).toBe("auto");
    await act(async () => button("Watch videos").click());
    await act(async () => button("Close video viewer").click());
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(button("Watch videos"));
    document.body.style.overflow = "";
  });

  it("keeps the current video aligned after resize without reading another video", async () => {
    await open("post-1");
    viewportHeight = 400;
    await act(async () => resize());
    expect(track().scrollTop).toBe(400);
    expect(status()).toBe("Video 2 / 3");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shows a real authorization failure and retries through the existing media path", async () => {
    read.mockResolvedValueOnce({ ok: false, body: null });
    await open();
    expect(host.textContent).toContain("Video unavailable.");
    expect(host.querySelector("video")).toBeNull();
    await act(async () => button("Try again").click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(host.querySelector("video")).not.toBeNull();
    expect(status()).toBe("Video 1 / 3");
  });

  it("renders no invented empty viewer when the selected video is absent", async () => {
    await open("absent");
    expect(host.querySelector("dialog")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

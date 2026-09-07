// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMedia = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: fetchMedia }));
import SocialPostMedia from "@/components/social/SocialPostMedia";

let host: HTMLDivElement;
let root: Root;
let observers: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit }>;
const photo = { mediaId: "photo-a", altText: "Friends at the gig" };
async function render(media = photo) { await act(async () => root.render(<SocialPostMedia media={media} />)); }
async function enter() {
  await act(async () => observers[0].callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({ callback, options }); }
    observe() {} disconnect() {}
  });
  fetchMedia.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("authorized Social media", () => {
  it("waits near the viewport before asking for a private URL", async () => {
    fetchMedia.mockResolvedValue(new Response(JSON.stringify({ url: "https://storage.example.test/photo.jpg" })));
    await render();
    expect(fetchMedia).not.toHaveBeenCalled();
    await enter();
    expect(fetchMedia).toHaveBeenCalledWith("/api/social/media/photo-a?format=json", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }), { requiresIdentity: true });
    expect(host.querySelector("img")?.src).toBe("https://storage.example.test/photo.jpg");
    expect(host.innerHTML).not.toContain("Bearer");
  });

  it("revokes the previous view immediately when media changes", async () => {
    fetchMedia.mockResolvedValue(new Response(JSON.stringify({ url: "https://storage.example.test/old.jpg" })));
    await render(); await enter();
    const signal = fetchMedia.mock.calls[0][1].signal as AbortSignal;
    await render({ mediaId: "photo-b", altText: "A different night" });
    expect(signal.aborted).toBe(true);
    expect(host.innerHTML).not.toContain("old.jpg");
  });

  it("fetches local media with authentication and revokes its object URL", async () => {
    const createObjectURL = vi.fn(() => "blob:http://localhost/local-photo");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    fetchMedia.mockResolvedValueOnce(new Response(JSON.stringify({ url: "/api/social/media/photo-a" })))
      .mockResolvedValueOnce(new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } }));
    await render(); await enter();
    expect(fetchMedia).toHaveBeenLastCalledWith("/api/social/media/photo-a", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }), { requiresIdentity: true });
    expect(host.querySelector("img")?.src).toBe("blob:http://localhost/local-photo");
    await render({ ...photo, mediaId: "photo-b" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/local-photo");
  });

  it("shows a failed read and rechecks authorization on retry", async () => {
    fetchMedia.mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://storage.example.test/new.jpg" })));
    await render(); await enter();
    expect(host.textContent).toContain("Photo unavailable.");
    await act(async () => host.querySelector("button")!.click());
    expect(fetchMedia).toHaveBeenCalledTimes(2);
    expect(host.querySelector("img")?.src).toBe("https://storage.example.test/new.jpg");
  });

  it("refuses executable URLs returned by a malformed response", async () => {
    fetchMedia.mockResolvedValue(new Response(JSON.stringify({ url: "javascript:alert(1)" })));
    await render(); await enter();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Photo unavailable.");
  });

  it("uses native video controls and pauses when the clip leaves view", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    fetchMedia.mockResolvedValue(new Response(JSON.stringify({ url: "https://storage.example.test/video.mp4" })));
    await act(async () => root.render(<SocialPostMedia media={{ ...photo, kind: "video", contentType: "video/mp4" }} />));
    await enter();
    const video = host.querySelector("video")!;
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.playsInline).toBe(true);
    await act(async () => observers[1].callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(pause).toHaveBeenCalled();
  });
});

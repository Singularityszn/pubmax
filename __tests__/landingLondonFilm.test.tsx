// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingLondonFilm from "@/components/landing/LandingLondonFilm";

afterEach(() => vi.unstubAllGlobals());

describe("the optional London film", () => {
  it("requests no video until the reader chooses playback, and offers a retry after failure", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(LandingLondonFilm)));
      expect(container.querySelector("video, source")).toBeNull();
      expect(container.querySelector("img")?.getAttribute("loading")).toBe("lazy");
      const play = container.querySelector("button");
      expect(play?.textContent).toContain("Play London film");
      await act(async () => play?.click());
      const video = container.querySelector("video");
      expect(video?.getAttribute("src")).toBe("/landing/london-film/london.mp4");
      expect(video?.controls).toBe(true);
      expect(video?.loop).toBe(false);
      expect(video?.getAttribute("playsinline")).not.toBeNull();
      expect(video?.getAttribute("aria-describedby")).toBe("london-film-description");
      await act(async () => video?.dispatchEvent(new Event("error")));
      expect(container.querySelector("video")).toBeNull();
      expect(container.querySelector('[role="status"]')?.textContent).toContain("could not load");
      expect(container.querySelector("button")?.textContent).toContain("Try the film again");
      await act(async () => container.querySelector("button")?.click());
      expect(container.querySelector("video")?.controls).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

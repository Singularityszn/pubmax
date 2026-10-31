// @vitest-environment jsdom
// The live 3D stage on /pal asks for its art only once the head loop draws, and
// never shows itself where it cannot draw (no WebGL), so the still photograph
// under it stays the picture. The real drawing is proved in a browser; jsdom
// has no WebGL, which is exactly the fallback these pin.
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PalPortrait from "@/components/pal/PalPortrait";
import PalStageCanvas, { type PalStageHandle } from "@/components/pal/PalStageCanvas";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";

let root: Root | null = null;
let host: HTMLDivElement;
let requested: string[];
const RealImage = globalThis.Image;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  requested = [];
  // An image that loads at once, so the stage reaches its WebGL setup.
  globalThis.Image = class {
    decoding = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      requested.push(value);
      queueMicrotask(() => this.onload?.());
    }
  } as unknown as typeof Image;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  globalThis.Image = RealImage;
  vi.restoreAllMocks();
});

function render() {
  const handle = createRef<PalStageHandle>();
  act(() => {
    root = createRoot(host);
    root.render(createElement(PalStageCanvas, { species: "fox", ref: handle }));
  });
  return handle;
}

const head = { seconds: 1, yaw: 4, pitch: 1, roll: 0, mouth: 0 };

describe("PalStageCanvas", () => {
  it("fetches nothing until the head loop draws", () => {
    render();
    expect(requested).toEqual([]);
    const canvas = host.querySelector("canvas");
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    expect(canvas?.hasAttribute("data-stage")).toBe(false);
  });

  it("asks for the two 512 WebP renditions on the first frame", async () => {
    const handle = render();
    await act(async () => {
      handle.current?.draw(head);
    });
    expect(requested).toEqual(["/pal/circuit-fox-512.webp", "/pal/circuit-fox-talk-512.webp"]);
  });

  it("never shows itself without WebGL, so the photograph stays the picture", async () => {
    const handle = render();
    await act(async () => {
      handle.current?.draw(head);
    });
    await act(async () => {
      handle.current?.draw(head);
      handle.current?.draw(head);
    });
    expect(host.querySelector("canvas")?.hasAttribute("data-stage")).toBe(false);
  });
});

describe("PalPortrait with the stage", () => {
  // app/pal/pal.css animates the TRANSFORM of `.palPortraitMascot` for the
  // state motion, and the genome framing (zoom, position, flip) is a transform
  // too. On one element the animation replaced the framing every idle cycle,
  // so the stage carries the two on two layers, as the picture does.
  it("moves a frame with the state motion and keeps the framing on the canvas", () => {
    act(() => {
      root = createRoot(host);
      root.render(
        createElement(PalPortrait, {
          appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "fox" },
          name: "Ripley",
          stage: createRef<PalStageHandle>(),
        }),
      );
    });
    const canvas = host.querySelector("canvas.palStageCanvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.classList.contains("palPortraitMascot")).toBe(false);
    const frame = canvas?.parentElement;
    expect(frame?.classList.contains("palPortraitMascot")).toBe(true);
    expect(frame?.classList.contains("palStageFrame")).toBe(true);
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws no stage where no head loop drives the portrait", () => {
    act(() => {
      root = createRoot(host);
      root.render(
        createElement(PalPortrait, {
          appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "fox" },
          name: "Ripley",
        }),
      );
    });
    expect(host.querySelector("canvas")).toBeNull();
  });
});

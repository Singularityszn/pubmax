// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalMeshStatus, PalMeshSurface } from "@/components/pal/originalPalMeshRenderer.mjs";
import type { PubPalSpecies } from "@/lib/pubPal";

const renderer = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock("@/components/pal/originalPalMeshRenderer.mjs", () => ({ mountOriginalPalMesh: renderer.mount }));

import PalVoiceFace from "@/components/pubpal/PalVoiceFace";
import PalPortrait from "@/components/pal/PalPortrait";
import { DEFAULT_PAL_DRAFT, type PalAnimationState } from "@/lib/pubPal";
import { pubPalMascotModelSrc } from "@/lib/pubPalMascot";
import { createPalVoiceSignal, type PalVoiceSignal } from "@/lib/palVoiceSignal";

let root: Root;
let container: HTMLDivElement;
let hidden = false;
let reduced = false;
let inView = true;
let onIntersection: IntersectionObserverCallback;
let motionChange: EventListener;
let frameId = 0;
let frames: Map<number, FrameRequestCallback>;
let mounted: Array<{ surface: PalMeshSurface; status: (value: PalMeshStatus) => void }>;

function Portrait({ species = "robin", decorative = false, compact = false, signal, state }: {
  species?: PubPalSpecies;
  decorative?: boolean;
  compact?: boolean;
  signal?: PalVoiceSignal;
  state?: PalAnimationState;
}) {
  const appearance = { ...DEFAULT_PAL_DRAFT.appearance, species };
  return decorative
    ? <PalVoiceFace appearance={appearance} state="idle" signal={signal} />
    : <PalPortrait name="Nova" appearance={appearance} compact={compact} signal={signal} state={state} />;
}

async function render(props: Parameters<typeof Portrait>[0] = {}) {
  await act(async () => { root.render(createElement(Portrait, props)); });
  await act(async () => { await vi.dynamicImportSettled(); });
}

function modelHost() {
  return container.querySelector<HTMLElement>("[data-pal-model-host]")!;
}

function markReady(index = mounted.length - 1) {
  mounted[index]!.status("ready");
}

function frame(now: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(now);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hidden = false;
  reduced = false;
  inView = true;
  frames = new Map();
  mounted = [];
  renderer.mount.mockReset().mockImplementation((_host, options) => {
    const surface: PalMeshSurface = { renderPose: vi.fn(() => true), setYaw: vi.fn(), turnYaw: vi.fn(), setVisible: vi.fn(), dispose: vi.fn() };
    mounted.push({ surface, status: options.onStatus });
    options.onStatus("loading");
    return surface;
  });
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    width: inView ? 200 : 0, height: inView ? 200 : 0, top: 10, left: 10, bottom: 210, right: 210,
  } as DOMRect));
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener(_type: string, listener: EventListener) { motionChange = listener; }, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { onIntersection = callback; }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the selected Pal model lifecycle", () => {
  it("loads only the selected species and ignores a late prior-species completion", async () => {
    await render();
    expect(renderer.mount.mock.calls[0]![1].modelUrl).toBe(pubPalMascotModelSrc("robin"));
    await render({ species: "cat" });
    expect(mounted[0]!.surface.dispose).toHaveBeenCalledOnce();
    expect(renderer.mount.mock.calls[1]![1].modelUrl).toBe(pubPalMascotModelSrc("cat"));
    mounted[0]!.status("ready");
    expect(modelHost().dataset.modelState).toBe("loading");
    markReady();
    expect(modelHost().getAttribute("aria-hidden")).toBe("false");
    expect(modelHost().tabIndex).toBe(0);
  });

  it("waits for a visible surface and holds drawing when the tab is hidden", async () => {
    inView = false;
    await render();
    expect(renderer.mount).not.toHaveBeenCalled();
    inView = true;
    onIntersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(renderer.mount).toHaveBeenCalledOnce();
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    markReady();
    expect(frames.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mounted[0]!.surface.setVisible).toHaveBeenLastCalledWith(true);
    frame(1000);
    expect(mounted[0]!.surface.renderPose).toHaveBeenCalledOnce();
  });

  it("restores the still portrait on a motion change and remounts on browser Back", async () => {
    await render();
    markReady();
    reduced = true;
    motionChange(new Event("change"));
    expect(modelHost().dataset.modelState).toBe("poster");
    expect(modelHost().hasAttribute("tabindex")).toBe(false);
    expect(frames.size).toBe(0);
    expect(mounted[0]!.surface.dispose).toHaveBeenCalledOnce();
    reduced = false;
    motionChange(new Event("change"));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(renderer.mount).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(mounted[1]!.surface.dispose).toHaveBeenCalledOnce();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(renderer.mount).toHaveBeenCalledTimes(3);
  });

  it("exposes keyboard rotation only for the ready owned portrait", async () => {
    await render();
    markReady();
    modelHost().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    modelHost().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
    expect(mounted[0]!.surface.turnYaw).toHaveBeenCalledWith(15);
    expect(mounted[0]!.surface.setYaw).toHaveBeenCalledWith(0);
    await render({ decorative: true });
    markReady();
    modelHost().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(mounted[1]!.surface.turnYaw).not.toHaveBeenCalled();
    expect(modelHost().hasAttribute("tabindex")).toBe(false);
    expect(modelHost().getAttribute("aria-hidden")).toBe("true");
  });

  it("retires the faded model's focus, exposure and keys while the Pal talks, and restores them after", async () => {
    await render({ state: "idle" });
    markReady();
    const host = modelHost();
    host.focus();
    expect(document.activeElement).toBe(host);
    for (const talkingState of ["speaking", "listening"] as const) {
      await render({ state: talkingState });
      expect(host.getAttribute("aria-hidden")).toBe("true");
      expect(host.hasAttribute("tabindex")).toBe(false);
      expect(document.activeElement).not.toBe(host);
      host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
      host.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
      expect(mounted[0]!.surface.turnYaw).not.toHaveBeenCalled();
      expect(mounted[0]!.surface.setYaw).not.toHaveBeenCalled();
    }
    await render({ state: "idle" });
    expect(host.getAttribute("aria-hidden")).toBe("false");
    expect(host.tabIndex).toBe(0);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    expect(mounted[0]!.surface.turnYaw).toHaveBeenCalledWith(15);
    expect(renderer.mount).toHaveBeenCalledOnce();
  });

  it("uses the existing real voice signal for mesh poses and restores the picture after graphics loss", async () => {
    const signal = createPalVoiceSignal();
    signal.attach({ mode: "speaking", getInputVolume: () => 0, getOutputByteFrequencyData: () => new Uint8Array([255, 255, 255]) });
    await render({ signal });
    markReady();
    frame(1000);
    const draw = vi.mocked(mounted[0]!.surface.renderPose);
    expect(draw.mock.calls[0]![0].lift).toBeGreaterThan(0);
    expect(draw.mock.calls[0]![0].scale).toBeGreaterThan(1);
    mounted[0]!.status("graphics-lost");
    expect(modelHost().getAttribute("aria-hidden")).toBe("true");
    expect(modelHost().hasAttribute("tabindex")).toBe(false);
    markReady();
    expect(modelHost().getAttribute("aria-hidden")).toBe("false");
  });

  it("never loads a model when reduced motion is selected before mount", async () => {
    reduced = true;
    await render();
    expect(renderer.mount).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("keeps an initially compact portrait still and starts live work once when it grows", async () => {
    await render({ compact: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await act(async () => { await vi.dynamicImportSettled(); });
    const portrait = container.querySelector<HTMLElement>(".palPortrait")!;
    expect(frames.size).toBe(0);
    expect(renderer.mount).not.toHaveBeenCalled();
    expect(portrait.hasAttribute("data-head-3d")).toBe(false);
    expect(portrait.style.getPropertyValue("--pal-yaw")).toBe("");
    expect(container.querySelector("[data-pal-model-host]")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    await render({ compact: false });
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(frames.size).toBe(1);
    expect(portrait.getAttribute("data-head-3d")).toBe("live");
    await act(async () => { root.render(null); });
    expect(frames.size).toBe(0);
    expect(mounted[0]!.surface.dispose).toHaveBeenCalledOnce();
  });

  it("cancels live work and disposes the model when a live portrait turns compact", async () => {
    await render();
    markReady();
    frame(1000);
    const portrait = container.querySelector<HTMLElement>(".palPortrait")!;
    expect(mounted[0]!.surface.renderPose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(1);
    expect(portrait.style.getPropertyValue("--pal-yaw")).not.toBe("");
    await render({ compact: true });
    expect(frames.size).toBe(0);
    expect(mounted[0]!.surface.dispose).toHaveBeenCalledOnce();
    expect(portrait.hasAttribute("data-head-3d")).toBe(false);
    expect(portrait.style.getPropertyValue("--pal-yaw")).toBe("");
    expect(container.querySelector("[data-pal-model-host]")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    expect(renderer.mount).toHaveBeenCalledOnce();
  });
});

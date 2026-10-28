// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const graphics = vi.hoisted(() => ({ dispose: vi.fn(), loseContext: vi.fn(), disconnect: vi.fn() }));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose = graphics.dispose;
    forceContextLoss = graphics.loseContext;
  } };
});

import { mountOriginalPalMesh, type PalMeshStatus } from "@/components/pal/originalPalMeshRenderer.mjs";
import { pubPalMascotModelSrc } from "@/lib/pubPalMascot";

const MODEL_URL = pubPalMascotModelSrc("robin")!;
const source = readFileSync(`public${MODEL_URL}`);
const bytes = new Uint8Array(source).buffer;
let surface: ReturnType<typeof mountOriginalPalMesh> | undefined;
let textureFails = false;
let fetchModel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  textureFails = false;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = graphics.disconnect; });
  vi.stubGlobal("createImageBitmap", vi.fn());
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:original-pal-texture");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement) {
    queueMicrotask(() => this.dispatchEvent(new Event(textureFails ? "error" : "load")));
  });
  fetchModel = vi.fn(async (url: string) => {
    if (url.startsWith("blob:")) throw new Error("Production connect-src refuses blob fetches");
    return { ok: true, arrayBuffer: async () => bytes };
  });
  vi.stubGlobal("fetch", fetchModel);
});

afterEach(() => {
  surface?.dispose();
  surface = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function mount() {
  const host = document.createElement("div");
  host.getBoundingClientRect = () => ({ width: 200, height: 200 } as DOMRect);
  document.body.append(host);
  const statuses: PalMeshStatus[] = [];
  surface = mountOriginalPalMesh(host, { modelUrl: MODEL_URL, onStatus: status => statuses.push(status) });
  return { host, statuses };
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
}

describe("the original mesh renderer", () => {
  it("loads its embedded texture as an image under the production blob-fetch restriction", async () => {
    const { host, statuses } = mount();
    await settle();
    expect(statuses).toContain("ready");
    expect(fetchModel.mock.calls.map(call => call[0])).toEqual([MODEL_URL]);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(host.querySelector("canvas")?.style.visibility).toBe("visible");
  });

  it("retains the portrait when a required texture fails instead of showing an untextured model", async () => {
    textureFails = true;
    const { host, statuses } = mount();
    await settle();
    expect(statuses).toContain("model-unavailable");
    expect(statuses).not.toContain("ready");
    expect(host.querySelector("canvas")).toBeNull();
  });

  it.each(["dispose", "deadline"] as const)("cancels a pending asset read on %s and ignores a late response", async (end) => {
    vi.useFakeTimers();
    let finish!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    const pending = new Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>(resolve => { finish = resolve; });
    fetchModel.mockImplementation(() => pending);
    const { host, statuses } = mount();
    const signal = (fetchModel.mock.calls[0]![1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);
    expect(statuses).toEqual(["loading"]);
    if (end === "deadline") {
      await vi.advanceTimersByTimeAsync(9_999);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(statuses).toEqual(["loading", "model-unavailable"]);
    } else {
      surface!.dispose();
      expect(statuses).toEqual(["loading"]);
    }
    expect(signal.aborted).toBe(true);
    expect(host.querySelector("canvas")).toBeNull();
    expect(graphics.disconnect).toHaveBeenCalledOnce();
    expect(graphics.dispose).toHaveBeenCalledOnce();
    expect(graphics.loseContext).toHaveBeenCalledOnce();
    const readBytes = vi.fn(async () => bytes);
    finish({ ok: true, arrayBuffer: readBytes });
    await vi.runAllTimersAsync();
    expect(statuses).not.toContain("ready");
    expect(host.querySelector("canvas")).toBeNull();
    expect(fetchModel).toHaveBeenCalledOnce();
    surface!.dispose();
    expect(graphics.dispose).toHaveBeenCalledOnce();
  });

  it("releases decoded geometry, materials and textures when the portrait leaves", async () => {
    const geometryDisposed = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDisposed = vi.spyOn(THREE.Material.prototype, "dispose");
    const textureDisposed = vi.spyOn(THREE.Texture.prototype, "dispose");
    const { host, statuses } = mount();
    await settle();
    expect(statuses).toContain("ready");
    surface!.dispose();
    expect(geometryDisposed).toHaveBeenCalled();
    expect(materialDisposed).toHaveBeenCalled();
    expect(textureDisposed).toHaveBeenCalled();
    expect(graphics.disconnect).toHaveBeenCalledOnce();
    expect(graphics.dispose).toHaveBeenCalledOnce();
    expect(graphics.loseContext).toHaveBeenCalledOnce();
    expect(host.querySelector("canvas")).toBeNull();
    expect(surface!.renderPose({ yaw: 10, pitch: 0, roll: 0, lean: 0, lift: 0, scale: 1 }, performance.now())).toBe(false);
    expect(fetchModel).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
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
  textureFails = false;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
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
});

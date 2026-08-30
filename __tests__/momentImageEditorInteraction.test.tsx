// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MomentImageEditor from "@/components/moment/MomentImageEditor";

let container: HTMLDivElement;
let root: Root | null = null;
let resolveExport: ((blob: Blob | null) => void) | null = null;

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function mountEditor(): Promise<{
  frame: HTMLDivElement;
  image: HTMLImageElement;
  confirm: HTMLButtonElement;
}> {
  await act(async () => {
    root?.render(
      createElement(MomentImageEditor, {
        file: new File(["photo"], "night.jpg", { type: "image/jpeg" }),
        openerRef: { current: null },
        onSave: vi.fn(),
        onCancel: vi.fn(),
        onError: vi.fn(),
      }),
    );
  });
  await settle();

  const frame = container.querySelector<HTMLDivElement>(".profileCropFrame");
  const image = container.querySelector<HTMLImageElement>(".profileCropImage");
  const confirm = container.querySelector<HTMLButtonElement>(".profileCropConfirm");
  expect(frame).not.toBeNull();
  expect(image).not.toBeNull();
  expect(confirm).not.toBeNull();

  Object.defineProperty(frame!, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 250,
      right: 200,
      bottom: 250,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperties(frame!, {
    setPointerCapture: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
  });
  Object.defineProperty(image!, "naturalWidth", { configurable: true, value: 400 });
  Object.defineProperty(image!, "naturalHeight", { configurable: true, value: 300 });

  await act(async () => {
    image!.dispatchEvent(new Event("load"));
  });

  expect(confirm!.disabled).toBe(false);
  return { frame: frame!, image: image!, confirm: confirm! };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => "blob:moment-crop",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => ({
      drawImage: () => {},
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    writable: true,
    value: (callback: BlobCallback) => {
      resolveExport = callback;
    },
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (resolveExport) {
    const resolve = resolveExport;
    resolveExport = null;
    await act(async () => {
      resolve(new Blob(["cropped"], { type: "image/jpeg" }));
      await Promise.resolve();
    });
  }
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("MomentImageEditor crop export", () => {
  it("does not mutate crop position while local export is pending", async () => {
    const { frame, image, confirm } = await mountEditor();
    const before = image.style.transform;

    await act(async () => {
      confirm.click();
    });

    expect(confirm.disabled).toBe(true);
    await act(async () => {
      frame.dispatchEvent(pointerEvent("pointerdown", 1, 80, 100));
      frame.dispatchEvent(pointerEvent("pointermove", 1, 140, 160));
      frame.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(image.style.transform).toBe(before);
  });

  it("labels local export as preparation while it is pending", async () => {
    const { confirm } = await mountEditor();

    await act(async () => {
      confirm.click();
    });

    expect(confirm.textContent).toBe("Preparing…");
  });
});

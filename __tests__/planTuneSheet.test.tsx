/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlanTuneSheet from "@/components/plan/PlanTuneSheet";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

function pointer(type: string, target: EventTarget, clientY: number, timeStamp?: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
    ...(timeStamp === undefined ? {} : { timeStamp: { value: timeStamp } }),
  });
  target.dispatchEvent(event);
}

/** A phone by default; `dialog` is the desktop width, `reduce` lands springs at once. */
function media(options: { dialog?: boolean; reduce?: boolean } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? Boolean(options.dialog) : query.includes("reduce") ? Boolean(options.reduce) : false,
    media: query,
  }));
}

async function openSheet(onClose = vi.fn()) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.setPointerCapture ??= () => undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = (open: boolean) => root!.render(
    <PlanTuneSheet open={open} title="Tune details" onClose={() => { onClose(); render(false); }}>
      <p>Body</p>
    </PlanTuneSheet>,
  );
  await act(async () => render(true));
  return { render, onClose };
}

const sheet = () => document.querySelector<HTMLElement>(".planTune__sheet");
const title = () => document.querySelector<HTMLElement>(".planTune__header h2")!;
const grab = () => document.querySelector<HTMLButtonElement>(".planTune__grab")!;
const offset = () => Number(/translate3d\(0, (-?[\d.]+)px/.exec(sheet()!.style.transform)?.[1] ?? 0);

describe("PlanTuneSheet", () => {
  it("drops a drag that was in hand when the sheet closed", async () => {
    media();
    const { render } = await openSheet();
    await act(async () => {
      pointer("pointerdown", title(), 100);
      pointer("pointermove", title(), 160);
    });
    expect(sheet()!.dataset.dragging).toBe("true");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(sheet()).toBeNull();

    await act(async () => render(true));
    await act(async () => {
      pointer("pointermove", title(), 220);
    });
    expect(sheet()!.style.transform).toBe("");
    expect(sheet()!.dataset.dragging).toBeUndefined();
  });

  it("drags from the grab handle, and a tap on it still changes the detent", async () => {
    media();
    await openSheet();
    await act(async () => {
      pointer("pointerdown", grab(), 100);
      pointer("pointermove", grab(), 102);
    });
    expect(sheet()!.style.transform).toBe("");
    await act(async () => {
      pointer("pointermove", grab(), 150);
    });
    expect(offset()).toBe(50);
    await act(async () => {
      pointer("pointerup", grab(), 150);
    });

    expect(grab().getAttribute("aria-label")).toBe("Show more");
    await act(async () => {
      pointer("pointerdown", grab(), 100);
      pointer("pointerup", grab(), 100);
      grab().click();
    });
    expect(grab().getAttribute("aria-label")).toBe("Show less");
  });

  it("does not drag the centred dialog at desktop width", async () => {
    media({ dialog: true });
    const { onClose } = await openSheet();
    await act(async () => {
      pointer("pointerdown", title(), 100, 0);
      pointer("pointermove", title(), 400, 10);
      pointer("pointerup", title(), 400, 20);
    });
    expect(sheet()!.style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes the sheet from where it is when it is caught mid-spring", async () => {
    media();
    await openSheet();
    await act(async () => {
      pointer("pointerdown", title(), 100, 0);
      pointer("pointermove", title(), 190, 500);
      pointer("pointerup", title(), 190, 1000);
    });
    expect(offset()).toBe(90);
    await act(async () => {
      pointer("pointerdown", title(), 300, 1010);
      pointer("pointermove", title(), 310, 1020);
    });
    expect(offset()).toBe(100);
  });

  it("calls off a flick-dismiss that is caught, and the sheet stays open", async () => {
    media();
    const { onClose } = await openSheet();
    await act(async () => {
      pointer("pointerdown", title(), 100, 0);
      pointer("pointermove", title(), 230, 10);
      pointer("pointerup", title(), 230, 20);
    });
    expect(document.querySelector(".planTune")!.getAttribute("data-closing")).toBe("true");
    await act(async () => {
      pointer("pointerdown", title(), 300, 30);
      pointer("pointerup", title(), 300, 40);
    });
    expect(document.querySelector(".planTune")!.getAttribute("data-closing")).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    expect(sheet()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not dismiss a sheet that was pulled quickly and then held still", async () => {
    media({ reduce: true });
    const { onClose } = await openSheet();
    await act(async () => {
      pointer("pointerdown", title(), 100, 0);
      pointer("pointermove", title(), 140, 10);
      pointer("pointermove", title(), 180, 20);
      pointer("pointerup", title(), 180, 1000);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet()).not.toBeNull();
  });
});

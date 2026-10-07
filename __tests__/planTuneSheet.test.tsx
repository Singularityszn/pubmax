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

function pointer(type: string, target: EventTarget, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "mouse" } });
  target.dispatchEvent(event);
}

describe("PlanTuneSheet", () => {
  it("drops a drag that was in hand when the sheet closed", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    Element.prototype.setPointerCapture ??= () => undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = (open: boolean) => root!.render(
      <PlanTuneSheet open={open} title="Tune details" onClose={() => render(false)}>
        <p>Body</p>
      </PlanTuneSheet>,
    );
    await act(async () => render(true));
    const title = () => document.querySelector<HTMLElement>(".planTune__header h2")!;
    await act(async () => {
      pointer("pointerdown", title(), 100);
      pointer("pointermove", title(), 160);
    });
    expect(document.querySelector<HTMLElement>(".planTune__sheet")!.dataset.dragging).toBe("true");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector(".planTune__sheet")).toBeNull();

    await act(async () => render(true));
    await act(async () => {
      pointer("pointermove", title(), 220);
    });
    const sheet = document.querySelector<HTMLElement>(".planTune__sheet")!;
    expect(sheet.style.transform).toBe("");
    expect(sheet.dataset.dragging).toBeUndefined();
  });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import SunChaserPanel from "@/components/map/sunChaser/SunChaserPanel";
import { setSunChaserEnabled } from "@/components/map/sunChaser/sunChaserStore";

const scrubbing = () => document.documentElement.hasAttribute("data-sun-scrubbing");

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    setSunChaserEnabled(true);
    root.render(createElement(SunChaserPanel));
  });
  const slider = host.querySelector('input[type="range"]') as HTMLInputElement;
  const fire = (type: string) => act(() => {
    slider.dispatchEvent(new Event(type, { bubbles: true }));
  });
  return { root, host, slider, fire };
}

describe("the phone map shows while the slider is held", () => {
  afterEach(() => {
    act(() => setSunChaserEnabled(false));
    document.documentElement.removeAttribute("data-sun-scrubbing");
    document.body.innerHTML = "";
  });

  it("marks the page while a pointer holds the slider, and clears it when the pointer lifts", () => {
    const { root, fire } = mount();
    expect(scrubbing()).toBe(false);
    fire("pointerdown");
    expect(scrubbing()).toBe(true);
    fire("pointerup");
    expect(scrubbing()).toBe(false);
    act(() => root.unmount());
  });

  it("clears the mark when the pointer is cancelled or loses the slider", () => {
    const { root, fire } = mount();
    fire("pointerdown");
    fire("pointercancel");
    expect(scrubbing()).toBe(false);
    fire("pointerdown");
    fire("lostpointercapture");
    expect(scrubbing()).toBe(false);
    act(() => root.unmount());
  });

  it("never leaves the sheet hidden when the panel closes mid-drag", () => {
    const { root, fire } = mount();
    fire("pointerdown");
    expect(scrubbing()).toBe(true);
    act(() => root.unmount());
    expect(scrubbing()).toBe(false);
  });
});

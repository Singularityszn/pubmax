// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useSheetHeightDrag } from "@/components/mobile/useSheetHeightDrag";

it.each(["scroll", "repeated-scroll", "explicit-settle", "set-snap", "open-snap"] as const)(
  "keeps the requested outcome during dismissal: %s",
  (mode) => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));

    function Probe() {
      const [dismissals, setDismissals] = useState(0);
      const sheet = useSheetHeightDrag(() => setDismissals((count) => count + 1));
      function reopen() {
        if (mode === "explicit-settle") sheet.settleToRest("full");
        if (mode === "set-snap") sheet.setSheetSnap("full");
        if (mode === "open-snap") sheet.openAtSnap("full");
      }
      return (
        <div onScrollCapture={() => sheet.settleToRest()}>
          <output aria-label="Sheet state">{sheet.sheetSnap}</output>
          <output aria-label="Sheet height">{sheet.sheetHeight}</output>
          <output aria-label="Dismissals">{dismissals}</output>
          <button onClick={() => sheet.openAtSnap("half")}>Open</button>
          <button onClick={() => sheet.requestDismiss(sheet.sheetHeight)}>Close</button>
          <button onClick={reopen}>Request full</button>
          <section />
        </div>
      );
    }
    const read = (name: string) => host.querySelector(`output[aria-label="${name}"]`)!.textContent;
    const click = (index: number) => act(() => host.querySelectorAll("button")[index]!.click());
    const scroll = () => act(() => host.querySelector("section")!.dispatchEvent(new Event("scroll")));
    const frame = (timestamp: number) => act(() => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(timestamp);
    });

    try {
      act(() => root.render(<Probe />));
      click(0);
      const openingHeight = Number(read("Sheet height"));
      click(1);
      frame(0);
      frame(16);
      expect(Number(read("Sheet height"))).toBeLessThan(openingHeight);
      const reopening = !["scroll", "repeated-scroll"].includes(mode);
      if (reopening) click(2);
      scroll();
      if (mode === "repeated-scroll") {
        frame(32);
        scroll();
        frame(48);
        scroll();
      }
      frame(5_000);
      frame(10_000);
      frame(15_000);
      expect(read("Dismissals")).toBe(reopening ? "0" : "1");
      expect(read("Sheet state")).toBe(reopening ? "full" : "half");
      if (!reopening) expect(read("Sheet height")).toBe("0");
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  },
);

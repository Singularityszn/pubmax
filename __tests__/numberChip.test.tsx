/** @vitest-environment jsdom */

import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { NumberChip, type NumberChipProps } from "@/components/ui/numberChip";
import PlanStopCountPicker from "@/components/plan/PlanStopCountPicker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("the closed number chip", () => {
  it("forwards the actual button ref, type, chosen state and click", async () => {
    expectTypeOf<NumberChipProps>().not.toHaveProperty("className");
    expectTypeOf<NumberChipProps>().not.toHaveProperty("variant");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    try {
      await act(async () => root.render(createElement(NumberChip, {
        ref, type: "submit", "aria-pressed": true, "aria-label": "Three pubs", onClick,
      }, "3")));
      expect(ref.current).toBe(host.querySelector("button"));
      expect(ref.current?.type).toBe("submit");
      expect(ref.current?.className).toBe("uiChip uiChip--number");
      expect(ref.current?.getAttribute("aria-pressed")).toBe("true");
      expect(ref.current?.getAttribute("aria-label")).toBe("Three pubs");
      ref.current?.focus();
      expect(document.activeElement).toBe(ref.current);
      await act(async () => ref.current?.click());
      expect(onClick).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("protects count changes until the existing picker is ready", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    try {
      await act(async () => root.render(createElement(PlanStopCountPicker, { value: 3, ready: false, onChange })));
      const five = [...host.querySelectorAll("button")].find((button) => button.textContent === "5")!;
      expect(five.getAttribute("aria-disabled")).toBe("true");
      await act(async () => five.click());
      expect(onChange).not.toHaveBeenCalled();
      await act(async () => root.render(createElement(PlanStopCountPicker, { value: 3, ready: true, onChange })));
      expect(five.hasAttribute("aria-disabled")).toBe(false);
      await act(async () => five.click());
      expect(onChange).toHaveBeenCalledExactlyOnceWith(5);
      expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("3");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

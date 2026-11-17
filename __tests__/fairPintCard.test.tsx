// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import FairPintCard from "@/components/map/fairpint/FairPintCard";
import { FAIR_PINT_KEY, readFairPint, writeFairPint } from "@/lib/fairPint";
import { appliedPintPriceCap, pintPriceCapsFor } from "@/lib/pintPriceCaps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("keeps a drag local, commits exact pence once on release, and abandons cancelled input", () => {
  localStorage.clear();
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  let releases = 0, pounds = 0;
  const props = { start: 550, area: "Soho", counts: () => ({ phase: "ready" as const, count: 4 }), drawCounts: () => ({ phase: "ready" as const, count: 4 }), located: false, locationOff: false, offline: false, onInput: () => {}, onCommit: (pence: number) => { releases++; writeFairPint(pence); pounds = appliedPintPriceCap(pence / 100); }, onLocation: () => {}, onRetry: () => {}, onDraw: () => {}, onClose: () => {} };
  act(() => root.render(createElement(FairPintCard, props)));
  const slider = host.querySelector("input")!;
  act(() => { slider.value = "530"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector("output")?.textContent).toBe("£5.30");
  expect(localStorage.getItem(FAIR_PINT_KEY)).toBeNull();
  act(() => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(readFairPint()).toBe(530);
  expect(pounds).toBe(5.3);
  expect(pintPriceCapsFor(pounds).find((cap) => cap.kind === "custom")?.shortLabel).toBe("£5.30");
  act(() => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(releases).toBe(1);
  act(() => { slider.value = "600"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => slider.dispatchEvent(new Event("pointercancel", { bubbles: true })));
  expect(readFairPint()).toBe(530);
  expect(slider.value).toBe("530");
  act(() => root.unmount()); host.remove(); localStorage.clear();
});

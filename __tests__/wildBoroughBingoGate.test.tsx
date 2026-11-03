// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const switches = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/useWildNightPreview", () => ({ useWildNightPreview: () => switches.enabled }));
vi.mock("next/dynamic", () => ({ default: () => () => createElement("div", { "data-card": "" }, "Card") }));
import BoroughBingoGate from "@/components/wild/BoroughBingoGate";

afterEach(() => { switches.enabled = false; });

it("does not mount the card when the preview is off", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(BoroughBingoGate, { been: [] })));
  expect(host.querySelector("[data-card]")).toBeNull();
  switches.enabled = true;
  act(() => root.render(createElement(BoroughBingoGate, { been: [] })));
  expect(host.querySelector("[data-card]")).not.toBeNull();
  switches.enabled = false;
  act(() => root.render(createElement(BoroughBingoGate, { been: [] })));
  expect(host.querySelector("[data-card]")).toBeNull();
  act(() => root.unmount());
});

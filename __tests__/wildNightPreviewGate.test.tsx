// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => createElement("span", { "data-picker": "" }, "Picker"),
}));
vi.mock("@/components/nav/SiteNavMore", () => ({
  default: () => createElement("span", { "data-more": "" }, "More"),
}));

import WildNightPreviewGate from "@/components/wild/WildNightPreviewGate";
import { writeWildMode } from "@/lib/wildMode";

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("mounts the picker only when the wild master is on", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(WildNightPreviewGate)));
  expect(host.querySelector("[data-more]")).not.toBeNull();
  expect(host.querySelector("[data-picker]")).toBeNull();
  act(() => writeWildMode(true));
  expect(host.querySelector("[data-picker]")).not.toBeNull();
  act(() => writeWildMode(false));
  expect(host.querySelector("[data-picker]")).toBeNull();
  act(() => root.unmount());
});

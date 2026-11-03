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

import WildNightPreviewGate, { MobileWildNightPreviewGate } from "@/components/wild/WildNightPreviewGate";
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

it.each([WildNightPreviewGate, MobileWildNightPreviewGate])("adopts an off link when Next changes the query while %s stays mounted", async (Gate) => {
  const { SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { useWildNightPreview } = await import("@/lib/useWildNightPreview");
  const { readWildNightPreview, writeWildNightPreview } = await import("@/lib/wildNightPreview");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeWildMode(true);
  writeWildNightPreview("borough-bingo");
  const host = document.createElement("div");
  const root = createRoot(host);
  function Preview() { return useWildNightPreview("borough-bingo") ? createElement("div", { "data-preview": "" }) : null; }
  function tree(query: string) {
    return createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, createElement(Gate), createElement(Preview));
  }
  act(() => root.render(tree("")));
  expect(host.querySelector("[data-preview]")).not.toBeNull();
  act(() => {
    window.history.pushState({ retained: true }, "", "/today?keep=1&wildpreview=off#top");
    root.render(tree("keep=1&wildpreview=off"));
  });
  expect(host.querySelector("[data-preview]")).toBeNull();
  expect(readWildNightPreview()).toBeNull();
  expect(window.location.search + window.location.hash).toBe("?keep=1#top");
  expect(window.history.state).toEqual({ retained: true });
  act(() => root.unmount());
});

it.each([WildNightPreviewGate, MobileWildNightPreviewGate])("applies a query-only master-off link through %s before showing a preview", async (Gate) => {
  const { SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { useWildNightPreview } = await import("@/lib/useWildNightPreview");
  const { writeWildNightPreview } = await import("@/lib/wildNightPreview");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeWildMode(true);
  writeWildNightPreview("borough-bingo");
  const host = document.createElement("div");
  const root = createRoot(host);
  function Preview() { return useWildNightPreview("borough-bingo") ? createElement("div", { "data-preview": "" }) : null; }
  function tree(query: string) {
    return createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, createElement(Gate), createElement(Preview));
  }
  act(() => root.render(tree("")));
  expect(host.querySelector("[data-preview]")).not.toBeNull();
  act(() => {
    window.history.pushState(null, "", "/today?wild=0&keep=1");
    root.render(tree("wild=0&keep=1"));
  });
  expect(host.querySelector("[data-preview]")).toBeNull();
  expect(window.location.search).toBe("?keep=1");
  act(() => root.unmount());
});

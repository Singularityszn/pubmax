// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNavMore", () => ({
  default: () => null,
  siteNavMoreItems: () => [],
}));

import { MobileWildNightPreviewPicker } from "@/components/wild/WildNightPreviewPicker";
import { readWildNightPreview } from "@/lib/wildNightPreview";

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("lets a phone user select a preview and turn previews off", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(MobileWildNightPreviewPicker)));
  const select = host.querySelector("select");
  expect(select).not.toBeNull();
  expect(host.querySelector("label")?.htmlFor).toBe(select?.id);
  expect(select?.value).toBe("off");
  expect(Array.from(select!.options).map((option) => option.text)).toEqual([
    "Previews off", "Round Rota", "Borough Bingo", "Pub Tarot",
  ]);
  act(() => {
    select!.value = "borough-bingo";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(readWildNightPreview()).toBe("borough-bingo");
  act(() => {
    select!.value = "off";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(readWildNightPreview()).toBeNull();
  act(() => root.unmount());
});

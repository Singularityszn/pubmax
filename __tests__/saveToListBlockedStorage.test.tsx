// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SaveToListControl from "@/components/savedpubs/SaveToListControl";

// The venue inspector renders SaveToListControl on every pin tap, and its
// handle is read in a useState initializer. With site data blocked the
// `window.localStorage` getter itself throws SecurityError, which must cost
// the viewer their stored handle, not the map.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("site data is blocked", "SecurityError");
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("SaveToListControl when the browser refuses site data", () => {
  it("renders the save toggle instead of throwing out of render", () => {
    act(() => {
      root.render(createElement(SaveToListControl, { venueId: "venue-1", venueName: "The Lamb" }));
    });

    const toggle = container.querySelector("button.saveToListToggle");
    expect(toggle?.textContent).toBe("Save The Lamb to a list");
  });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lastRideClient", () => ({
  loadLastRide: () => new Promise(() => {}),
  loadStableLastRide: () => null,
}));

import LastTrainCard from "@/components/map/LastTrainCard";

// The Getting home fold renders LastTrainCard, which reads the saved
// destination in a useState initializer. With site data blocked the
// `window.sessionStorage` getter itself throws SecurityError, which must cost
// the viewer their session destination, not the map.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
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

describe("LastTrainCard when the browser refuses site data", () => {
  it("renders and keeps a destination for the session view", () => {
    act(() => {
      root.render(
        createElement(LastTrainCard, { lat: 51.52, lng: -0.11, venueName: "The Lamb" }),
      );
    });

    const input = container.querySelector<HTMLInputElement>("input[name=destination]");
    expect(input).not.toBeNull();

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "  Brixton  ");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("Heading to Brixton");
  });
});

// @vitest-environment jsdom

// A TAPPED PIN'S SHEET SHOWS ITS PRICE BEFORE THE PANEL'S CHUNK LANDS.
//
// On a throttled phone the venue panel's chunk crossed the wire behind the
// basemap tiles and landed 11.9 s after the tap. The map has already read the
// price row (VenueActionSummary), so the sheet's footer shows it at once, and
// the pub's own price read starts with the sheet, not with the chunk.

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LazyVenueInspector from "@/components/map/LazyVenueInspector";
import { SheetFooterContext } from "@/components/mobile/sheetFooterContext";

// The chunk never lands in this suite: every assertion reads the wait.
vi.mock("@/components/map/VenueInspector", () => new Promise(() => {}));

type Props = ComponentProps<typeof LazyVenueInspector>;

let container: HTMLDivElement;
let footer: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  footer = document.createElement("div");
  document.body.append(container, footer);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  footer.remove();
});

const loadVenue = vi.fn();

function mount(slot: HTMLElement | null) {
  const props = {
    venue: { id: "venue-10getjx", name: "Newmarket Ale House" },
    communityPrices: { loadVenue },
    actionSummary: createElement("div", { className: "mobileVenuePeekFrame" }, "est. £5.75 · estimate"),
  } as unknown as Props;
  act(() => {
    root.render(
      createElement(SheetFooterContext.Provider, { value: slot }, createElement(LazyVenueInspector, props)),
    );
  });
}

describe("the venue sheet while its chunk is out", () => {
  it("shows the pin's price row in the footer, in the card's frame", () => {
    mount(footer);
    const card = footer.querySelector(".venueActionCard");
    expect(card?.textContent).toBe("est. £5.75 · estimate");
    expect(card?.getAttribute("aria-label")).toBe("Newmarket Ale House, price and actions");
    expect(container.querySelector(".venueSheetSkeleton")).not.toBeNull();
  });

  it("starts the pub's price read without waiting for the chunk", () => {
    mount(footer);
    expect(loadVenue).toHaveBeenCalledWith("venue-10getjx");
  });

  it("keeps the skeleton alone where the sheet has no footer", () => {
    mount(null);
    expect(container.querySelector(".venueActionCard")).toBeNull();
    expect(container.querySelector(".venueSheetSkeleton")).not.toBeNull();
  });
});

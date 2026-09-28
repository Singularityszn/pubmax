// @vitest-environment jsdom

import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapVenueList from "@/components/map/MapVenueList";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import type { MapVenueListModel, UkBasePubListModel } from "@/lib/mapVenueList";

// One Escape closes the TOP level. The desktop venue list stays open under the
// venue drawer it opened, and the drawer's focus trap makes the list inert
// (lib/useFocusTrap.ts). The list used to claim that Escape anyway, so it
// closed out of sight and the drawer stayed up (e2e/map-accessibility.spec.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Panel({ onDismiss }: { onDismiss: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  useDismissOnEscape(true, onDismiss, panelRef);
  return <section ref={panelRef} />;
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useDismissOnEscape under a modal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("closes an open panel and claims the key", () => {
    const onDismiss = vi.fn();
    act(() => root.render(<Panel onDismiss={onDismiss} />));

    const event = pressEscape();

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the key to the modal when the panel sits in an inert subtree", () => {
    const onDismiss = vi.fn();
    act(() => root.render(<Panel onDismiss={onDismiss} />));
    host.setAttribute("inert", "");

    const event = pressEscape();

    expect(onDismiss).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves the key when an ancestor is inert via the IDL property", () => {
    const onDismiss = vi.fn();
    act(() => root.render(<Panel onDismiss={onDismiss} />));
    host.inert = true;

    const event = pressEscape();

    expect(onDismiss).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("MapVenueList does not dismiss while inert under the venue drawer", () => {
    const onOpenChange = vi.fn();
    const emptyBase: UkBasePubListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
    };
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };

    act(() =>
      root.render(
        createElement(MapVenueList, {
          model: curated,
          ukBaseModel: emptyBase,
          cityName: "London",
          open: true,
          onOpenChange,
          loaded: true,
          onSelectVenue: () => {},
          onSelectUkBasePub: () => {},
          onPrefetchVenue: () => {},
        }),
      ),
    );

    host.inert = true;

    const event = pressEscape();

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

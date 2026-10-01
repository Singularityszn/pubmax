// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";

function Harness({ venueId, storyOpen = false, onBack, pickerOpen = false, onDismissPicker = () => {} }: {
  venueId: string;
  storyOpen?: boolean;
  onBack: () => void;
  pickerOpen?: boolean;
  onDismissPicker?: () => void;
}) {
  const args = {
    mobileViewport: false,
    planningOpen: false,
    selectedVenueId: venueId,
    storyOpen,
    onBack,
    onInterruptReveal: () => {},
    logIntentFallbackVisible: pickerOpen,
    dismissLogIntent: onDismissPicker,
  };
  useMapKeyboardShortcuts(args);
  return null;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flushBackDecision() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Map Escape shortcut", () => {
  it("keeps one listener through rerenders while using the latest Back owner", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const firstBack = vi.fn();
    const nextBack = vi.fn();

    try {
      await act(async () => root.render(<Harness venueId="venue-a" onBack={firstBack} />));
      const initialKeyListeners = addListener.mock.calls.filter(([event]) => event === "keydown").length;
      expect(initialKeyListeners).toBe(1);

      await act(async () => root.render(<Harness venueId="venue-b" onBack={nextBack} />));
      expect(addListener.mock.calls.filter(([event]) => event === "keydown")).toHaveLength(1);
      expect(removeListener.mock.calls.filter(([event]) => event === "keydown")).toHaveLength(0);

      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      await flushBackDecision();
      expect(firstBack).not.toHaveBeenCalled();
      expect(nextBack).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("leaves a visible phone sheet as the single Escape owner", async () => {
    const host = document.createElement("div");
    const portal = document.createElement("div");
    portal.className = "mobileSheetPortal";
    portal.style.display = "block";
    document.body.append(host, portal);
    const root = createRoot(host);
    const mapBack = vi.fn();
    const sheetBack = vi.fn();
    const dismissPicker = vi.fn();
    const onSheetKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented &&
        window.getComputedStyle(portal).display !== "none") {
        event.preventDefault();
        sheetBack();
      }
    };

    try {
      await act(async () => root.render(<Harness venueId="venue-a" onBack={mapBack} />));
      // Sheet opens after PubMap's stable shortcut listener is already attached.
      window.addEventListener("keydown", onSheetKey);
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      })));
      await flushBackDecision();
      expect(sheetBack).toHaveBeenCalledOnce();
      expect(mapBack).not.toHaveBeenCalled();

      await act(async () => root.render(<Harness venueId="venue-a" onBack={mapBack}
        pickerOpen onDismissPicker={dismissPicker} />));
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      })));
      await flushBackDecision();
      expect(dismissPicker).toHaveBeenCalledOnce();
      expect(sheetBack).toHaveBeenCalledOnce();
      expect(mapBack).not.toHaveBeenCalled();

      portal.style.display = "none";
      await act(async () => root.render(<Harness venueId="venue-a" onBack={mapBack} />));
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      })));
      await flushBackDecision();
      expect(mapBack).toHaveBeenCalledOnce();
      expect(sheetBack).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", onSheetKey);
      await act(async () => root.unmount());
      portal.remove();
      host.remove();
    }
  });

  it("lets a later window popover claim Escape before Map Back", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const mapBack = vi.fn();
    const closePopover = vi.fn();
    const onPopoverKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePopover();
    };

    try {
      await act(async () => root.render(<Harness venueId="venue-a" onBack={mapBack} />));
      vi.useFakeTimers();
      window.addEventListener("keydown", onPopoverKey);
      act(() => window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      })));
      expect(closePopover).toHaveBeenCalledOnce();
      expect(mapBack).not.toHaveBeenCalled();
      act(() => vi.runAllTimers());
      expect(mapBack).not.toHaveBeenCalled();

      window.removeEventListener("keydown", onPopoverKey);
      act(() => window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      })));
      act(() => vi.runAllTimers());
      expect(mapBack).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", onPopoverKey);
      vi.useRealTimers();
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("uses the current Back owner after dispatch and drops queued work on unmount", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const firstBack = vi.fn();
    const nextBack = vi.fn();

    try {
      await act(async () => root.render(<Harness venueId="venue-a" onBack={firstBack} />));
      vi.useFakeTimers();
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        root.render(<Harness venueId="venue-b" onBack={nextBack} />);
      });
      act(() => vi.runAllTimers());
      expect(firstBack).not.toHaveBeenCalled();
      expect(nextBack).toHaveBeenCalledOnce();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        root.unmount();
      });
      act(() => vi.runAllTimers());
      expect(nextBack).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      host.remove();
    }
  });

  it("steps Back from a landmark story without a selected venue", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const mapBack = vi.fn();

    try {
      await act(async () => root.render(<Harness venueId="" storyOpen onBack={mapBack} />));
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      })));
      await flushBackDecision();
      expect(mapBack).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

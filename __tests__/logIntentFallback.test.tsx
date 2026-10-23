// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LogIntentFallback } from "@/components/map/pubmap/LogIntentFallback";

describe("price contribution pub picker", () => {
  it("asks for location only when the reader chooses Near me", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const locate = vi.fn();
    try {
      await act(async () => root.render(createElement(LogIntentFallback, {
        candidates: [], origin: null, filteredPubVenueCount: 1,
        onPickVenue: vi.fn(), onPrefetchVenue: vi.fn(), onFocusSearch: vi.fn(),
        onResetFilters: vi.fn(), onUseMyLocation: locate,
      })));
      expect(locate).not.toHaveBeenCalled();
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Near me");
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(locate).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

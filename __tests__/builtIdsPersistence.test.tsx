// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBuiltIdsPersistence } from "@/components/map/pubmap/useBuiltIdsPersistence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

afterEach(() => {
  if (storageDescriptor) Object.defineProperty(window, "localStorage", storageDescriptor);
  vi.restoreAllMocks();
});

function BuiltIdsPersistenceProbe({ ids }: { ids: string[] }) {
  useBuiltIdsPersistence(ids, "audit-built");
  return createElement("output", null, ids.join(","));
}

it.each([{ ids: [] }, { ids: ["venue-a"] }])(
  "keeps rendered built IDs mounted when storage access is denied: %j",
  async ({ ids }) => {
    const readStorage = vi.fn(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: readStorage,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await expect(
        act(async () => {
          root.render(createElement(BuiltIdsPersistenceProbe, { ids }));
        }),
      ).resolves.toBeUndefined();
      expect(readStorage).toHaveBeenCalledOnce();
      expect(container.textContent).toBe(ids.join(","));
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it("keeps rendered built IDs mounted when storage quota is exhausted", async () => {
  const setItem = vi.fn(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      setItem,
    },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await expect(
      act(async () => {
        root.render(createElement(BuiltIdsPersistenceProbe, { ids: ["venue-a"] }));
      }),
    ).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalledWith("audit-built", '["venue-a"]');
    expect(container.textContent).toBe("venue-a");
  } finally {
    await act(async () => root.unmount());
  }
});

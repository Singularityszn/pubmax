import { describe, expect, it, vi } from "vitest";

import {
  hasNightModeOpenRequest,
  holdNightModeOpenRequest,
  requestNightModeOpen,
  takeNightModeOpenRequest,
} from "@/lib/nightCrawlEngage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

describe("Night Mode open handoff", () => {
  it("holds a request until the matching plan surface mounts", () => {
    const storage = memoryStorage();

    holdNightModeOpenRequest(storage, "plan-a");

    expect(hasNightModeOpenRequest(storage, "plan-a")).toBe(true);
    expect(takeNightModeOpenRequest(storage, "plan-b")).toBe(false);
    expect(takeNightModeOpenRequest(storage, "plan-a")).toBe(true);
    expect(takeNightModeOpenRequest(storage, "plan-a")).toBe(false);
  });

  it("fails soft when browser storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    expect(() => holdNightModeOpenRequest(storage, "plan-a")).not.toThrow();
    expect(hasNightModeOpenRequest(storage, "plan-a")).toBe(false);
    expect(takeNightModeOpenRequest(storage, "plan-a")).toBe(false);
  });

  it("still dispatches when reading browser session storage throws", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent,
      get sessionStorage() {
        throw new Error("blocked");
      },
    });

    expect(() => requestNightModeOpen("plan-a")).not.toThrow();
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
});

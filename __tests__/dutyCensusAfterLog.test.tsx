// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DutyCensusAfterLog from "@/components/census/DutyCensusAfterLog";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const RISE = Date.parse("2027-02-01T00:00:00Z");
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-31T22:58:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSurfaceCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearSurfaceCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(createElement(DutyCensusAfterLog));
  });
}

describe("the mounted census receipt at the 1 February cutoff", () => {
  it.each([12, null, "failed"] as const)("removes the prompt at midnight after a %s read", async (count) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      count === "failed"
        ? new Response(null, { status: 400 })
        : Response.json({ count }),
    ));
    await mount();
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.querySelector(".dutyCensusFigure")?.textContent).toBe(count === 12 ? "12" : undefined);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RISE - Date.now() - 1);
    });
    expect(container.querySelector("section")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector("section")).toBeNull();
  });

  it("does not display a count that arrives after the rise", async () => {
    vi.setSystemTime(RISE - 1000);
    let respond!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      respond = resolve;
    })));
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      respond(Response.json({ count: 12 }));
    });
    expect(container.querySelector("section")).toBeNull();
  });

  it("keeps the prompt open when the rise exceeds the browser timer limit", async () => {
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ count: 12 })));
    await mount();
    for (const interval of [2_147_483_647, 2_147_483_647, 2_147_483_647]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval);
      });
      expect(container.querySelector("section")).not.toBeNull();
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RISE - Date.now());
    });
    expect(container.querySelector("section")).toBeNull();
  });
});

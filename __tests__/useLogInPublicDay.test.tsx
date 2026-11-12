// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLogInPublicDay } from "@/lib/useLogInPublicDay";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function DaySection() {
  const day = useLogInPublicDay();
  return day ? createElement("section", null, day) : null;
}

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.useRealTimers();
});

async function renderAt(time: string) {
  vi.setSystemTime(new Date(time));
  root = createRoot(host);
  await act(async () => root?.render(createElement(DaySection)));
}

describe("the mounted launch-day section", () => {
  it("appears at launch-day midnight and disappears at the next midnight", async () => {
    await renderAt("2026-11-16T23:59:59.999Z");
    expect(host.querySelector("section")).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.textContent).toBe("2026-11-17");
    await act(async () => vi.advanceTimersByTime(86_400_000));
    expect(host.querySelector("section")).toBeNull();
  });

  it.each(["visibilitychange", "pageshow"])("refreshes a suspended page on %s", async (event) => {
    await renderAt("2026-11-16T12:00:00Z");
    const target = event === "visibilitychange" ? document : window;
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    await act(async () => target.dispatchEvent(new Event(event)));
    expect(host.textContent).toBe("2026-11-17");
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
    await act(async () => target.dispatchEvent(new Event(event)));
    expect(host.querySelector("section")).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root?.unmount());
    root = undefined;
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => target.dispatchEvent(new Event(event)));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hydrates cached markup on launch day without a mismatch", async () => {
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    host.innerHTML = renderToString(createElement(DaySection));
    expect(host.querySelector("section")).toBeNull();
    const onRecoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(host, createElement(DaySection), { onRecoverableError });
    });
    expect(host.textContent).toBe("2026-11-17");
    expect(onRecoverableError).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActiveRoundChip from "@/components/map/ActiveRoundChip";
import { readActiveRoundCode, writeActiveRoundCode } from "@/lib/activeRound";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const fetchRound = vi.fn<typeof fetch>();
let root: Root;
let host: HTMLDivElement;

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(ActiveRoundChip));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchRound);
  fetchRound.mockReset().mockImplementation(async () => Response.json({ round: { closedAt: null } }));
  window.localStorage.clear();
  setVisibility("visible");
  writeActiveRoundCode("JXKQ7M");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Active Round chip polling", () => {
  it("keeps the new Round when an old 404 response and a switch share one batch", async () => {
    let finish!: (response: Response) => void;
    fetchRound.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await mount();

    await act(async () => {
      finish(Response.json({}, { status: 404 }));
      writeActiveRoundCode("BCD234");
    });

    expect(host.querySelector("a")?.getAttribute("href")).toBe("/rounds/BCD234");
    expect(readActiveRoundCode()).toBe("BCD234");
  });

  it("keeps the new Round when an old closed body and a switch share one batch", async () => {
    let finishBody!: (body: unknown) => void;
    const response = Response.json({});
    vi.spyOn(response, "json").mockImplementationOnce(() => new Promise((resolve) => { finishBody = resolve; }));
    fetchRound.mockResolvedValueOnce(response);
    await mount();

    await act(async () => {
      finishBody({ round: { closedAt: "2026-10-26T10:00:00Z" } });
      writeActiveRoundCode("BCD234");
    });

    expect(host.querySelector("a")?.getAttribute("href")).toBe("/rounds/BCD234");
    expect(readActiveRoundCode()).toBe("BCD234");
  });

  it("waits until an initially hidden page becomes visible", async () => {
    setVisibility("hidden");
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchRound).not.toHaveBeenCalled();
    await act(async () => { setVisibility("visible"); });
    expect(fetchRound).toHaveBeenCalledTimes(1);
  });

  it("aborts the hidden request and starts a fresh read when the page returns", async () => {
    fetchRound.mockImplementation(() => new Promise<Response>(() => {}));
    await mount();
    const signal = fetchRound.mock.calls[0]?.[1]?.signal;
    await act(async () => { setVisibility("hidden"); });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      setVisibility("visible");
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchRound).toHaveBeenCalledTimes(2);
    expect(fetchRound.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
  });

  it("aborts the request and removes polling when the chip unmounts", async () => {
    fetchRound.mockImplementation(() => new Promise<Response>(() => {}));
    await mount();
    const signal = fetchRound.mock.calls[0]?.[1]?.signal;
    await act(async () => { root.render(null); });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      setVisibility("hidden");
      setVisibility("visible");
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchRound).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, {}],
    [200, { round: { closedAt: "2026-10-26T10:00:00Z" } }],
  ] as const)("removes the chip and stored code for a retired Round with status %s", async (status, body) => {
    fetchRound.mockResolvedValue(Response.json(body, { status }));
    await mount();
    expect(host.querySelector("a")).toBeNull();
    expect(readActiveRoundCode()).toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchRound).toHaveBeenCalledTimes(1);
  });

  it("keeps the Round after a failed read and retries on the next tick", async () => {
    fetchRound.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await mount();
    expect(host.textContent).toContain("JXKQ7M");
    expect(readActiveRoundCode()).toBe("JXKQ7M");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchRound).toHaveBeenCalledTimes(2);
  });

  it("retires the request and stops polling when the reader dismisses the chip", async () => {
    fetchRound.mockImplementation(() => new Promise<Response>(() => {}));
    await mount();
    const signal = fetchRound.mock.calls[0]?.[1]?.signal;
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button[aria-label='Dismiss Round chip']")!.click();
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.querySelector("a")).toBeNull();
    expect(fetchRound).toHaveBeenCalledTimes(1);
    expect(readActiveRoundCode()).toBe("JXKQ7M");
  });

  it("keeps the new Round visible when an old closed response body finishes later", async () => {
    let finishBody!: (chunk: Uint8Array) => void;
    fetchRound.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        finishBody = (chunk) => {
          controller.enqueue(chunk);
          controller.close();
        };
      },
    })));
    await mount();

    await act(async () => { writeActiveRoundCode("BCD234"); });
    expect(host.textContent).toContain("BCD234");

    await act(async () => {
      finishBody(new TextEncoder().encode(JSON.stringify({ round: { closedAt: "2026-10-26T10:00:00Z" } })));
    });
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/rounds/BCD234");
    expect(readActiveRoundCode()).toBe("BCD234");
  });

  it("keeps one request pending through focus events and polling ticks", async () => {
    let finish!: (response: Response) => void;
    fetchRound.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await mount();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(fetchRound).toHaveBeenCalledTimes(1);

    await act(async () => { finish(Response.json({ round: { closedAt: null } })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchRound).toHaveBeenCalledTimes(2);
  });

  it("makes no requests while hidden and refreshes when the reader returns", async () => {
    await mount();
    expect(host.textContent).toContain("JXKQ7M");
    expect(fetchRound).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(180_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchRound).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility("visible");
    });
    expect(fetchRound).toHaveBeenCalledTimes(2);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/rounds/JXKQ7M");
  });
});

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fetch = vi.hoisted(() => vi.fn<() => Promise<Response>>());
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: fetch }));

import MessageArrivalNotice from "@/components/messages/MessageArrivalNotice";

it("cancels an unread permission error body and keeps the arrival hidden", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let cancelled = false;
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { status: 503 }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(MessageArrivalNotice, {
      conversation: { id: "thread", otherHandle: "sam", lastBody: "Hello", lastAt: "2026-11-17T12:00:00Z", lastFromMe: false, unread: 1 },
      onDismiss: vi.fn(),
      inbox: true,
    })));
    expect(cancelled).toBe(true);
    expect(document.querySelector(".messageArrival")).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it.each([true, false])("reads the permission body and respects quiet=%s", async (quiet) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const response = Response.json({ quiet });
  fetch.mockResolvedValueOnce(response);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onDismiss = vi.fn();
  try {
    await act(async () => root.render(createElement(MessageArrivalNotice, {
      conversation: { id: "thread", otherHandle: "sam", lastAt: "2026-11-17T12:00:00Z", lastFromMe: false, unread: 1 },
      onDismiss,
      inbox: true,
    })));
    expect(response.bodyUsed).toBe(true);
    expect(document.querySelector(".messageArrival") !== null).toBe(!quiet);
    if (!quiet) {
      await act(async () => document.querySelector<HTMLButtonElement>(".messageArrival button")!.click());
      expect(onDismiss).toHaveBeenCalledOnce();
    }
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

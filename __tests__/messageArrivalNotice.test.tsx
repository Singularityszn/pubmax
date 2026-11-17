// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fetch = vi.hoisted(() => vi.fn<() => Promise<Response>>());
vi.mock("@/lib/authedFetch", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/authedFetch")>(), authedActionFetch: fetch }));

import MessageArrivalNotice from "@/components/messages/MessageArrivalNotice";
import { selectMessageArrival } from "@/lib/messageArrival";
import type { ConversationDTO } from "@/lib/messages";

const candidate: ConversationDTO = { id: "thread", otherHandle: "sam", lastBody: "Hello", lastAt: "2026-11-17T12:00:00Z", lastFromMe: false, unread: 1 };

async function renderAllowed(root: ReturnType<typeof createRoot>, onDismiss: () => void) {
  const conversation = await selectMessageArrival([candidate], new AbortController().signal, () => false);
  root.render(conversation ? createElement(MessageArrivalNotice, { conversation, onDismiss, inbox: true }) : null);
}

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
    await act(async () => renderAllowed(root, vi.fn()));
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
    await act(async () => renderAllowed(root, onDismiss));
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


it("continues to the next arrival after a policy body fails", async () => {
  const broken = Response.json({ quiet: false });
  vi.spyOn(broken, "json").mockRejectedValueOnce(new SyntaxError("Unreadable policy"));
  fetch.mockResolvedValueOnce(broken).mockResolvedValueOnce(Response.json({ quiet: false }));
  const next = { ...candidate, id: "next" };
  expect(await selectMessageArrival([candidate, next], new AbortController().signal, () => false)).toBe(next);
});

it("ignores late policy results after the caller leaves", async () => {
  let finish!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const selected = selectMessageArrival([candidate], controller.signal, () => false);
  controller.abort();
  expect(await selected).toBeNull();
  finish(Response.json({ quiet: false }));
});

it("rechecks the open thread after a policy response", async () => {
  let finish!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  let open = "";
  const selected = selectMessageArrival([candidate], new AbortController().signal, (row) => row.id === open);
  open = candidate.id;
  finish(Response.json({ quiet: false }));
  expect(await selected).toBeNull();
});

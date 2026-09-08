// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ accountRevision: 1, handle: "viewer" as string | null, signedOut: false, identityResolved: true }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ unresolved: false, signedOut: auth.signedOut }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/messages/ProfileMessageButton", () => ({ default: ({ targetHandle }: { targetHandle: string }) => <button>Message {targetHandle}</button> }));
import MessageRecipientSearch from "@/app/messages/MessageRecipientSearch";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.accountRevision = 1; auth.signedOut = false; auth.handle = "viewer"; auth.identityResolved = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function search() {
  await act(async () => root.render(<MessageRecipientSearch />));
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "sam");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
it("finds recipients, excludes the viewer, and reuses the message action", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [{ handle: "sam" }, { handle: "viewer" }] }) });
  vi.stubGlobal("fetch", fetcher);
  await search();
  expect(fetcher.mock.calls[0][0]).toBe("/api/profiles/search?q=sam");
  expect(host.textContent).toContain("Message sam");
  expect(host.textContent).not.toContain("Message viewer");
  expect(host.querySelector('a[href="/u/sam"]')!.textContent).toBe("@sam");
  auth.accountRevision = 2;
  await act(async () => root.render(<MessageRecipientSearch />));
  expect(host.textContent).not.toContain("Message sam");
  expect(host.querySelector("input")!.value).toBe("");
});
it("shows a recoverable search error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await search();
  expect(host.textContent).toContain("Could not search. Try again.");
  expect(host.querySelector('button[type="submit"]')).not.toBeNull();
});
it.each([429, 503])("releases an unread %s search body before another action", async (status) => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"error":"Unavailable"}'));
    },
    cancel,
  }), { status });
  const fetcher = vi.fn()
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce(new Response(JSON.stringify({ matches: [{ handle: "sam" }] })));
  vi.stubGlobal("fetch", fetcher);

  await search();
  expect(host.textContent).toContain("Could not search. Try again.");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(response.bodyUsed).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe("/api/profiles/search?q=sam");
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);

  await search();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Message sam");
  expect(host.textContent).not.toContain("Could not search. Try again.");
});
it("returns signed-out users to recipient search after login", async () => {
  auth.signedOut = true;
  await act(async () => root.render(<MessageRecipientSearch />));
  expect(host.querySelector("a")!.getAttribute("href")).toBe("/login?mode=signin&from=%2Fmessages%2Fnew");
  expect(host.querySelector("form")).toBeNull();
});

it("keeps pending identity neutral before deciding whether a handle is missing", async () => {
  auth.handle = null;
  auth.identityResolved = false;
  await act(async () => root.render(<MessageRecipientSearch />));
  expect(host.textContent).toBe("Checking your account…");
  expect(host.querySelector("a")).toBeNull();
  auth.identityResolved = true;
  await act(async () => root.render(<MessageRecipientSearch />));
  expect(host.textContent).toContain("Claim a handle to message");
  auth.handle = "viewer";
  await act(async () => root.render(<MessageRecipientSearch />));
  expect(host.querySelector("form")).not.toBeNull();
});

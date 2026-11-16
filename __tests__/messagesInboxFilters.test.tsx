// @vitest-environment jsdom

import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  auth: { user: { id: "alice-account" }, handle: "alice", accountRevision: 1 },
  request: vi.fn(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => fixture.auth }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/lib/authProviderRevision", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authProviderRevision")>(),
  readProviderAccountRevision: () => fixture.auth.accountRevision,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/messages/MessagesNewGroup", () => ({ default: () => null }));
vi.mock("@/lib/messagesRealtime", () => ({ subscribeToInbox: () => () => {} }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: (...args: unknown[]) => fixture.request(...args) }));

import MessagesInboxClient from "@/app/messages/MessagesInboxClient";

const rows = [
  { id: "maisie", otherHandle: "maisie", otherDisplayName: "Maisie", lastBody: "The Harp?", unread: 2 },
  { id: "tom", otherHandle: "tom", lastBody: "At seven", unread: 0 },
  { id: "friday", kind: "group", title: "Friday regulars", otherHandle: "tom", memberHandles: ["alice", "tom", "maisie"], lastBody: "See you there", unread: 0 },
];
import { invalidateMessagesInbox } from "@/lib/messagesInboxClient";

let host: HTMLDivElement;
let root: Root;
async function mount(): Promise<void> {
  await act(async () => root.render(createElement(MessagesInboxClient)));
}
async function search(query: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Search conversations"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function names(): string[] {
  return Array.from(host.querySelectorAll(".conversationLink"), (link) => link.getAttribute("href")!);
}
async function choose(label: string): Promise<void> {
  const control = Array.from(host.querySelectorAll("button")).find((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() === label);
  expect(control, label).toBeDefined();
  await act(async () => control!.click());
}
beforeEach(() => {
  invalidateMessagesInbox();
  clearSurfaceCache();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.auth = { user: { id: "alice-account" }, handle: "alice", accountRevision: 1 };
  fixture.request.mockReset().mockImplementation(() => Promise.resolve(Response.json({ conversations: rows })));
  window.matchMedia = (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("message inbox filters", () => {
  it.each(["alice", "ALICE"])("preserves a pending inbox read across equivalent auth updates (%s)", async (handle) => {
    let answer!: (response: Response) => void;
    fixture.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    await mount();
    expect(fixture.request).toHaveBeenCalledOnce();
    const signal = fixture.request.mock.calls[0]![1].signal as AbortSignal;

    fixture.auth = { ...fixture.auth, user: { id: "alice-account" }, handle };
    await mount();
    expect(fixture.request).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);

    await act(async () => answer(Response.json({ conversations: rows })));
    expect(names()).toEqual(["/messages/maisie", "/messages/tom", "/messages/friday"]);
  });

  it.each([
    ["account revision", "alice-account", "alice", 2],
    ["user ID", "bob-account", "alice", 1],
    ["canonical handle", "alice-account", "bob", 1],
  ])("replaces a pending inbox read when the %s changes", async (_change, userId, handle, accountRevision) => {
    const pending: Array<(response: Response) => void> = [];
    fixture.request.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    await mount();
    const signal = fixture.request.mock.calls[0]![1].signal as AbortSignal;

    fixture.auth = { user: { id: userId }, handle, accountRevision };
    await mount();
    expect(signal.aborted).toBe(true);
    expect(fixture.request).toHaveBeenCalledTimes(2);

    await act(async () => pending[1]!(Response.json({ conversations: rows.slice(0, 1) })));
    await act(async () => pending[0]!(Response.json({ conversations: rows })));
    expect(names()).toEqual(["/messages/maisie"]);
  });

  it("shows all conversations, only unread conversations, and only groups", async () => {
    await mount();
    expect(names()).toEqual(["/messages/maisie", "/messages/tom", "/messages/friday"]);
    await choose("Unread");
    expect(names()).toEqual(["/messages/maisie"]);
    await choose("Groups");
    expect(names()).toEqual(["/messages/friday"]);
    await choose("All");
    expect(names()).toHaveLength(3);
  });

  it("combines search with the selected filter and offers a way to clear the search", async () => {
    await mount();
    await choose("Groups");
    await search("Maisie");
    expect(names()).toEqual([]);
    expect(host.textContent).toContain("No conversations match your search.");
    await choose("Clear search");
    expect(names()).toEqual(["/messages/friday"]);
  });

  it("resets the search and filter when the account changes", async () => {
    await mount();
    await choose("Unread");
    await search("Maisie");
    fixture.auth = { user: { id: "bob-account" }, handle: "bob", accountRevision: 2 };
    fixture.request.mockImplementation(() => Promise.resolve(Response.json({ conversations: [{ id: "bob-new", otherHandle: "erin", lastBody: "Hi", unread: 0 }] })));
    await mount();
    expect(names()).toEqual(["/messages/bob-new"]);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Search conversations"]')!.value).toBe("");
    const selected = host.querySelector('button[aria-pressed="true"]');
    expect(selected?.textContent).toBe("All");
  });

  it("shows a loading line, then a failed read with a working retry", async () => {
    let answer!: (response: Response) => void;
    fixture.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    await mount();
    expect(host.textContent).toContain("With you in a sec.");
    await act(async () => answer(Response.json({ error: "unavailable" }, { status: 503 })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("load your conversations");
    await choose("Try again");
    expect(names()).toHaveLength(3);
  });

  it("distinguishes an empty inbox from an unread filter with unknown counts", async () => {
    fixture.request.mockImplementationOnce(() => Promise.resolve(Response.json({ conversations: [] })));
    await mount();
    expect(host.textContent).toContain("Your messages start here.");
    fixture.auth = { ...fixture.auth, accountRevision: 2 };
    fixture.request.mockImplementation(() => Promise.resolve(Response.json({ status: "degraded", conversations: [{ id: "unknown", otherHandle: "erin" }] })));
    await mount();
    await choose("Unread");
    expect(host.textContent).toContain("Some unread counts couldn't be checked.");
    expect(host.textContent).not.toContain("You're up to date.");
    await choose("Show all conversations");
    expect(names()).toEqual(["/messages/unknown"]);
  });
});

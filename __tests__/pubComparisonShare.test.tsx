// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubComparisonResultVenue } from "@/lib/pubComparison";

type Actor = { user: { id: string } | null; handle: string | null; accountRevision: number; providerAuthState?: string };
const state = vi.hoisted(() => ({ actor: { user: { id: "account-a" }, handle: "alice", accountRevision: 1 } as Actor, request: vi.fn() }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => state.actor }));
vi.mock("@/lib/authedFetch", () => ({ authedActionJson: state.request }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
import PubComparisonShare from "@/components/tools/PubComparisonShare";

const venues: PubComparisonResultVenue[] = ["a", "b"].map((id) => ({
  id: `venue-${id}`, name: "The Crown", address: `${id} Street`, borough: "Islington", items: [],
  knownSubtotalPence: 500, totalPence: 500, walk: { status: "not-requested", minutes: null, method: null, timing: null },
  mapHref: `/map?sel=venue-${id}`,
}));
let container: HTMLDivElement;
let root: Root;
async function render() { await act(async () => { root.render(createElement(PubComparisonShare, { venues })); }); }
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  await act(async () => { button?.click(); });
}

beforeEach(() => {
  state.actor = { user: { id: "account-a" }, handle: "alice", accountRevision: 1, providerAuthState: "authenticated" };
  state.request.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("comparison sign-in door", () => {
  it("invites a sign-in only after the session answers with nobody", async () => {
    state.actor = { user: null, handle: null, accountRevision: 1, providerAuthState: "unresolved" };
    await render();
    expect(container.textContent).not.toContain("Sign in");
    expect(container.textContent).not.toContain("Load my conversations");

    state.actor = { user: null, handle: null, accountRevision: 1, providerAuthState: "signed-out" };
    await render();
    expect(container.querySelector('a[href="/login?from=%2Ftools"]')?.textContent).toBe("Sign in");
  });

  it("never invites a signed-in reader to sign in", async () => {
    await render();
    expect(container.textContent).not.toContain("Sign in");
    expect(container.textContent).toContain("Load my conversations");
  });
});

describe("comparison private polls", () => {
  it("does not read conversations before the person asks", async () => {
    await render();
    expect(state.request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Load my conversations");
  });

  it("discards an old account's delayed conversation list", async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(); await click("Load my conversations");
    const signal = state.request.mock.calls[0]?.[1].signal as AbortSignal;
    state.actor = { user: { id: "account-b" }, handle: "bob", accountRevision: 2 };
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish?.({ response: { ok: true }, body: { status: "ready", conversations: [{ id: "old-private", kind: "group", title: "Alice private group" }] } }); });
    expect(container.textContent).not.toContain("Alice private group");
    expect(container.textContent).toContain("Load my conversations");
  });

  it("sends only after selecting a conversation and retains the retry identity", async () => {
    state.request.mockResolvedValueOnce({ response: { ok: true }, body: { status: "ready", conversations: [{ id: "thread-one", kind: "group", title: "Our group", memberHandles: ["alice", "bob"] }] } });
    await render(); await click("Load my conversations");
    expect(state.request).toHaveBeenCalledTimes(1);
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "thread-one"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    state.request.mockRejectedValueOnce(new Error("network"));
    await click("Send this poll");
    const first = JSON.parse(state.request.mock.calls[1]?.[1].body as string);
    expect(first).toMatchObject({ action: "send", handle: "alice", poll: { question: "Which pub works for us?" } });
    expect(first.body).not.toMatch(/meeting|order|£/);
    expect(first.clientMessageId).toMatch(/^[a-f0-9-]{36}$/);
    expect(container.textContent).toContain("Check the conversation before retrying");
    state.request.mockResolvedValueOnce({ response: { ok: true }, body: {} });
    await click("Send this poll");
    expect(JSON.parse(state.request.mock.calls[2]?.[1].body as string).clientMessageId).toBe(first.clientMessageId);
    expect(container.textContent).toContain("Poll sent");
  });
});

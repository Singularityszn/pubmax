// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (url: string, init?: RequestInit) => fetchMock(url, init),
  publishAuthActionState: () => {},
}));

import BlockedAccountsCard from "@/components/profile/BlockedAccountsCard";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(): Promise<void> {
  await act(async () => {
    root?.render(createElement(BlockedAccountsCard));
  });
  await settle();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!found) throw new Error(`no button "${label}" in ${container.innerHTML}`);
  return found;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.current = { user: { id: "user-a" }, identityResolved: true };
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

describe("blocked and muted list", () => {
  it("says so when nobody is muted or blocked", async () => {
    fetchMock.mockResolvedValue(json({ relationships: { blocked: [], muted: [] } }));
    await render();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/social/interactions?view=relationships",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(container.textContent).toContain("Nobody muted or blocked.");
  });

  it("lists both and takes one back through the same write the profile control uses", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        relationships: {
          blocked: [{ handle: "bob", since: "2026-10-01T00:00:00Z" }],
          muted: [{ handle: "carol", since: null }],
        },
      }),
    );
    await render();
    expect(container.textContent).toContain("@bob");
    expect(container.textContent).toContain("@carol");

    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await act(async () => {
      button("Unblock @bob").click();
    });
    await settle();
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe("/api/social/interactions");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({ action: "block", targetHandle: "bob" });
    expect(container.textContent).not.toContain("@bob");
    expect(container.textContent).toContain("@carol");

    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await act(async () => {
      button("Unmute @carol").click();
    });
    await settle();
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ action: "mute", targetHandle: "carol" });
    expect(container.textContent).toContain("Nobody muted or blocked.");
  });

  it("renders nothing for a viewer Social does not admit, or nobody signed in", async () => {
    fetchMock.mockResolvedValue(json({ error: "Sign in to use Social." }, 403));
    await render();
    expect(container.innerHTML).toBe("");
    authState.current = { user: null, identityResolved: true };
    await render();
    expect(container.innerHTML).toBe("");
  });
});

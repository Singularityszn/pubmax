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

import ProfileMuteBlock from "@/components/social/ProfileMuteBlock";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(targetHandle = "bob"): Promise<void> {
  await act(async () => {
    root?.render(createElement(ProfileMuteBlock, { targetHandle, viewerHandle: "alice" }));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!found) throw new Error(`no button "${label}" in ${container.innerHTML}`);
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).click();
  });
  await settle();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.current = { user: { id: "user-a" }, handle: "alice" };
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

describe("mute and block on a profile", () => {
  it("renders nothing for a viewer Social does not admit", async () => {
    fetchMock.mockResolvedValue(json({ error: "Sign in to use Social." }, 403));
    await render();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/social/interactions?view=relationship&handle=bob",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing on the viewer's own profile and asks nothing", async () => {
    await render("alice");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("mutes at once, and blocks only after a second, named tap", async () => {
    fetchMock.mockResolvedValueOnce(json({ relationship: { blocked: false, muted: false } }));
    await render();
    expect(container.querySelector("summary")?.textContent).toBe("Mute or block");
    expect(container.textContent).toContain("They won't be told.");

    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await click("Mute @bob");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/social/interactions", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ action: "mute", targetHandle: "bob" }),
    }));
    expect(button("Unmute @bob")).toBeTruthy();
    expect(container.textContent).toContain("You've muted @bob.");

    const callsBeforeBlock = fetchMock.mock.calls.length;
    await click("Block @bob");
    expect(fetchMock.mock.calls.length).toBe(callsBeforeBlock);
    await click("Keep them");
    expect(button("Block @bob")).toBeTruthy();

    await click("Block @bob");
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await click("Yes, block @bob");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/social/interactions", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ action: "block", targetHandle: "bob" }),
    }));
    expect(button("Unblock @bob")).toBeTruthy();
    expect(button("Unmute @bob")).toBeTruthy();
  });

  it("keeps a refused change visible and the state it had", async () => {
    fetchMock.mockResolvedValueOnce(json({ relationship: { blocked: false, muted: true } }));
    await render();
    fetchMock.mockResolvedValueOnce(json({ error: "Too many Social changes. Slow down." }, 429));
    await click("Unmute @bob");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/social/interactions", expect.objectContaining({ method: "DELETE" }));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Too many Social changes. Slow down.");
    expect(button("Unmute @bob")).toBeTruthy();
  });
});

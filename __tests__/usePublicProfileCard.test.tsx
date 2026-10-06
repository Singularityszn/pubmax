// @vitest-environment jsdom

// The nav chip, the signed-in card on /login and a thread header all wear a
// person's own face and name. One hook reads it, holds it against the handle it
// is about, answers a card read in the last minute without a request (SiteNav
// renders on every page), and reads again the moment the owner changes it.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { announceProfileCardChanged } from "@/components/auth/publicProfileCard";
import { usePublicProfileCard } from "@/components/auth/usePublicProfileCard";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const CARDS: Record<string, { displayName?: string; avatarUrl?: string }> = {
  qa_alice: { displayName: "Alice Archer", avatarUrl: "/api/profiles/a/avatar?v=1" },
  qa_bob: { displayName: "Bob Baker" },
};

let host: HTMLDivElement;
let root: Root;
let seen: Array<ReturnType<typeof usePublicProfileCard>>;
let fetchStub: ReturnType<typeof vi.fn>;

function Probe({ handle }: { handle: string | null }): null {
  seen.push(usePublicProfileCard(handle));
  return null;
}

const latest = () => seen.at(-1);

async function mount(handle: string | null): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe, { handle }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearSurfaceCache();
  seen = [];
  fetchStub = vi.fn(async (input: string) => {
    const handle = decodeURIComponent(String(input).split("/").pop() ?? "");
    return new Response(JSON.stringify({ profile: CARDS[handle] ?? null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchStub);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usePublicProfileCard", () => {
  it("reads the public card for the handle", async () => {
    await mount("qa_alice");
    expect(latest()).toEqual(CARDS.qa_alice);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0]?.[0])).toBe("/api/profiles/qa_alice");
  });

  it("answers a card read a moment ago from the tab without a request", async () => {
    await mount("qa_alice");
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // The next page's nav is a fresh mount of the same hook.
    await act(async () => root.unmount());
    root = createRoot(host);
    seen = [];
    await mount("qa_alice");

    expect(latest()).toEqual(CARDS.qa_alice);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("reads again once the card is older than a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await mount("qa_alice");
    expect(fetchStub).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    vi.setSystemTime(Date.now() + 61_000);
    root = createRoot(host);
    await mount("qa_alice");

    expect(fetchStub.mock.calls.length).toBeGreaterThan(1);
  });

  it("reads again the moment the owner changes their face or name", async () => {
    await mount("qa_alice");
    CARDS.qa_alice = { displayName: "Alice A.", avatarUrl: "/api/profiles/a/avatar?v=2" };
    await act(async () => {
      announceProfileCardChanged("qa_alice");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(latest()).toEqual({ displayName: "Alice A.", avatarUrl: "/api/profiles/a/avatar?v=2" });
    CARDS.qa_alice = { displayName: "Alice Archer", avatarUrl: "/api/profiles/a/avatar?v=1" };
  });

  it("ignores a change announced for somebody else", async () => {
    await mount("qa_alice");
    const calls = fetchStub.mock.calls.length;
    await act(async () => {
      announceProfileCardChanged("qa_bob");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchStub.mock.calls.length).toBe(calls);
  });

  it("never shows the previous handle's card over the next handle", async () => {
    await mount("qa_alice");
    expect(latest()?.displayName).toBe("Alice Archer");
    seen = [];
    await mount("qa_bob");
    expect(latest()).toEqual(CARDS.qa_bob);
    // Every paint after the switch was either the new card or nothing.
    expect(seen.every((card) => card === null || card.displayName === "Bob Baker")).toBe(true);
  });

  it("asks for nobody when there is no handle", async () => {
    await mount(null);
    expect(latest()).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

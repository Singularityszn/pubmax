// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SaveToListControl from "@/components/savedpubs/SaveToListControl";

// An in-place account switch leaves the save-to-list control mounted with its
// picker open. It must not keep showing the previous account's pressed chips,
// and it must read the new account's membership.

const authedFetch = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch, authedActionFetch }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => session }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const row = (listType: string) => ({
  venueId: "venue-1",
  venueName: "The Lamb",
  venueMapUrl: "/map?sel=venue-1",
  listType,
  savedAt: "2026-10-06T10:00:00.000Z",
});

beforeEach(() => {
  window.localStorage.clear();
  authedFetch.mockReset();
  authedActionFetch.mockReset();
  session.user = { id: "user-1" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function chip(name: string): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>("button.saveToListChip")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )!;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe("SaveToListControl across an account change", () => {
  it("drops the previous account's pressed chips and reads the next account's membership", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    const reads: string[] = [];
    authedFetch.mockImplementation(async (input: string) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      reads.push(input);
      return new Response(
        JSON.stringify({ saved: input.includes("handle=mia") ? [row("Date Night")] : [] }),
        { status: 200 },
      );
    });

    await act(async () => {
      root.render(createElement(SaveToListControl, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListToggle")!.click();
    });
    await settle();
    await settle();
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");

    // Another account signs in on this device and the picker is still open.
    window.localStorage.setItem("pubmax_handle", "zed");
    session.user = { id: "user-2" };
    await act(async () => {
      root.render(createElement(SaveToListControl, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await settle();
    await settle();

    expect(reads.some((url) => url.includes("handle=zed"))).toBe(true);
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("false");
  });
});

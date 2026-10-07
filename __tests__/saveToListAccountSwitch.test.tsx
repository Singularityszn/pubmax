// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SaveToListControl from "@/components/savedpubs/SaveToListControl";

// An in-place account switch leaves the save-to-list control mounted with its
// picker open. It must not keep showing the previous account's pressed chips,
// and it must read the new account's membership once that account's handle has
// been read. The inspector also reuses the control from pub to pub, so a pub it
// returns to is read from the server again before a chip can be pressed.

const authedFetch = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());
type Session = {
  user: { id: string } | null;
  loading: boolean;
  identityResolved: boolean;
  handle: string | null;
};
const session = vi.hoisted(() => ({}) as Session);
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
  Object.assign(session, {
    user: { id: "user-1" },
    loading: false,
    identityResolved: true,
    handle: "mia",
  } satisfies Session);
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
    // The switch publishes the new user first; its handle is read after.
    Object.assign(session, { user: { id: "user-2" }, identityResolved: false, handle: null });
    await act(async () => {
      root.render(createElement(SaveToListControl, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await settle();
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("false");
    expect(chip("Date Night").disabled).toBe(true);

    Object.assign(session, { identityResolved: true, handle: "zed" });
    await act(async () => {
      root.render(createElement(SaveToListControl, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await settle();
    await settle();

    expect(reads.some((url) => url.includes("handle=zed"))).toBe(true);
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("false");
    expect(chip("Date Night").disabled).toBe(false);
  });
});

describe("SaveToListControl across a venue change", () => {
  it("waits for the server again when the inspector returns to a pub", async () => {
    window.localStorage.setItem(
      "pubmax:savedPubs:v1",
      JSON.stringify([{ venueId: "venue-1", listType: "Date Night", savedAt: "2026-10-06T10:00:00.000Z" }]),
    );
    const held: Array<() => void> = [];
    let membershipReads = 0;
    authedFetch.mockImplementation(async (input: string) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      membershipReads += 1;
      const answer = () => new Response(JSON.stringify({ saved: [] }), { status: 200 });
      if (membershipReads === 1) return answer();
      return new Promise<Response>((resolve) => held.push(() => resolve(answer())));
    });
    const show = (venueId: string) =>
      act(async () => {
        root.render(createElement(SaveToListControl, { venueId, venueName: "The Lamb" }));
      });

    await show("venue-1");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListToggle")!.click();
    });
    await settle();
    await settle();
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("false");
    expect(chip("Date Night").disabled).toBe(false);

    // Another pub, then back before that pub's read has answered.
    await show("venue-2");
    await settle();
    await show("venue-1");
    await settle();
    expect(chip("Date Night").disabled).toBe(true);

    await act(async () => {
      for (const release of held) release();
    });
    await settle();
    await settle();
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("false");
    expect(chip("Date Night").disabled).toBe(false);
  });
});

// @vitest-environment jsdom

// ONE PUB'S HERITAGE ANSWER NEVER LANDS UNDER ANOTHER PUB.
//
// The inspector re-renders the same mounted Ask section when the reader taps a
// second pub, so an answer still in flight for the first pub must not paint
// under the second. VenueAskSection keys LandlordPanel by venue, which drops the
// first pub's panel (and its pending answer) on the switch.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenueAskSection from "@/components/map/inspector/VenueAskTab";
import type { Venue } from "@/lib/venues";

function venue(id: string, name: string): Venue {
  return {
    id,
    name,
    address: "1 Test Street",
    primaryBorough: "Camden",
    curation: {},
  } as unknown as Venue;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function answerResponse(answer: string): Response {
  return new Response(JSON.stringify({ answer, citations: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("LandlordPanel across a venue switch", () => {
  it("does not show venue A's late answer under venue B", async () => {
    const pendingA = deferred<Response>();
    const fetchMock = vi.fn(() => pendingA.promise);
    vi.stubGlobal("fetch", fetchMock);

    const a = venue("venue-a", "The Alpha Arms");
    const b = venue("venue-b", "The Bravo Tavern");

    act(() => root.render(createElement(VenueAskSection, { venue: a })));
    const askA = host.querySelector<HTMLButtonElement>(".landlordBtn")!;
    act(() => askA.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Pulling up the records");

    act(() => root.render(createElement(VenueAskSection, { venue: b })));

    await act(async () => {
      pendingA.resolve(answerResponse("Alpha was built in 1720."));
      await pendingA.promise;
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(host.textContent).not.toContain("Alpha was built in 1720.");
    expect(host.textContent).not.toContain("Pulling up the records");
    // B is free to ask its own question.
    expect(host.querySelector<HTMLButtonElement>(".landlordBtn")!.disabled).toBe(false);
  });
});

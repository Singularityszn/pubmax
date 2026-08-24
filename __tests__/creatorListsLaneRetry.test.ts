// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LIST = {
  ownerHandle: "alice",
  ownerDisplayName: "Alice",
  listType: "Sunday roasts",
  listUrl: "/u/alice/lists/Sunday%20roasts",
  mapUrl: "/map?mode=build&pubs=venue-1&sel=venue-1",
  planUrl: "/plan?query=Plan+Sunday+roasts+by+%40alice",
  savedCount: 1,
  updatedAt: "2026-08-24T12:00:00.000Z",
  previewVenues: [
    { venueId: "venue-1", venueName: "The Fox", venueMapUrl: "/map?sel=venue-1" },
  ],
};

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ identityResolved: true }),
}));

vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => "bob",
}));

vi.mock("@/components/profile/HandleAvatar", () => ({
  default: () => createElement("span", null, "avatar"),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

import CreatorListsLane from "@/components/social/CreatorListsLane";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("CreatorListsLane retry", () => {
  it("recovers ready lists after an unavailable first read", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("no", { status: 503 });
        }
        return new Response(JSON.stringify({ status: "ready", lists: [LIST] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await act(async () => {
      root.render(createElement(CreatorListsLane));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain("We could not reach creator lists.");

    const retry = host.querySelector("button");
    expect(retry?.textContent).toBe("Try again");

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Sunday roasts");
    expect(host.textContent).not.toContain("We could not reach creator lists.");
    expect(host.textContent).not.toContain("No creators have shared a list yet.");
  });
});

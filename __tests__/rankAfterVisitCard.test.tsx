// @vitest-environment jsdom

// Rank at the moment: the card below a receipt. It never renders for a
// signed-out viewer, it asks "Which did you prefer?" at most three times per
// visit, it shows names and listed prices but no score, and "Tell your lot"
// rides the save only when the person turned it on.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: session.signedIn ? "signed-in" : "signed-out",
    signedIn: session.signedIn,
    signedOut: !session.signedIn,
    unresolved: false,
  }),
}));

const net = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({
  authedFetch: net.get,
  authedActionJson: net.post,
}));

import RankAfterVisitCard from "@/components/pubs/RankAfterVisitCard";
import { __resetTellYourLot } from "@/components/pubs/useTellYourLot";
import type { SocialPubRankingEntry } from "@/lib/socialPubRankings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Sixteen loved pubs: an unbounded binary search would ask four or five times.
const LIST: SocialPubRankingEntry[] = Array.from({ length: 16 }, (_, index) => ({
  venueId: `pub-${index}`,
  venueName: `The Pub ${index}`,
  band: "loved",
  place: index + 1,
  score: 10 - index * 0.2,
  listedPrice: 5 + index / 10,
}));

let host: HTMLDivElement;
let root: Root | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(visits = [{ venueId: "seven-stars", venueName: "The Seven Stars" }]) {
  root = createRoot(host);
  await act(async () => {
    root!.render(<RankAfterVisitCard visits={visits} />);
  });
  await flush();
}

function click(selector: string) {
  const element = host.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return act(async () => {
    element.click();
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  session.signedIn = true;
  window.localStorage.clear();
  __resetTellYourLot();
  net.get.mockReset();
  net.post.mockReset();
  net.get.mockImplementation(async () =>
    json({ entries: LIST, subject: { venueId: "seven-stars", venueName: "The Seven Stars", listedPrice: 5.2 } }),
  );
  net.post.mockImplementation(async (_url: string, init: RequestInit) => ({
    response: json({}),
    body: { entries: LIST, shared: JSON.parse(String(init.body)).shareToLot === true },
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("RankAfterVisitCard", () => {
  it("renders nothing for a signed-out viewer and never asks the list", async () => {
    session.signedIn = false;
    await render();
    expect(host.innerHTML).toBe("");
    expect(net.get).not.toHaveBeenCalled();
  });

  it("renders nothing when Social refuses the list", async () => {
    net.get.mockImplementation(async () => json({ error: "Sign in to use Social." }, 401));
    await render();
    expect(host.innerHTML).toBe("");
  });

  it("asks at most three questions, shows names and prices but no score, then saves", async () => {
    await render();
    expect(host.textContent).toContain("How was The Seven Stars?");
    await click('[data-band="loved"]');

    for (let asked = 0; asked < 3; asked += 1) {
      expect(host.textContent).toContain("Which did you prefer?");
      expect(host.textContent).toContain("£5.20");
      expect(host.textContent).not.toMatch(/\d+\.\d\b(?!\d)/);
      expect(host.textContent).not.toMatch(/#\d/);
      await click('[data-testid="rank-after-visit-new"]');
    }
    await flush();

    expect(host.textContent).not.toContain("Which did you prefer?");
    expect(net.post).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(net.post.mock.calls[0]![1].body));
    expect(sent).toMatchObject({ venueId: "seven-stars", band: "loved" });
    expect(sent).not.toHaveProperty("shareToLot");
    expect(host.textContent).toContain("The Seven Stars is in your pubs, ranked.");
  });

  it("sends shareToLot only when Tell your lot is on, and remembers it on this device", async () => {
    await render();
    const toggle = host.querySelector<HTMLInputElement>('.rankAfterVisit__lot input')!;
    expect(toggle.checked).toBe(false);
    await act(async () => {
      toggle.click();
    });
    expect(window.localStorage.getItem("pubmax.tellYourLot.v1")).toBe("on");
    // Skip saves nothing and the card steps aside: the receipt above stays.
    await click('[data-testid="rank-after-visit-skip"]');
    expect(net.post).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe("");

    await act(async () => root!.unmount());
    await render();
    await click('[data-band="not_for_me"]');
    await flush();
    const sent = JSON.parse(String(net.post.mock.calls[0]![1].body));
    expect(sent.shareToLot).toBe(true);
    expect(host.textContent).toContain("Your lot will see it.");
  });

  it("offers a night's stops one by one and passes over a pub already ranked", async () => {
    net.get.mockImplementation(async (url: string) => {
      const id = new URL(url, "http://x").searchParams.get("venue")!;
      return json({ entries: LIST, subject: { venueId: id, venueName: id === "pub-3" ? "The Pub 3" : "The Lamb", listedPrice: null } });
    });
    await render([
      { venueId: "pub-3", venueName: "The Pub 3" },
      { venueId: "lamb", venueName: "The Lamb" },
    ]);
    expect(host.textContent).toContain("How was The Lamb?");
    await click('[data-band="loved"]');
    expect(host.textContent).toContain("No price listed");
  });
});

// @vitest-environment jsdom

// Rank at the moment: the card below a receipt. It never renders for a
// signed-out viewer, it asks "Which did you prefer?" at most three times per
// visit, it shows names and listed prices but no score, and "Tell your lot"
// rides the save only when the person turned it on.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ signedIn: true, userId: "receipt-owner" }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: session.userId },
    session: { user: { id: session.userId }, access_token: "fixture-token" },
    rejectedContributionAuth: null,
  }),
}));
vi.mock("@/components/identity/ContributionGateDialog", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/identity/ContributionGateDialog")>(),
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { userId: string; accessToken: string }) => unknown) => {
      await action({ userId: session.userId, accessToken: "fixture-token" });
    },
    contributionGateDialog: null,
  }),
}));
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
import DiaryLogPanel from "@/components/diary/DiaryLogPanel";
import { __resetTellYourLot } from "@/components/pubs/useTellYourLot";
import { setProviderIdentity } from "@/lib/authProviderRevision";
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
  await act(async () => {});
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function receipt() {
  root = createRoot(host);
  await act(async () => {
    root!.render(<DiaryLogPanel venueId="seven-stars" venueName="The Seven Stars" />);
  });
  await click('[data-testid="diary-log-open"]');
  await click('[data-testid="diary-log-submit"]');
  expect(host.querySelector(".visitReportOk")).not.toBeNull();
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
  session.userId = "receipt-owner";
  setProviderIdentity("supabase", session.userId);
  vi.stubGlobal("fetch", vi.fn(async () => json({
    entry: { visitedOn: "2026-11-17" }, shared: false,
  }, 201)));
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
  vi.unstubAllGlobals();
});

describe("RankAfterVisitCard", () => {
  it.each([
    {}, { entries: null }, { entries: {} }, { entries: [null] },
    { entries: [{ ...LIST[0], band: "invented" }] },
  ])("keeps a malformed checkpoint out of the mounted diary receipt: %j", async (body) => {
    net.get.mockResolvedValue(json({ ...body, subject: { venueId: "seven-stars", venueName: "The Seven Stars", listedPrice: 5.2 } }));
    await receipt();
    expect(host.querySelector('[data-band]')).toBeNull();
    expect(host.querySelector('[data-testid="rank-after-visit-retry"]')).not.toBeNull();
    net.get.mockImplementation(async () => json({ entries: LIST, subject: { venueId: "seven-stars", venueName: "The Seven Stars", listedPrice: 5.2 } }));
    await click('[data-testid="rank-after-visit-retry"]');
    await click('[data-band="loved"]');
    expect(host.querySelector('[data-testid="rank-after-visit-new"]')).not.toBeNull();
  });

  it("checks a lost committed answer without repeating its public share", async () => {
    let saved = false;
    let shares = 0;
    const check = deferred<Response>();
    net.get.mockImplementation(async () => saved ? check.promise : json({ entries: [], subject: { venueId: "seven-stars", venueName: "The Seven Stars", listedPrice: 5.2 } }));
    net.post.mockImplementation(async (_url: string, init: RequestInit) => {
      saved = true;
      if (JSON.parse(String(init.body)).shareToLot) shares += 1;
      throw new TypeError("The response was lost");
    });
    await receipt();
    await click('.rankAfterVisit__lot input');
    await click('[data-band="loved"]');
    expect(host.querySelector('[data-band]')).toBeNull();
    await act(async () => check.resolve(json({ entries: [{ ...LIST[0], venueId: "seven-stars" }] })));
    expect(host.querySelector('[data-testid="rank-after-visit"]')?.textContent).toContain("is in your pubs, ranked.");
    expect(host.textContent).not.toContain("Your lot will see it.");
    expect(host.textContent).not.toContain("It stayed private this time.");
    expect(shares).toBe(1);
    expect(net.post).toHaveBeenCalledTimes(1);
  });

  it("holds an unresolved save until a valid read allows a fresh placement", async () => {
    let attempts = 0;
    net.post.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("The response was lost");
      return { response: json({}), body: { entries: [{ ...LIST[0], venueId: "seven-stars" }] } };
    });
    await receipt();
    net.get.mockResolvedValue(json({ subject: { venueId: "seven-stars" } }));
    await click('[data-band="not_for_me"]');
    expect(host.querySelector('[data-band]')).toBeNull();
    expect(host.querySelector('.rankAfterVisit__lot input')).toBeNull();
    net.get.mockResolvedValue(json({ entries: LIST }));
    await click('[data-testid="rank-after-visit-retry"]');
    expect(host.querySelector('.rankAfterVisit__lot input')).not.toBeNull();
    await click('[data-band="loved"]');
    expect(host.querySelector('[data-testid="rank-after-visit-new"]')).not.toBeNull();
    expect(attempts).toBe(1);
    await click('.rankAfterVisit__quiet');
    expect(attempts).toBe(2);
    expect(host.textContent).toContain("is in your pubs, ranked.");
  });

  it("retires a comparison on the real receipt when the account changes", async () => {
    await receipt();
    await click('[data-band="loved"]');
    const nextRead = deferred<Response>();
    net.get.mockReturnValue(nextRead.promise);
    await act(async () => {
      session.userId = "next-owner";
      setProviderIdentity("supabase", session.userId);
      root!.render(<DiaryLogPanel venueId="seven-stars" venueName="The Seven Stars" />);
    });
    expect(host.querySelector(".visitReportOk")).not.toBeNull();
    expect(host.querySelector('[data-testid="rank-after-visit-new"]')).toBeNull();
    await act(async () => nextRead.resolve(json({ entries: [], subject: { venueId: "seven-stars", venueName: "The Seven Stars", listedPrice: 5.2 } })));
    expect(host.querySelector('[data-band]')).not.toBeNull();
    expect(host.querySelector('[data-testid="rank-after-visit-new"]')).toBeNull();
  });

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

// @vitest-environment jsdom

// The "which did you prefer?" flow every ranking door opens. A save is only
// known from the server: a lost answer is checked against a fresh list before
// anything else happens, a stale list is never asked about again, and an
// account switch closes the flow and drops any late answer.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: net.get, authedActionJson: net.post }));

import ComparePubFlow from "@/components/social/ComparePubFlow";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { rankingReadFailure, rankingSaveLanded } from "@/lib/firstTenRankingSession";
import type { SocialPubBand, SocialPubRankingEntry } from "@/lib/socialPubRankings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function entry(venueId: string, band: SocialPubBand, place: number): SocialPubRankingEntry {
  return { venueId, venueName: `The ${venueId}`, band, place, score: 10 - place / 2 };
}

function list(...rows: Array<[string, SocialPubBand]>): SocialPubRankingEntry[] {
  return rows.map(([id, band], index) => entry(id, band, index + 1));
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function answer(body: unknown, status = 200) {
  return { response: new Response(null, { status }), body };
}

let host: HTMLDivElement;
let root: Root | null = null;
const onClose = vi.fn();
const onSaved = vi.fn();

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(entries: SocialPubRankingEntry[], venue = { id: "lamb", name: "The lamb" }) {
  root = createRoot(host);
  await act(async () => {
    root!.render(<ComparePubFlow entries={entries} startVenue={venue} onClose={onClose} onSaved={onSaved} />);
  });
}

function dialog(): HTMLElement {
  return document.querySelector<HTMLElement>("[role=dialog]")!;
}

function button(name: string | RegExp): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((node) =>
    typeof name === "string" ? node.textContent?.trim() === name : name.test(node.textContent ?? ""));
}

async function click(name: string | RegExp) {
  const target = button(name);
  if (!target) throw new Error(`No button ${String(name)} in: ${dialog()?.textContent}`);
  await act(async () => {
    target.click();
  });
  await flush();
}

function heading(): string {
  return dialog().querySelector("h2")?.textContent ?? "";
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  net.get.mockReset();
  net.post.mockReset();
  onClose.mockReset();
  onSaved.mockReset();
  setProviderIdentity("supabase", "account-a");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("a lost save answer", () => {
  it("rereads the list and acknowledges a save that landed, without a second save", async () => {
    await open(list(["crown", "loved"]));
    net.post.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    net.get.mockResolvedValueOnce(reply({ entries: list(["crown", "loved"], ["lamb", "fine"]) }));
    await click("It was fine");
    expect(heading()).toBe("The lamb is in");
    expect(net.post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(net.post.mock.calls[0]![1].body)).toEqual({ venueId: "lamb", band: "fine", aboveVenueId: null, belowVenueId: null });
    expect(onSaved).toHaveBeenCalledWith(list(["crown", "loved"], ["lamb", "fine"]));
  });

  it("offers only a check while the list cannot be read, then recovers on the next read", async () => {
    await open(list(["crown", "loved"]));
    net.post.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    net.get.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await click("It was fine");
    expect(heading()).toBe("We lost the answer");
    expect(button("It was fine")).toBeUndefined();
    expect(onSaved).not.toHaveBeenCalled();

    net.get.mockResolvedValueOnce(reply({ entries: list(["crown", "loved"], ["lamb", "fine"]) }));
    await click("Check again");
    expect(heading()).toBe("The lamb is in");
    expect(net.post).toHaveBeenCalledTimes(1);
  });

  it("treats a server failure as unknown and a different placement as not saved", async () => {
    await open(list(["crown", "loved"]));
    net.post.mockResolvedValueOnce(answer({ code: "RANKING_UNAVAILABLE", error: "Your ranking is unavailable right now." }, 503));
    // The pub is there, but not where this save put it: that is not this save.
    net.get.mockResolvedValueOnce(reply({ entries: list(["crown", "loved"], ["swan", "fine"], ["lamb", "fine"]) }));
    await click("It was fine");
    expect(dialog().textContent).toContain("That ranking did not save.");
    expect(onSaved).not.toHaveBeenCalled();
    // The next question is asked against the list just read.
    await click("It was fine");
    expect(heading()).toBe("Which did you prefer?");
    expect(button(/The swan/)).toBeDefined();
  });

  it("goes back to the bands without a read when the server refused the save", async () => {
    await open(list(["crown", "loved"]));
    net.post.mockResolvedValueOnce(answer({ code: "INVALID_VENUE", error: "Choose a pub from the search." }, 400));
    await click("It was fine");
    expect(dialog().textContent).toContain("Choose a pub from the search.");
    expect(button("It was fine")).toBeDefined();
    expect(net.get).not.toHaveBeenCalled();
  });
});

describe("a list that moved in another tab", () => {
  it("never asks against the old list when the refresh fails", async () => {
    await open(list(["crown", "loved"], ["lamb", "loved"]), { id: "anchor", name: "The anchor" });
    await click("Loved it");
    await click(/^NewThe anchor/);
    expect(button(/The crown/)).toBeDefined();
    net.post.mockResolvedValueOnce(answer({ code: "STALE_RANKING", error: "Your list changed." }, 409));
    net.get.mockResolvedValueOnce(reply({ code: "RANKING_UNAVAILABLE" }, 503));
    await click(/^NewThe anchor/);
    expect(heading()).toBe("Your list changed");
    expect(button(/The lamb/)).toBeUndefined();
    expect(button(/The crown/)).toBeUndefined();

    net.get.mockResolvedValueOnce(reply({ entries: list(["swan", "loved"], ["crown", "loved"], ["lamb", "loved"]) }));
    await click("Check again");
    expect(dialog().textContent).toContain("Your list changed in another tab.");
    expect(heading()).toBe("Which did you prefer?");
    expect(button(/The crown/)).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("an account switch", () => {
  it("closes the flow and drops a save answer that arrives afterwards", async () => {
    await open(list(["crown", "loved"]));
    let finish!: (value: unknown) => void;
    net.post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await click("It was fine");
    await act(async () => {
      setProviderIdentity("supabase", "account-b");
    });
    expect(onClose).toHaveBeenCalled();
    await act(async () => {
      finish(answer({ entries: list(["crown", "loved"], ["lamb", "fine"]) }));
    });
    await flush();
    expect(onSaved).not.toHaveBeenCalled();
    expect(net.get).not.toHaveBeenCalled();
  });
});

describe("an account switch during search", () => {
  it("closes the flow while a search is still out", async () => {
    root = createRoot(host);
    await act(async () => {
      root!.render(<ComparePubFlow entries={[]} onClose={onClose} onSaved={onSaved} />);
    });
    net.get.mockReturnValueOnce(new Promise(() => {}));
    const input = dialog().querySelector("input")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "lamb");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      setProviderIdentity("supabase", "account-b");
    });
    expect(onClose).toHaveBeenCalled();
    expect(net.post).not.toHaveBeenCalled();
  });
});

describe("save recovery rules", () => {
  it("knows a save only by its pub, band and both neighbours", () => {
    const fresh = list(["crown", "loved"], ["lamb", "loved"], ["swan", "fine"]);
    expect(rankingSaveLanded(fresh, "lamb", "loved", { aboveVenueId: "crown", belowVenueId: null })).toBe(true);
    expect(rankingSaveLanded(fresh, "lamb", "loved", { aboveVenueId: null, belowVenueId: "crown" })).toBe(false);
    expect(rankingSaveLanded(fresh, "lamb", "fine", { aboveVenueId: null, belowVenueId: null })).toBe(false);
    expect(rankingSaveLanded(fresh, "anchor", "loved", { aboveVenueId: "lamb", belowVenueId: null })).toBe(false);
  });

  it("hides a refused read and shows a failed one as unavailable", () => {
    expect(rankingReadFailure(403, "SOCIAL_ADULT_VERIFICATION_REQUIRED")).toBe("refused");
    expect(rankingReadFailure(401, "SOCIAL_SIGN_IN_REQUIRED")).toBe("refused");
    expect(rankingReadFailure(503, "SOCIAL_ACCESS_UNAVAILABLE")).toBe("refused");
    expect(rankingReadFailure(503, "RANKING_UNAVAILABLE")).toBe("unavailable");
    expect(rankingReadFailure(0, undefined)).toBe("unavailable");
  });
});

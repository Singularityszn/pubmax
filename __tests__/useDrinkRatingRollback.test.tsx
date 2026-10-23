// @vitest-environment jsdom
// A vote that fails to save must not stay on screen as if it had (CMP-8).
// `rate` shows the vote at once, so a failure has to put the previous vote
// back, and must not undo a newer vote that landed while it was in flight.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RatingSummary } from "@/lib/ratings";
import { useDrinkRating, type DrinkRatingState } from "@/components/ratings/useDrinkRating";

const client = vi.hoisted(() => ({
  postRating: vi.fn(),
  fetchRatingSummary: vi.fn(async () => null),
  rememberHandle: vi.fn(),
  storedHandle: vi.fn(() => "quiz-night"),
}));
vi.mock("@/components/ratings/ratingsClient", () => client);

const SUMMARY = { shown: false, average: null } as unknown as RatingSummary;

let host: HTMLDivElement;
let root: Root;
let state: DrinkRatingState;
const captureState = (next: DrinkRatingState) => {
  state = next;
};

// Hands each committed render's state to the test through a callback.
function Harness({ onState }: { onState: (next: DrinkRatingState) => void }) {
  const rating = useDrinkRating("drink-1", "venue-1");
  useEffect(() => {
    onState(rating);
  });
  return null;
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  client.postRating.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(Harness, { onState: captureState }));
  });
  expect(state.handle).toBe("quiz-night");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useDrinkRating's optimistic vote", () => {
  it("puts the previous vote back when the save fails", async () => {
    client.postRating.mockResolvedValueOnce(SUMMARY);
    await act(async () => state.rate(4));
    expect(state.myRating).toBe(4);

    client.postRating.mockRejectedValueOnce(new Error("Couldn't save your rating just now."));
    await act(async () => state.rate(2));
    expect(state.myRating).toBe(4);
    expect(state.error).toBe("Couldn't save your rating just now.");
  });

  it("returns to no vote when the first save fails", async () => {
    client.postRating.mockRejectedValueOnce(new Error("offline"));
    await act(async () => state.rate(5));
    expect(state.myRating).toBeNull();
    expect(state.error).toBe("offline");
  });

  it("never undoes a newer vote when an older save fails late", async () => {
    let failFirst: (reason: Error) => void = () => {};
    client.postRating
      .mockImplementationOnce(
        () => new Promise((_, reject) => { failFirst = reject; }),
      )
      .mockResolvedValueOnce(SUMMARY);
    await act(async () => state.rate(3));
    await act(async () => state.rate(5));
    expect(state.myRating).toBe(5);

    await act(async () => failFirst(new Error("late")));
    expect(state.myRating).toBe(5);
  });
});

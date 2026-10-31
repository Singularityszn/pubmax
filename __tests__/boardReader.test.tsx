// @vitest-environment jsdom

// The board reader page (components/board/BoardReader.tsx): proposals render
// as cards, and only the rows the drinker leaves ticked are written, one each,
// through the existing community price write with the board photo as the bill.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  boundFetch: vi.fn(),
  post: vi.fn(),
  viewer: { phase: "signed-in", signedIn: true, signedOut: false, unresolved: false },
}));

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { userId: string; accessToken: string }) => unknown) => {
      await action({ userId: "account-1", accessToken: "test-access-token" });
    },
    contributionGateDialog: null,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => seams.viewer,
}));
vi.mock("@/lib/accountBoundFetch", () => ({
  accountBoundFetch: seams.boundFetch,
}));
vi.mock("@/lib/communityContributionClient", () => ({
  postCommunityContribution: seams.post,
}));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => false }));

import BoardReader from "@/components/board/BoardReader";
import { BOARD_READ_FOOD_LINE, BOARD_READ_KEYLESS_LINE } from "@/lib/boardRead";

const READ_ANSWER = {
  venueId: "venue-eltcmh",
  photo: { sha256: "b".repeat(64) },
  proposals: [
    { id: "row-1", name: "Guinness", category: "beer", measure: "pint", measureLabel: "", pricePence: 620, confidence: "clear" },
    { id: "row-2", name: "Camden Hells", category: "beer", measure: "half", measureLabel: "", pricePence: 340, confidence: "likely" },
    { id: "row-3", name: "House red", category: "wine", measure: "other", measureLabel: "175ml", pricePence: 750, confidence: "unsure" },
  ],
  keptOut: [{ id: "row-4", name: "Scotch egg", pricePence: 450 }],
};

let container: HTMLDivElement;
let root: Root;

function boardPhoto(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "board.jpg", { type: "image/jpeg" });
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(BoardReader, { venueId: "venue-eltcmh", venueName: "The Blackfriar" }));
  });
}

async function choosePhoto(file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("[data-testid='board-photo-input']");
  if (!input) throw new Error("the photo picker did not render");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(testId: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid='${testId}']`);
  if (!button) throw new Error(`${testId} did not render`);
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  seams.boundFetch.mockReset();
  seams.post.mockReset();
  seams.viewer = { phase: "signed-in", signedIn: true, signedOut: false, unresolved: false };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BoardReader", () => {
  it("writes only the confirmed rows, each through the price write with the board photo as its bill", async () => {
    seams.boundFetch.mockResolvedValue(new Response(JSON.stringify(READ_ANSWER), { status: 200 }));
    seams.post.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await render();
    const photo = boardPhoto();
    await choosePhoto(photo);
    await click("board-read");

    // The read went to the board reader, never to the price write.
    expect(seams.boundFetch).toHaveBeenCalledTimes(1);
    expect(seams.boundFetch.mock.calls[0]?.[1]).toBe("/api/board-reads");
    expect(seams.post).not.toHaveBeenCalled();

    const cards = container.querySelectorAll("[data-testid='board-row']");
    expect(cards).toHaveLength(3);
    expect(container.textContent).toContain(BOARD_READ_FOOD_LINE);

    // Untick the half.
    const tick = cards[1]?.querySelector<HTMLInputElement>("input[type='checkbox']");
    if (!tick) throw new Error("no tick box");
    await act(async () => {
      tick.click();
    });
    await click("board-confirm");

    expect(seams.post).toHaveBeenCalledTimes(2);
    const sent = seams.post.mock.calls.map(([, payload, options]) => ({ payload, options }));
    expect(sent.map(({ payload }) => payload)).toEqual([
      { venueId: "venue-eltcmh", drinkCategory: "beer", priceGbp: 6.2, measure: "pint" },
      { venueId: "venue-eltcmh", drinkCategory: "wine", priceGbp: 7.5, measure: "other", measureLabel: "175ml" },
    ]);
    for (const { options } of sent) expect(options.receiptPhoto).toBe(photo);
    expect(container.textContent).toContain("2 prices logged at The Blackfriar");
  });

  it("writes nothing when the drinker unticks every row", async () => {
    seams.boundFetch.mockResolvedValue(new Response(JSON.stringify(READ_ANSWER), { status: 200 }));
    await render();
    await choosePhoto(boardPhoto());
    await click("board-read");
    for (const tick of container.querySelectorAll<HTMLInputElement>("[data-testid='board-row'] input[type='checkbox']")) {
      await act(async () => {
        tick.click();
      });
    }
    expect(container.querySelector("[data-testid='board-confirm']")).toBeNull();
    expect(seams.post).not.toHaveBeenCalled();
  });

  it("says the one keyless line and offers nothing else", async () => {
    seams.boundFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: BOARD_READ_KEYLESS_LINE, code: "BOARD_READER_KEYLESS" }), { status: 503 }),
    );
    await render();
    await choosePhoto(boardPhoto());
    await click("board-read");
    expect(container.textContent).toBe(BOARD_READ_KEYLESS_LINE);
    expect(container.querySelector("button")).toBeNull();
  });

  it("asks a signed-out viewer to sign in, and stays neutral before the session answers", async () => {
    seams.viewer = { phase: "unresolved", signedIn: false, signedOut: false, unresolved: true };
    await render();
    expect(container.querySelector("a")).toBeNull();
    seams.viewer = { phase: "signed-out", signedIn: false, signedOut: true, unresolved: false };
    await render();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/login?from=%2Fboard%2Fvenue-eltcmh");
    expect(container.querySelector("[data-testid='board-photo-input']")).toBeNull();
  });
});

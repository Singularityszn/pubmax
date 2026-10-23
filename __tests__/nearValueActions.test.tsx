// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NEAR_ME_PRICE_CAPTION,
  NearMeCardList,
} from "@/components/nearme/NearMeNow";
import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import {
  NEAR_PRICE_TRUST_CAPTION,
  type NearPriceTrustResponse,
} from "@/lib/nearPriceTrust";

/**
 * What a first-time /near reader does after the prices. A row opens the pub
 * and Keep for tonight starts a Plan handoff, and before this the row said
 * nothing about the first, so the one worded control read as the only action.
 * The row now names its tap ("View pub") as a quiet cue inside the same
 * button, and the Keep action stays its own control beside it.
 */
const VIEW_LABEL = "View pub";

const CARDS: NearMeCard[] = [
  { id: "venue-a", name: "The First Pint", borough: "Westminster", cheapestPrice: 3.25, distanceKm: 0.2, walkMinutes: 3 },
  { id: "venue-b", name: "The Second Pint", borough: "Camden", cheapestPrice: 4.5, distanceKm: 0.4, walkMinutes: 5 },
];

const TRUST: NearPriceTrustResponse = {
  status: "ready",
  collectedAt: isoDate(PINT_DATASET_OBSERVED_AT),
  results: [
    { venueId: "venue-a", price: 3.25, publisher: "Pint Prices", observedAt: null },
    { venueId: "venue-b", price: 4.5, publisher: null, observedAt: null },
  ],
};

let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host.remove();
});

function render(props: Parameters<typeof NearMeCardList>[0]) {
  act(() => root?.render(createElement(NearMeCardList, props)));
}

function rows(): HTMLLIElement[] {
  return Array.from(host.querySelectorAll<HTMLLIElement>(".nmnList > li"));
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("/near rows name their browse tap", () => {
  it("prints View pub once per row inside the browse button, in browse-only mode", () => {
    const onOpen = vi.fn();
    render({ cards: CARDS, onOpen });

    expect(rows()).toHaveLength(2);
    for (const row of rows()) {
      const buttons = row.querySelectorAll("button");
      // Browse-only (the embedded Map answer): still exactly one control a row.
      expect(buttons).toHaveLength(1);
      const cue = row.querySelector(".nmnCardView");
      expect(cue?.textContent).toBe(VIEW_LABEL);
      expect(cue?.closest("button")).toBe(buttons[0]);
    }
    expect(host.querySelector(".nmnAccept")).toBeNull();
    expect(occurrences(host.textContent ?? "", VIEW_LABEL)).toBe(2);
  });

  it("opens the pub from the cue, because the cue is part of the row's one tap", () => {
    const onOpen = vi.fn();
    render({ cards: CARDS, onOpen });

    act(() => host.querySelectorAll<HTMLElement>(".nmnCardView")[1]?.click());

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("venue-b");
  });

  it("keeps View pub and Keep for tonight as two different controls in acceptance mode", () => {
    const onOpen = vi.fn();
    const onAccept = vi.fn();
    render({ cards: CARDS, onOpen, onAccept });

    for (const [index, row] of rows().entries()) {
      const [browse, keep, ...rest] = Array.from(row.querySelectorAll("button"));
      expect(rest).toHaveLength(0);
      expect(browse?.classList.contains("nmnCardBrowse")).toBe(true);
      expect(browse?.textContent).toContain(VIEW_LABEL);
      expect(browse?.textContent).not.toContain("Keep");
      // The Keep action's words and accessible name are unchanged.
      expect(keep?.classList.contains("nmnAccept")).toBe(true);
      expect(keep?.textContent).toBe("Keep for tonight");
      expect(keep?.getAttribute("aria-label")).toBe(`Keep ${CARDS[index]?.name} for tonight`);
      expect(keep?.querySelector(".nmnCardView")).toBeNull();
    }
  });

  it("routes each tap to its own callback and never crosses them", () => {
    const onOpen = vi.fn();
    const onAccept = vi.fn();
    render({ cards: CARDS, onOpen, onAccept });

    act(() => host.querySelector<HTMLElement>(".nmnCardView")?.click());
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("venue-a");
    expect(onAccept).not.toHaveBeenCalled();

    act(() => host.querySelectorAll<HTMLElement>(".nmnAccept")[1]?.click());
    expect(onAccept).toHaveBeenCalledExactlyOnceWith("venue-b");
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("/near row actions from the keyboard", () => {
  it("reaches browse then Keep for each row in reading order, and the cue is not a stop of its own", () => {
    render({ cards: CARDS, onOpen: vi.fn(), onAccept: vi.fn() });

    const focusable = Array.from(
      host.querySelectorAll<HTMLElement>("button, a[href], [tabindex]"),
    ).filter((node) => node.tabIndex >= 0);
    expect(focusable.map((node) => node.className)).toEqual([
      "nmnCard nmnCardBrowse",
      "nmnAccept",
      "nmnCard nmnCardBrowse",
      "nmnAccept",
    ]);
    // Native buttons, so Enter and Space work without a key handler.
    for (const node of focusable) {
      expect(node.tagName).toBe("BUTTON");
      expect(node.getAttribute("type")).toBe("button");
    }
    expect(host.querySelector(".nmnCardView")?.hasAttribute("tabindex")).toBe(false);
  });

  it("names the browse button with the pub, its price and the action, and hides the chevron", () => {
    render({ cards: CARDS, onOpen: vi.fn(), onAccept: vi.fn() });

    const browse = host.querySelector<HTMLButtonElement>(".nmnCardBrowse");
    // No aria-label on the row, so its name stays its visible text.
    expect(browse?.hasAttribute("aria-label")).toBe(false);
    const text = browse?.textContent ?? "";
    expect(text.startsWith("The First Pint")).toBe(true);
    expect(text.indexOf("£3.25")).toBeLessThan(text.indexOf(VIEW_LABEL));
    expect(host.querySelector(".nmnCardView svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("/near row cue leaves the trust captions where they were", () => {
  it("keeps the list caption, each row's record line and the collected line, once each", () => {
    render({ cards: CARDS, onOpen: vi.fn(), onAccept: vi.fn(), priceTrust: TRUST });

    const text = host.textContent ?? "";
    expect(occurrences(text, NEAR_ME_PRICE_CAPTION)).toBe(1);
    expect(occurrences(text, NEAR_PRICE_TRUST_CAPTION)).toBe(1);
    expect(host.querySelector(".nmnListCaption")?.textContent).toBe(NEAR_ME_PRICE_CAPTION);
    expect(host.querySelector(".nmnPriceCollected")?.textContent).toBe(NEAR_PRICE_TRUST_CAPTION);

    const trust = Array.from(host.querySelectorAll(".nmnCardTrust")).map((node) => node.textContent);
    expect(trust).toEqual(["On record · Pint Prices", "On record · Publisher not recorded"]);
    // The cue never rides the record line or the list's captions.
    for (const node of host.querySelectorAll(".nmnCardTrust, .nmnListCaption, .nmnPriceCollected")) {
      expect(node.textContent).not.toContain(VIEW_LABEL);
    }
  });

  it("keeps the price badge as the price column's figure, with the cue after it", () => {
    render({ cards: CARDS, onOpen: vi.fn(), priceTrust: "loading" });

    const columns = Array.from(host.querySelectorAll(".nmnCardPrice"));
    expect(columns).toHaveLength(2);
    expect(columns.map((column) => column.querySelector(".nmnCardPriceValue")?.textContent)).toEqual([
      "£3.25",
      "£4.50",
    ]);
    for (const column of columns) {
      expect(column.lastElementChild?.classList.contains("nmnCardView")).toBe(true);
    }
    expect(occurrences(host.textContent ?? "", "On record · Checking publisher")).toBe(2);
  });
});

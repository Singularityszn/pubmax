// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import TonightListingsNotice from "@/app/tonight/TonightListingsNotice";
import type { PicksState } from "@/lib/picksState";
import { AUDITED_ROUTES } from "../scripts/lib/uiUxBattleTestNavigation.mjs";

const route = AUDITED_ROUTES.find((item) => item.name === "tonight")!;
const state = (kind: PicksState["kind"], retryable = true): PicksState => ({
  kind, retryable, checkedAt: null, reason: kind === "temporarily_unavailable" ? "Listings unavailable." : null,
});

function paint(answer: PicksState, rows = 0) {
  const status = answer.kind === "genuinely_empty" ? "empty"
    : answer.kind === "temporarily_unavailable" ? "error" : rows ? "ready" : "idle";
  const notice = renderToStaticMarkup(createElement(TonightListingsNotice, {
    state: answer, note: answer.reason, noteOffersRetry: answer.retryable,
    emptyLead: "The city is having a quiet one tonight.", heldRowCount: rows, onRetry: () => {},
  }));
  document.body.innerHTML = `<main data-testid="tonight-screen" data-listings-status="${status}" data-picks-state="${answer.kind}">
    ${notice}${rows ? '<ul class="tonightList" data-testid="tonight-list"><li class="tonightRow"><a href="/map">Quiz night</a></li></ul>' : ""}
  </main>`;
  return document.querySelector("main")!;
}

function settled() { return document.querySelector(route.readySelector) !== null; }
afterEach(() => { document.body.innerHTML = ""; });

describe("Tonight browser audit readiness", () => {
  it("accepts a current ready list without a retired footer link", () => {
    paint(state("ready"), 1);
    expect(document.querySelector(".tonightFootLink")).toBeNull();
    expect(settled()).toBe(true);
  });

  it("accepts usable rows when another provider could not answer", () => {
    paint({ ...state("ready"), reason: "Some listings could not be checked." }, 1);
    expect(settled()).toBe(true);
  });

  it("accepts the genuine empty state only with its map door", () => {
    paint(state("genuinely_empty", false));
    expect(settled()).toBe(true);
    document.querySelector(".tonightStatusLink")!.remove();
    expect(settled()).toBe(false);
  });

  it.each([true, false])("accepts an unavailable answer with its recovery doors (retryable: %s)", retryable => {
    paint(state("temporarily_unavailable", retryable));
    expect(Boolean(document.querySelector(".tonightRetry"))).toBe(retryable);
    expect(settled()).toBe(true);
    document.querySelector(".tonightAlternatives")!.remove();
    expect(settled()).toBe(false);
  });

  it("does not accept a refresh over held rows or its old footer", () => {
    const root = paint(state("refreshing"), 1);
    root.insertAdjacentHTML("beforeend", '<a class="tonightFootLink" href="/map">Map</a>');
    expect(settled()).toBe(false);
  });

  it("does not accept an empty list or researched pubs as a completed listings read", () => {
    const root = paint(state("ready"));
    root.dataset.listingsStatus = "ready";
    root.insertAdjacentHTML("beforeend", '<ul data-testid="tonight-list" class="tonightList"></ul><div class="tonightHypedRow">A pub</div>');
    expect(settled()).toBe(false);
  });

  it("does not accept a missing state through legacy markup", () => {
    document.body.innerHTML = '<main data-testid="tonight-screen"><a class="tonightFootLink" href="/map">Map</a></main>';
    expect(settled()).toBe(false);
  });

  it("does not accept an error notice under the genuine-empty state", () => {
    const root = paint(state("temporarily_unavailable"));
    root.dataset.picksState = "genuinely_empty";
    root.dataset.listingsStatus = "empty";
    expect(settled()).toBe(false);
  });
});

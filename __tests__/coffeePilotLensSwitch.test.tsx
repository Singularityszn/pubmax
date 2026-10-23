// @vitest-environment jsdom

// Leaving the coffee lens closes a Shoreditch pilot cafe's sheet through the
// map trail's own reject, so the cafe's venue entry leaves history with it and
// a later Back cannot land on an empty step.

import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useReleaseLondonVenueSelection } from "@/components/map/useCoffeePilotCafes";
import { coffeePilotSelection } from "@/lib/pubMap";

const CROSSTOWN = "venue-osm-w271641406";
const byId = new Map([[CROSSTOWN, { id: CROSSTOWN, name: "Crosstown" }]]);

const container = document.createElement("div");
const root = createRoot(container);

function CoffeeLens({ lensOn, rejectSelection }: { lensOn: boolean; rejectSelection: (id: string) => void }) {
  const [selectedVenueId, setSelectedVenueId] = useState(CROSSTOWN);
  const pick = coffeePilotSelection({ lensOn, selectedVenueId, status: "ready", byId });
  useReleaseLondonVenueSelection(pick.release, selectedVenueId, rejectSelection, setSelectedVenueId);
  return createElement("p", { "data-selected": selectedVenueId }, pick.cafe?.name ?? "");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root.render(null));
  container.remove();
});

it("rejects the cafe's history entry and clears the selection when the reader leaves the coffee lens", async () => {
  const rejectSelection = vi.fn();
  await act(async () => root.render(createElement(CoffeeLens, { lensOn: true, rejectSelection })));
  const sheet = container.querySelector("[data-selected]");
  expect(sheet?.textContent).toBe("Crosstown");
  expect(rejectSelection).not.toHaveBeenCalled();

  await act(async () => root.render(createElement(CoffeeLens, { lensOn: false, rejectSelection })));

  expect(rejectSelection).toHaveBeenCalledWith(CROSSTOWN);
  expect(sheet?.getAttribute("data-selected")).toBe("");
  expect(sheet?.textContent).toBe("");
});

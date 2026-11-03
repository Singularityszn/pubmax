// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const pending = vi.hoisted(() => ({ resolve: null as null | ((value: unknown) => void) }));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCityResult: () => new Promise((resolve) => { pending.resolve = resolve; }) }));
import BoroughBingo from "@/components/wild/BoroughBingo";

it("discards a pending index read when the owner view unmounts", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(BoroughBingo, { been: [{ venueId: "lamb", venueName: "The Lamb", lastDate: "", sources: ["been_here"] }] })));
  expect(host.textContent).toContain("Loading");
  act(() => root.unmount());
  await act(async () => { pending.resolve?.({ status: "ready", rows: [{ id: "lamb", borough: "Camden" }] }); });
  expect(host.textContent).toBe("");
});

it("links a known visited borough and labels the City free square", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(BoroughBingo, { been: [{ venueId: "lamb", venueName: "The Lamb", lastDate: "", sources: ["been_here"] }] })));
  await act(async () => { pending.resolve?.({ status: "ready", rows: [{ id: "lamb", borough: "Camden" }] }); });
  const links = [...host.querySelectorAll("a")];
  expect(links).toHaveLength(1);
  expect(links[0]?.textContent).toContain("Camden");
  expect(links[0]?.textContent).toContain("The Lamb");
  expect(links[0]?.getAttribute("href")).toContain("lamb");
  expect(host.textContent).toContain("City of LondonFree square");
  expect(host.querySelectorAll("li")).toHaveLength(33);
  expect(host.textContent).not.toMatch(/\d|%/);
  act(() => root.unmount());
});

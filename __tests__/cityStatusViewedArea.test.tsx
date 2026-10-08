// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import CityStatusBanner from "@/components/map/CityStatusBanner";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const KINGSTON = "Kingston Market Place closed following fire";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  clearSurfaceCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    signals: [{ headline: KINGSTON, severity: "major", kind: "alert", areas: ["Kingston"] }],
  }), { status: 200 })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearSurfaceCache();
  vi.unstubAllGlobals();
});

async function renderArea(viewedArea: string | null) {
  await act(async () => root.render(createElement(CityStatusBanner, { cityId: "london", viewedArea })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
}

it("keeps Kingston news out of an unrelated viewed area", async () => {
  await renderArea("Soho");
  expect(container.textContent).not.toContain(KINGSTON);
  expect(container.querySelector(".cityStatusStack")).toBeNull();
});

it.each(["Kingston", "Kingston upon Thames"])("keeps useful news in %s", async (area) => {
  await renderArea(area);
  expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe(KINGSTON);
});

it("drops the previous area's feed and closes its expansion on context changes", async () => {
  await renderArea("Kingston");
  act(() => container.querySelector<HTMLButtonElement>(".cityStatusBannerLink")?.click());
  expect(container.querySelector(".cityStatusSignalSheet")).not.toBeNull();
  await renderArea("Soho");
  expect(container.textContent).not.toContain(KINGSTON);
  await renderArea("Kingston");
  expect(container.querySelector(".cityStatusSignalSheet")).toBeNull();
  expect(container.querySelector(".cityStatusBannerLink")?.getAttribute("aria-expanded")).toBe("false");
});

it("filters the feed before ranking headlines and grouping source-linked rows", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ signals: [
    { headline: "Bermondsey fire", severity: "major", areas: ["Bermondsey", "London"] },
    { headline: KINGSTON, severity: "notable", areas: ["Kingston"], sourceUrl: "https://example.com/kingston-fire" },
  ] }), { status: 200 }));
  await renderArea("Kingston");
  expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe(KINGSTON);
  act(() => container.querySelector<HTMLButtonElement>(".cityStatusBannerLink")?.click());
  expect(container.textContent).not.toContain("Bermondsey fire");
  expect(container.querySelector(".cityStatusSignalRowSource a")?.getAttribute("href")).toBe("https://example.com/kingston-fire");
  const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  act(() => window.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(container.querySelector(".cityStatusSignalSheet")).toBeNull();
});

it.each([null, "London"])("never uses an unknown or city-wide view %s to claim local news", async (area) => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ signals: [
    { headline: KINGSTON, severity: "major", areas: ["Kingston", "London"] },
    { headline: "Unlocated alert", severity: "major" },
  ] }), { status: 200 }));
  await renderArea(area);
  expect(container.querySelector(".cityStatusStack")).toBeNull();
});

it("keeps live TfL disruption when the local signal is elsewhere", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
    signals: [{ headline: KINGSTON, severity: "major", areas: ["Kingston"] }],
    tubeLines: [{ line: "Northern", status: "Severe Delays" }],
  }), { status: 200 }));
  await renderArea("Soho");
  expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe("TfL: Northern: Severe Delays");
  expect(container.textContent).not.toContain(KINGSTON);
  await act(async () => root.render(createElement(CityStatusBanner, {
    cityId: "london", viewedArea: "Kingston", allowCitywideStatus: false,
  })));
  expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe(KINGSTON);
  await act(async () => root.render(createElement(CityStatusBanner, {
    cityId: "london", viewedArea: "Soho", allowCitywideStatus: false,
  })));
  expect(container.querySelector(".cityStatusStack")).toBeNull();
});

it("keeps explicitly London-wide alerts without borrowing local areas", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
    signals: [{ headline: "London-wide transport strike", severity: "major", areas: ["London"] }],
  }), { status: 200 }));
  await renderArea("Soho");
  expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe("London-wide transport strike");
});

it.each([
  { areas: ["London"] },
  { areas: ["Greater London"] },
  { areas: ["London", "Greater London"] },
])(
  "removes city-wide alerts after movement for areas $areas",
  async ({ areas }) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      signals: [{ headline: "London-wide transport strike", severity: "major", areas }],
    }), { status: 200 }));
    await renderArea("Soho");
    expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe("London-wide transport strike");
    act(() => container.querySelector<HTMLButtonElement>(".cityStatusBannerLink")?.click());
    expect(container.querySelector(".cityStatusSignalSheet")).not.toBeNull();
    await act(async () => root.render(createElement(CityStatusBanner, {
      cityId: "london", viewedArea: null, allowCitywideStatus: false,
    })));
    expect(container.querySelector(".cityStatusStack")).toBeNull();
    expect(container.textContent).not.toContain("London-wide transport strike");
  },
);

it("keeps relevant local news while denying city-wide headlines and feed rows", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ signals: [
    { headline: "London-wide transport strike", severity: "major", areas: ["London"] },
    { headline: "Greater London alert", severity: "major", areas: ["Greater London"] },
    { headline: KINGSTON, severity: "notable", areas: ["Kingston", "London"], sourceUrl: "https://example.com/kingston-fire" },
    { headline: "Bermondsey fire", severity: "major", areas: ["Bermondsey", "London"] },
  ] }), { status: 200 }));
  await act(async () => root.render(createElement(CityStatusBanner, {
    cityId: "london", viewedArea: "Kingston", allowCitywideStatus: false,
  })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
  expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe(KINGSTON);
  act(() => container.querySelector<HTMLButtonElement>(".cityStatusBannerLink")?.click());
  expect(Array.from(container.querySelectorAll(".cityStatusSignalRowHeadline"), (row) => row.textContent)).toEqual([KINGSTON]);
  expect(container.querySelector(".cityStatusSignalRowSource a")?.getAttribute("href")).toBe("https://example.com/kingston-fire");
});

it("matches a named part of a combined map area without matching nearby names", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
    signals: [{ headline: "Bermondsey fire", severity: "major", areas: ["Bermondsey"] }],
  }), { status: 200 }));
  await renderArea("Bermondsey & London Bridge");
  expect(container.querySelector(".cityStatusBannerCopy")?.textContent).toBe("Bermondsey fire");
  await renderArea("South Bermondsey");
  expect(container.querySelector(".cityStatusStack")).toBeNull();
});

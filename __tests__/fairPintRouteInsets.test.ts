// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { fairPintRouteInsets } from "@/components/map/fairpint/fairPintRouteInsets";

function rect(element: HTMLElement, top: number, bottom: number) {
  element.getBoundingClientRect = () => ({
    top, bottom, left: 0, right: 390, x: 0, y: top, width: 390, height: bottom - top,
    toJSON: () => ({}),
  });
}
afterEach(() => { document.body.replaceChildren(); });

it("keeps a usable route band between real chrome and the sheet in the 390x664 failure", () => {
  document.body.innerHTML = '<div id="map"></div><header class="mobileMapTopbar"></header><div class="mobileMapChipRow"></div><div class="mobileSheetPortal"><section class="mobileSharedSheet"><form id="fair-pint-lock-form"></form></section></div>';
  const map = document.querySelector<HTMLElement>("#map")!;
  rect(map, 0, 664);
  rect(document.querySelector(".mobileMapTopbar")!, 12, 62);
  rect(document.querySelector(".mobileMapChipRow")!, 69, 112);
  rect(document.querySelector(".mobileSheetPortal")!, 0, 593);
  const sheet = document.querySelector<HTMLElement>(".mobileSharedSheet")!;
  rect(sheet, 228, 593);
  Object.defineProperty(sheet, "offsetHeight", { value: 365 });
  const padding = fairPintRouteInsets(map, true, { top: 188, right: 88, bottom: 200, left: 28 });
  expect(padding.top).toBe(136);
  expect(padding.bottom).toBe(460);
  expect(664 - padding.top - padding.bottom).toBeGreaterThanOrEqual(48);
});

it("uses the actual sheet edge rather than an entrance-height estimate", () => {
  document.body.innerHTML = '<div id="map"></div><div class="mobileSheetPortal"><section class="mobileSharedSheet"><form id="fair-pint-lock-form"></form></section></div>';
  const map = document.querySelector<HTMLElement>("#map")!;
  rect(map, 0, 664);
  rect(document.querySelector(".mobileSheetPortal")!, 0, 593);
  const sheet = document.querySelector<HTMLElement>(".mobileSharedSheet")!;
  rect(sheet, 310, 593);
  Object.defineProperty(sheet, "offsetHeight", { value: 365 });
  expect(fairPintRouteInsets(map, true, { top: 160, right: 28, bottom: 200, left: 28 }).bottom).toBe(378);
});

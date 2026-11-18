// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { measureBottomSheetTop, whenBottomSheetSettles } from "@/components/map/canvas/bottomSheetGeometry";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("measures the open sheet relative to the map and follows its changing height", () => {
  const sheet = document.createElement("section");
  sheet.className = "mobileSharedSheet open";
  document.body.append(sheet);
  let top = 296;
  sheet.getBoundingClientRect = () => new DOMRect(0, top, 390, 844 - top);

  expect(measureBottomSheetTop(24)).toBe(272);
  top = 400;
  expect(measureBottomSheetTop(24)).toBe(376);
  sheet.classList.remove("open");
  expect(measureBottomSheetTop(24)).toBeNull();
});

it("completes immediately without scheduling a frame when no sheet covers the map", () => {
  const requestFrame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  const done = vi.fn();

  const cancel = whenBottomSheetSettles(24, done);

  expect(done.mock.calls).toEqual([[null]]);
  expect(requestFrame).not.toHaveBeenCalled();
  cancel();
  expect(done.mock.calls).toEqual([[null]]);
});

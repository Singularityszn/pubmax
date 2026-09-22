// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";

let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("returns Home from a nested sheet while backdrop and Escape retain Back", async () => {
  const onClose = vi.fn();
  const onDismiss = vi.fn();
  const onBack = vi.fn();
  await act(async () => root.render(
    <MobileSharedSheet
      kind="planner"
      title="Plan an outing"
      backLabel="Back to Choose an area"
      onClose={onClose}
      onDismiss={onDismiss}
      onBack={onBack}
    >
      Describe the outing
    </MobileSharedSheet>,
  ));

  const home = document.querySelector<HTMLButtonElement>('button[aria-label="Close and return to the map"]');
  expect(home).not.toBeNull();
  await act(async () => home!.click());
  expect(onClose).toHaveBeenCalledOnce();
  expect(onDismiss).not.toHaveBeenCalled();

  await act(async () => document.querySelector<HTMLButtonElement>(".mobileSheetScrim")!.click());
  expect(onDismiss).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(onBack).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

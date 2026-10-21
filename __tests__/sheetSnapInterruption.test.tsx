// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useSheetHeightDrag } from "@/components/mobile/useSheetHeightDrag";

it.each([
  { target: "full", opening: false, override: undefined },
  { target: "peek", opening: false, override: undefined },
  { target: "full", opening: true, override: undefined },
  { target: "full", opening: false, override: "peek" },
] as const)("settles $target with opening=$opening and explicit override=$override", ({ target, opening, override }) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));

  function Probe() {
    const sheet = useSheetHeightDrag(() => {});
    function interrupt() {
      if (opening) sheet.openAtSnap(target);
      else sheet.setSheetSnap(target);
      // An interruption must retain the latest request before React commits.
      sheet.settleToRest(override);
    }
    return <><output>{sheet.sheetSnap}</output><button onClick={interrupt}>Interrupt</button></>;
  }

  try {
    act(() => root.render(<Probe />));
    act(() => host.querySelector("button")!.click());
    expect(host.querySelector("output")!.textContent).toBe(override ?? target);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    environment.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

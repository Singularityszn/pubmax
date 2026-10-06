// @vitest-environment jsdom

import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readHistoryStep, useStepHistory } from "@/lib/useStepHistory";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STEPS = ["one", "two", "three"] as const;
type Step = (typeof STEPS)[number];

let container: HTMLDivElement;
let root: Root;
const handles: {
  setStep: (step: Step) => void;
  setEnabled: (enabled: boolean) => void;
} = { setStep: () => {}, setEnabled: () => {} };

function Wizard() {
  const [step, setStep] = useState<Step>(() => readHistoryStep(STEPS) ?? "one");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    handles.setStep = setStep;
    handles.setEnabled = setEnabled;
  }, []);
  useStepHistory(step, setStep, { steps: STEPS, first: "one", enabled });
  return createElement("p", { id: "step" }, step);
}

const shown = () => container.querySelector("#step")?.textContent;

/** jsdom fires popstate on a later task, so wait for it inside act. */
async function back() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function go(step: Step) {
  await act(async () => handles.setStep(step));
}

beforeEach(async () => {
  window.history.pushState({ page: "before" }, "", "/before");
  window.history.pushState(null, "", "/wizard");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Wizard)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useStepHistory", () => {
  it("marks the entry the wizard opened on with its step", () => {
    expect(readHistoryStep(STEPS)).toBe("one");
  });

  it("pushes an entry per step and leaves the URL alone", async () => {
    const before = window.history.length;
    await go("two");
    await go("three");
    expect(window.history.length).toBe(before + 2);
    expect(window.location.pathname).toBe("/wizard");
    expect(readHistoryStep(STEPS)).toBe("three");
  });

  it("puts the previous step back on Back and the later one on Forward", async () => {
    await go("two");
    await go("three");
    await back();
    expect(shown()).toBe("two");
    await back();
    expect(shown()).toBe("one");
    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(shown()).toBe("two");
  });

  it("does not push for a step that is already the entry's", async () => {
    await go("two");
    const length = window.history.length;
    await go("two");
    expect(window.history.length).toBe(length);
  });

  it("keeps going back past its own entries once the wizard is off screen", async () => {
    await go("two");
    await go("three");
    await act(async () => handles.setEnabled(false));
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    // The two stale entries and the opening entry are all skipped, so the
    // reader is on the page before the wizard.
    expect(window.location.pathname).toBe("/before");
  });
});

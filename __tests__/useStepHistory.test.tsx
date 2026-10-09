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
  history: ReturnType<typeof useStepHistory> | null;
} = { setStep: () => {}, setEnabled: () => {}, history: null };

function Wizard() {
  const [step, setStep] = useState<Step>(() => readHistoryStep(STEPS) ?? "one");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    handles.setStep = setStep;
    handles.setEnabled = setEnabled;
  }, []);
  const history = useStepHistory(step, setStep, { steps: STEPS, first: "one", enabled });
  useEffect(() => {
    handles.history = history;
  }, [history]);
  return createElement("p", { id: "step" }, step);
}

const shown = () => container.querySelector("#step")?.textContent;

/**
 * jsdom fires popstate on a later task, so wait for it inside act. A landing
 * can send a further Back, which lands on a later task again. On a loaded
 * machine one fixed wait can end before that chain does, so wait until a
 * whole window passes with no popstate.
 */
async function settleHistory() {
  for (;;) {
    let moved = false;
    const onPopState = () => {
      moved = true;
    };
    window.addEventListener("popstate", onPopState);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    window.removeEventListener("popstate", onPopState);
    if (!moved) return;
  }
}

async function back() {
  await act(async () => window.history.back());
  await settleHistory();
}

async function forward() {
  await act(async () => window.history.forward());
  await settleHistory();
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
    await forward();
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
    await back();
    // The two stale entries and the opening entry are all skipped, so the
    // reader is on the page before the wizard.
    expect(window.location.pathname).toBe("/before");
  });

  it("goes back through the entries it pushed for an earlier step, so Back never returns to a later one", async () => {
    await go("two");
    await go("three");
    const length = window.history.length;
    await go("one");
    await settleHistory();
    expect(shown()).toBe("one");
    expect(readHistoryStep(STEPS)).toBe("one");
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe("/wizard");

    await go("two");
    await go("one");
    await settleHistory();
    await back();
    expect(window.location.pathname).toBe("/before");
  });

  it("steps back in place on the entry it opened on", async () => {
    window.history.replaceState({ ...window.history.state, pubmaxStep: "three" }, "");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(Wizard)));
    expect(shown()).toBe("three");
    const length = window.history.length;

    await go("two");
    expect(shown()).toBe("two");
    expect(window.history.length).toBe(length);
    expect(readHistoryStep(STEPS)).toBe("two");
  });

  it("unwinds the entries it pushed before it leaves", async () => {
    await go("two");
    await go("three");
    let stepWhenLeaving: Step | null = null;
    await act(async () => handles.history!.leave(() => {
      stepWhenLeaving = readHistoryStep(STEPS);
    }));
    await settleHistory();
    expect(stepWhenLeaving).toBe("one");
    expect(shown()).toBe("three");
  });
});

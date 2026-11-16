// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OutingSteps from "@/components/plan/OutingSteps";
import type { OutingStepsBridge } from "@/lib/nativeOutingSteps";
import { OUTING_STEPS_STORAGE_KEY, type OutingStepsSample } from "@/lib/outingSteps";
import { readOutingSteps, writeOutingSteps } from "@/lib/outingStepsSession";

const native = vi.hoisted(() => ({ bridge: null as OutingStepsBridge | null }));
vi.mock("@/lib/nativeOutingSteps", () => ({ loadOutingStepsBridge: async () => native.bridge }));

let root: Root;
let host: HTMLDivElement;
const session = "11111111-1111-4111-8111-111111111111";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(found).toBeDefined();
  return found!;
}

async function mount() {
  await act(async () => root.render(createElement(OutingSteps, { planId: "p1" })));
}

async function unmountPanel() {
  await act(async () => root.render(null));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  native.bridge = {
    status: async () => ({ available: true, permission: "granted" }),
    requestPermission: async () => ({ available: true, permission: "granted" }),
    sample: vi.fn<OutingStepsBridge["sample"]>(async () => ({ platform: "ios", steps: 20 })),
    stop: vi.fn(async () => {}),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("step panel operation lifetime", () => {
  it.each(["reading", "stopping"])("does not restore a cleared session when an unmounted panel finishes %s", async (operation) => {
    writeOutingSteps({ phase: "counting", planId: "p1", owner: null, session, startedAt: Date.now(), steps: 10, gap: false, counter: null });
    const oldRead = deferred<OutingStepsSample>();
    const sample = vi.mocked(native.bridge!.sample);
    if (operation === "reading") sample.mockReturnValueOnce(oldRead.promise);
    await mount();
    if (operation === "stopping") {
      sample.mockReturnValueOnce(oldRead.promise);
      await act(async () => button("Stop counting").click());
    }
    await unmountPanel();
    expect(native.bridge!.stop).not.toHaveBeenCalled();
    expect(readOutingSteps(null).phase).toBe("counting");
    await mount();
    await act(async () => button("Stop counting").click());
    await act(async () => button("Clear").click());
    expect(localStorage.getItem(OUTING_STEPS_STORAGE_KEY)).toBeNull();
    await act(async () => oldRead.resolve({ platform: "ios", steps: 99 }));
    expect(localStorage.getItem(OUTING_STEPS_STORAGE_KEY)).toBeNull();
  });

  it("does not publish a late start from an unmounted panel", async () => {
    const oldStart = deferred<OutingStepsSample>();
    vi.mocked(native.bridge!.sample).mockReturnValueOnce(oldStart.promise);
    await mount();
    await act(async () => button("Count my steps").click());
    await unmountPanel();
    await mount();
    await act(async () => oldStart.resolve({ platform: "ios", steps: 0 }));
    expect(localStorage.getItem(OUTING_STEPS_STORAGE_KEY)).toBeNull();
    expect(button("Count my steps").disabled).toBe(false);
  });
});

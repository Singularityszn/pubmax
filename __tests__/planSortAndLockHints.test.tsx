/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import {
  PLAN_DISTINCT_STOPS_ERROR,
  planLockHint,
  planLockValidationError,
  planStopCountLockError,
} from "@/components/plan/PlanComposer";

// F09: "Sort it" on an empty field did nothing visible, and "Lock it in" sat
// disabled with its required "Your name" field a screen away and no reason.

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

async function mount(onSubmit = vi.fn()): Promise<{ onSubmit: ReturnType<typeof vi.fn> }> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PlanDescribeFirst, { onSubmit, onGuideMeInstead: () => undefined }));
  });
  return { onSubmit };
}

function sortIt(): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "Sort it");
  if (!button) throw new Error("Sort it not painted");
  return button as HTMLButtonElement;
}

describe("Sort it on an empty field", () => {
  it("says what to type, marks the field invalid and keeps the caret there", async () => {
    const { onSubmit } = await mount();
    const input = document.getElementById("plan-describe-first-query") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(document.querySelector("[role=alert]")).toBeNull();

    await act(async () => sortIt().click());

    const alert = document.querySelector("[role=alert]");
    expect(alert?.textContent).toMatch(/where and who with/i);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert?.id);
    expect(document.activeElement).toBe(input);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears the message as soon as the visitor types", async () => {
    await mount();
    const input = document.getElementById("plan-describe-first-query") as HTMLInputElement;
    await act(async () => sortIt().click());
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "quiet in Soho");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector("[role=alert]")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("Lock it in hint", () => {
  const nameOnly = planLockValidationError({
    title: "Thursday crawl",
    creatorName: " ",
    startTime: "2026-07-20T18:00",
    completeStopCount: 2,
    visibleStopCount: 2,
  });

  it("names the missing field", () => {
    expect(planLockHint({ validation: nameOnly, busy: false, distinctStops: true, stopCountError: null, routeStale: false, startTimeIsValid: true }))
      .toBe("Add your name.");
  });

  it("falls through to a stale route, then an invalid start time", () => {
    expect(planLockHint({ validation: null, busy: false, distinctStops: true, stopCountError: null, routeStale: true, startTimeIsValid: false }))
      .toBe("Refresh the route before locking it in.");
    expect(planLockHint({ validation: null, busy: false, distinctStops: true, stopCountError: null, routeStale: false, startTimeIsValid: false }))
      .toBe("Choose a valid future start time.");
  });

  it("names duplicate stops and a stop count off the generated plan, as a tap would", () => {
    expect(planLockHint({
      validation: null, busy: false, distinctStops: false, stopCountError: null, routeStale: true, startTimeIsValid: true,
    })).toBe(PLAN_DISTINCT_STOPS_ERROR);
    const stopCountError = planStopCountLockError(3, 2);
    expect(stopCountError).toBe("A generated crawl needs exactly 3 stops we can stand behind before you lock it in.");
    expect(planLockHint({
      validation: null, busy: false, distinctStops: true, stopCountError, routeStale: true, startTimeIsValid: true,
    })).toBe(stopCountError);
    expect(planStopCountLockError(1, 2)).toBe("A generated meetup needs exactly 1 stop we can stand behind before you lock it in.");
    expect(planStopCountLockError(3, 3)).toBeNull();
  });

  it("says nothing when ready or while a request is running", () => {
    expect(planLockHint({ validation: null, busy: false, distinctStops: true, stopCountError: null, routeStale: false, startTimeIsValid: true })).toBeNull();
    expect(planLockHint({ validation: nameOnly, busy: true, distinctStops: true, stopCountError: null, routeStale: false, startTimeIsValid: true })).toBeNull();
  });
});

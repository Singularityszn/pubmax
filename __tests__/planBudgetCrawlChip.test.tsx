/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";

// The £20 crawl chip is a budget OPTION on describe-first: tapped, it rides on
// the next ask as words the generator already reads; untapped, the ask goes
// as typed; and a budget the reader typed wins over it.

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  return [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  )!;
}

async function render(initialQuery: string, onSubmit: (query: string) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PlanDescribeFirst, { onSubmit, onGuideMeInstead: () => undefined, initialQuery }));
  });
}

describe("the £20 crawl option", () => {
  it("sends the ask as typed while it is off", async () => {
    const onSubmit = vi.fn();
    await render("Quiet in Clapham for 4", onSubmit);
    await act(async () => button("Plan it").click());
    expect(onSubmit).toHaveBeenCalledWith("Quiet in Clapham for 4", 3);
  });

  it("adds the £20 crawl to the ask once tapped, and says it is on", async () => {
    const onSubmit = vi.fn();
    await render("Quiet in Clapham for 4", onSubmit);
    const chip = button("£20 crawl");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await act(async () => chip.click());
    expect(button("£20 crawl").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Plan it").click());
    expect(onSubmit).toHaveBeenCalledWith("Quiet in Clapham for 4, a £20 crawl", 3);
  });

  it("leaves a budget the reader typed alone", async () => {
    const onSubmit = vi.fn();
    await render("Soho for 3, £30.00 per person", onSubmit);
    await act(async () => button("£20 crawl").click());
    await act(async () => button("Plan it").click());
    expect(onSubmit).toHaveBeenCalledWith("Soho for 3, £30.00 per person", 3);
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import CrawlCostCalculator from "@/app/pub-crawl-cost/CrawlCostCalculator";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("balances the chosen spend without recommending more drinks", async () => {
  await act(async () => root.render(<CrawlCostCalculator suggestion={{ price: "5.00", label: "Recorded fixture price" }} />));
  const pubs = host.querySelector<HTMLInputElement>('input[name="stops"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(pubs, "3");
    pubs.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("£60.00");
  expect(host.textContent).toContain("£15.00");
  expect(host.querySelector('[data-rounds-verdict]')?.textContent).not.toMatch(/Add \d+ rounds?/);
  expect(host.querySelector('[data-rounds-verdict]')?.textContent?.toLowerCase()).toContain("split the bill");
  expect(host.querySelector('input[name="stops"]')?.getAttribute("value")).toBe("3");
});

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({
  user: { id: "account-a" } as { id: string } | null,
  handle: "alice" as string | null,
  identityResolved: true,
}));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => viewer }));

import LandingSavings from "@/components/landing/LandingSavings";
import type { PintPriceAverages } from "@/lib/pintSavings";

const averages = { averageGbp: 6, cheapAverageGbp: 4, sampleSize: 100 };
let container: HTMLDivElement;
let root: Root;
let reads: Array<{ url: string; signal: AbortSignal; resolve: (response: Response) => void }>;

async function render(value: PintPriceAverages | null = averages) {
  await act(async () => root.render(createElement(LandingSavings, { averages: value })));
}

async function answer(index: number, drops: unknown[] = [{ priceGbp: 4, measure: "pint" }], status = 200) {
  await act(async () => reads[index].resolve(new Response(JSON.stringify({ drops }), { status })));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(viewer, { user: { id: "account-a" }, handle: "alice", identityResolved: true });
  localStorage.clear();
  reads = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options: { signal: AbortSignal }) =>
    new Promise<Response>((resolve) => reads.push({ url, signal: options.signal, resolve })),
  ));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("landing savings belong to the resolved account", () => {
  it("does not read personal totals for a device-only handle", async () => {
    viewer.user = null;
    localStorage.setItem("pubmax_handle", "alice");
    await render();
    expect(reads).toHaveLength(0);
    expect(container.textContent).toContain("The average listed pint");
  });

  it("waits for canonical identity and keeps the measure on each price", async () => {
    viewer.identityResolved = false;
    await render();
    expect(reads).toHaveLength(0);
    viewer.identityResolved = true;
    await render();
    expect(reads[0].url).toBe("/api/pint-drops?author=alice");
    await answer(0, [
      { priceGbp: 4, measure: "pint" }, { priceGbp: 2, measure: "half" },
      { priceGbp: 1, measure: "other" }, { priceGbp: null, measure: "pint" },
    ]);
    expect(container.textContent).toBe("You have kept £2.00 over 1 pint you logged under the London average.");
  });

  it("removes a total on sign-out", async () => {
    await render();
    await answer(0);
    expect(container.querySelector("[data-mine]")).not.toBeNull();
    viewer.user = null;
    viewer.handle = null;
    await render();
    expect(container.querySelector("[data-mine]")).toBeNull();
    expect(container.textContent).toContain("The average listed pint");
  });

  it("removes the former account's total while the new read waits or fails", async () => {
    await render();
    await answer(0);
    viewer.user = { id: "account-b" };
    viewer.handle = "bob";
    await render();
    expect(container.querySelector("[data-mine]")).toBeNull();
    expect(reads[1].url).toBe("/api/pint-drops?author=bob");
    await answer(1, [], 503);
    expect(container.querySelector("[data-mine]")).toBeNull();
  });

  it("does not accept an old read after an account switch", async () => {
    await render();
    viewer.user = { id: "account-b" };
    viewer.handle = "bob";
    await render();
    expect(reads[0].signal.aborted).toBe(true);
    await answer(1, [{ priceGbp: 5, measure: "pint" }]);
    await answer(0);
    expect(container.textContent).toBe("You have kept £1.00 over 1 pint you logged under the London average.");
  });

  it("binds the read to the account id even when the handle is unchanged", async () => {
    await render();
    await answer(0);
    viewer.user = { id: "account-b" };
    await render();
    expect(container.querySelector("[data-mine]")).toBeNull();
    expect(reads).toHaveLength(2);
  });

  it("does not show a total calculated from replaced or absent averages", async () => {
    await render();
    await answer(0);
    await render({ ...averages, averageGbp: 7 });
    expect(container.querySelector("[data-mine]")).toBeNull();
    await render(null);
    expect(container.textContent).toBe("");
    await answer(1);
    expect(container.textContent).toBe("");
  });
});

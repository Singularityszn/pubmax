// @vitest-environment jsdom

// A failed read of the Shoreditch coffee pilot is named over the map with a
// Retry, rather than drawing an empty lens that would say Shoreditch has no
// listed coffee, and Retry reads the pilot again.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import CoffeePilotLoadFailed from "@/components/map/CoffeePilotLoadFailed";
import { useCoffeePilotCafes } from "@/components/map/useCoffeePilotCafes";

const ROOT = resolve(__dirname, "..");

const container = document.createElement("div");
const root = createRoot(container);

function CoffeeLens() {
  const pilot = useCoffeePilotCafes(true);
  if (pilot.status === "failed") return createElement(CoffeePilotLoadFailed, { onRetry: pilot.retry });
  return createElement("p", { "data-status": pilot.status }, pilot.cafes.map((cafe) => cafe.name).join(", "));
}

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root.render(null));
  container.remove();
  vi.unstubAllGlobals();
});

it("names a failed read with a Retry that reads the pilot again", async () => {
  let layerDown = true;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (layerDown) return new Response("down", { status: 503 });
    const body = readFileSync(join(ROOT, "public", String(input).replace(/^\//, "")), "utf8");
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);

  await act(async () => root.render(createElement(CoffeeLens)));
  await settle();

  const note = container.querySelector("[data-testid='coffee-pilot-load-failed']");
  expect(note?.textContent).toContain("Shoreditch coffee prices could not load");
  const retry = note?.querySelector("button");
  expect(retry?.textContent).toBe("Retry");

  layerDown = false;
  await act(async () => retry!.click());
  await settle();

  expect(container.querySelector("[data-testid='coffee-pilot-load-failed']")).toBeNull();
  const lens = container.querySelector("[data-status]");
  expect(lens?.getAttribute("data-status")).toBe("ready");
  expect(lens?.textContent).toContain("Crosstown");
});

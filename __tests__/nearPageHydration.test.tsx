// @vitest-environment jsdom

import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.query),
  usePathname: () => "/near",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nearme/PosterLandingNote", () => ({ default: () => null }));
vi.mock("@/components/nearme/NearMeNow", () => ({
  default: () => createElement("h1", null, "Pint answer"),
}));
vi.mock("@/components/nearme/NearDeskNow", () => ({
  default: () => createElement("h1", null, "Desk answer"),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import NearPageClient from "@/components/nearme/NearPageClient";
import { NEAR_MODE_STORAGE_KEY } from "@/lib/nearDesk";

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it.each([
  { query: "mode=desk&patch=soho", remembered: "pint", answer: "Desk" },
  { query: "mode=pint&patch=soho", remembered: "desk", answer: "Pint" },
  { query: "patch=soho", remembered: "desk", answer: "Desk" },
  { query: "", remembered: null, answer: "Pint" },
])("hydrates the cached document before resolving $query with remembered $remembered", async ({ query, remembered, answer }) => {
  // force-static renders with empty search params. The browser receives the
  // same cached document for /near?mode=desk&patch=soho.
  route.query = "";
  const container = document.createElement("div");
  container.innerHTML = renderToString(createElement(NearPageClient));
  document.body.appendChild(container);
  expect(container.querySelector("h1")?.textContent).toBe("Pint answer");

  route.query = query;
  if (remembered) localStorage.setItem(NEAR_MODE_STORAGE_KEY, remembered);
  const recoverable: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, createElement(NearPageClient), {
      onRecoverableError: error => recoverable.push(error),
    });
  });

  expect(container.querySelector("h1")?.textContent).toBe(`${answer} answer`);
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(answer);
  expect(recoverable).toEqual([]);
});

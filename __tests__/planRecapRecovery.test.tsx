// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import RecapDetail from "@/components/plan/RecapDetail";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("offers a retry after an outage and shows the member recap when it succeeds", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ visibility: "member", completed: false, stopCount: 1 }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(RecapDetail, { planId: "test-plan" })); });
  expect(host.textContent).not.toContain("private to the crew");
  expect(host.querySelector("h1")).not.toBeNull();
  const retry = [...host.querySelectorAll("button")].find((button) => /try again/i.test(button.textContent ?? ""));
  expect(retry).toBeDefined();
  await act(async () => { retry!.click(); });
  expect(host.querySelector("h1")?.textContent).toMatch(/isn.t finished/i);
  await act(async () => { root.unmount(); });
});

it.each([
  { response: () => new Response(null, { status: 404 }), heading: /not found/i },
  { response: () => Response.json({ visibility: "preview" }), heading: /private recap/i },
])("distinguishes a missing recap from a private preview", async ({ response, heading }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(RecapDetail, { planId: "test-plan" })); });
  expect(host.querySelector("h1")?.textContent).toMatch(heading);
  await act(async () => { root.unmount(); });
});

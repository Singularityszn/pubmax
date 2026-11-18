// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: transport.read, authedActionFetch: vi.fn() }));

import SocialPostActions from "@/components/social/SocialPostActions";

type Observation = { callback: IntersectionObserverCallback; target: Element | null; observer: IntersectionObserver };
let observations: Observation[];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const summary = () => Response.json({ summary: { cheered: false, saved: false, cheerCount: 3 } });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  transport.read.mockReset().mockImplementation(async () => summary());
  observations = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      const observer = this as unknown as IntersectionObserver;
      observations.push({ callback, target: null, observer });
    }
    observe(target: Element) { observations[observations.length - 1]!.target = target; }
    disconnect() {}
  });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

async function enter(observation: Observation) {
  await act(async () => observation.callback([
    { isIntersecting: true, target: observation.target } as IntersectionObserverEntry,
  ], observation.observer));
}

it("does not read offscreen summaries and enables the approaching row without duplicate reads", async () => {
  await act(async () => root.render(createElement("div", null,
    ...Array.from({ length: 20 }, (_, i) => createElement(SocialPostActions, { key: i, postId: `post-${i}` })),
  )));
  expect(transport.read).not.toHaveBeenCalled();
  const rows = host.querySelectorAll(".socialPostActions");
  expect(rows).toHaveLength(20);
  await enter(observations[0]!);
  expect(rows[0]!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  expect(rows[1]!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  await enter(observations[0]!);
  expect(transport.read).toHaveBeenCalledTimes(1);
});

it("ignores a queued intersection after the row leaves", async () => {
  await act(async () => root.render(createElement(SocialPostActions, { postId: "post-1" })));
  const observation = observations[0];
  await act(async () => root.render(null));
  if (observation) await enter(observation);
  expect(transport.read).not.toHaveBeenCalled();
});

it("keeps reaction reads working without IntersectionObserver", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  await act(async () => root.render(createElement(SocialPostActions, { postId: "post-1" })));
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});

it("lets an approaching row retry a failed summary", async () => {
  transport.read.mockResolvedValueOnce(Response.json({}, { status: 503 }));
  await act(async () => root.render(createElement(SocialPostActions, { postId: "post-1" })));
  if (observations[0]) await enter(observations[0]);
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  expect(retry).not.toBeNull();
  await act(async () => retry.click());
  if (observations.length) await enter(observations[observations.length - 1]!);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});

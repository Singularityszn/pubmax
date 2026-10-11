// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let read: ReturnType<typeof useCommunityPrices>["loadProvisionalBaseVenues"];
let requests: Array<{ ids: string[]; signal?: AbortSignal | null; answer: (response: Response) => void }>;

function Probe() {
  const loader = useCommunityPrices().loadProvisionalBaseVenues;
  useEffect(() => { read = loader; }, [loader]);
  return null;
}

beforeEach(async () => {
  requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => new Promise<Response>((answer) => {
    requests.push({ ids: new URL(url, "http://localhost").searchParams.getAll("venueId"), signal: init?.signal, answer });
  })));
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function answer(index: number, status = 200) {
  const request = requests[index];
  if (!request) throw new Error(`Request ${index} did not start.`);
  await act(async () => request.answer(new Response(JSON.stringify({ venueIds: [] }), { status })));
}

it("reads a dense viewport with two requests in flight and keeps the 64-ID limit", async () => {
  const ids = Array.from({ length: 129 }, (_, index) => `venue-uk-n${index}`);
  await act(async () => read(ids));
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.ids.length)).toEqual([64, 64]);
  await answer(0);
  expect(requests).toHaveLength(3);
  expect(requests[2]?.ids).toHaveLength(1);
  await answer(1);
  await answer(2);
  await act(async () => read(ids));
  expect(requests).toHaveLength(3);
});

it("shares the two slots across viewport changes and reads the newest viewport next", async () => {
  await act(async () => read(Array.from({ length: 200 }, (_, i) => `venue-uk-n${i}`)));
  await act(async () => read(["venue-uk-w1"]));
  await act(async () => read(["venue-uk-w2"]));
  expect(requests).toHaveLength(2);
  await answer(0);
  expect(requests).toHaveLength(2);
  await answer(1);
  expect(requests).toHaveLength(3);
  expect(requests[2]?.ids).toEqual(["venue-uk-w2"]);
  await answer(2);
});

it("stops dispatch after a refusal and leaves unanswered IDs retryable after backoff", async () => {
  vi.useFakeTimers();
  try {
    const ids = Array.from({ length: 200 }, (_, i) => `venue-uk-n${i}`);
    await act(async () => read(ids));
    await answer(0, 429);
    await answer(1);
    await act(async () => read(ids));
    expect(requests).toHaveLength(2);
    vi.advanceTimersByTime(60_001);
    await act(async () => read(ids));
    expect(requests).toHaveLength(4);
    await answer(2);
    await answer(3);
    await answer(4);
  } finally {
    vi.useRealTimers();
  }
});

it("cancels both reads on unmount and does not dispatch another chunk", async () => {
  await act(async () => read(Array.from({ length: 200 }, (_, i) => `venue-uk-n${i}`)));
  await act(async () => root.unmount());
  expect(requests.every((request) => request.signal?.aborted)).toBe(true);
  await answer(0);
  await answer(1);
  expect(requests).toHaveLength(2);
});

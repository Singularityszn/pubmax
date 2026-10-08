import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import { clearSurfaceCache, loadSurfaceJson, readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";

const variants = [
  { label: "public", url: "/api/whats-on?window=tonight&limit=60", options: {} },
  { label: "near", url: "/api/whats-on?window=tonight&limit=60&near=51.512,-0.123", options: { near: { lat: 51.51234567, lng: -0.12345678 } } },
  { label: "pubOnly", url: "/api/whats-on?window=tonight&limit=60&pubOnly=1", options: { pubOnly: true } },
  { label: "near pubOnly", url: "/api/whats-on?window=tonight&limit=60&near=51.512,-0.123&pubOnly=1", options: { near: { lat: 51.51234567, lng: -0.12345678 }, pubOnly: true } },
];

const nights = [
  { label: "BST", before: "2026-10-08T02:59:59.000Z", after: "2026-10-08T03:00:01.000Z" },
  { label: "spring DST", before: "2026-03-29T02:59:59.000Z", after: "2026-03-29T03:00:01.000Z" },
  { label: "autumn DST", before: "2026-10-25T03:59:59.000Z", after: "2026-10-25T04:00:01.000Z" },
];

function answer(id: string, servedAt: unknown) {
  return {
    servedAt,
    rows: [{
      id,
      venueId: "v1",
      placeName: "The Test Arms",
      kind: "quiz",
      startsAt: "2026-03-28T19:00:00.000Z",
      title: "Quiz night",
      source: { label: "Org", url: "https://example.com" },
      observedAt: "2026-03-28T09:00:00.000Z",
      confidence: "listed",
    }],
    sourceObservedAt: "2026-03-28T09:00:00.000Z",
    sourceFreshnessKind: "provider-observed",
    kindObservedAt: { quiz: "2026-03-28T09:00:00.000Z" },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.useFakeTimers();
});

afterEach(() => {
  clearSurfaceCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(variants)("$label service-night races", ({ options, url }) => {
  it.each(nights)("rejects a late previous-night answer and reuses only the new snapshot during $label", async ({ before, after }) => {
    vi.setSystemTime(new Date(before));
    let release = (_response: Response) => {};
    const current = answer("current", after);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
      .mockImplementation(async () => Response.json(current));
    const onResult = vi.fn();
    const pending = loadWhatsOnTonight({ ...options, fetchImpl, onResult });
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date(after));
    release(Response.json(answer("previous", before)));
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result.status).toBe("ready");
    expect(result.rows.map((row) => row.id)).toEqual(["current"]);
    expect(onResult.mock.calls.map(([value]) => value.rows.map((row: { id: string }) => row.id))).toEqual([["current"]]);
    expect(readSurfaceSnapshot(url)).toEqual(current);
    vi.advanceTimersByTime(1_000);
    const onReturn = vi.fn();
    expect(await loadWhatsOnTonight({ ...options, fetchImpl, onResult: onReturn })).toEqual(result);
    expect(onReturn.mock.calls.map((call) => call[1])).toEqual(["snapshot"]);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([url, url]);
    expect(result.sourceObservedAt).toBe(current.sourceObservedAt);
    expect(result.kindObservedAt).toEqual(current.kindObservedAt);
    expect(result.rows[0]?.source).toEqual(current.rows[0]?.source);
  });

  it.each(nights)("starts a separate read for a post-rollover caller while the previous read is pending during $label", async ({ before, after }) => {
    vi.setSystemTime(new Date(before));
    let release = (_response: Response) => {};
    const current = answer("current", after);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
      .mockImplementation(async () => Response.json(current));
    const oldPaint = vi.fn();
    const earlier = loadWhatsOnTonight({ ...options, fetchImpl, onResult: oldPaint });
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date(after));
    const newPaint = vi.fn();
    const later = loadWhatsOnTonight({ ...options, fetchImpl, onResult: newPaint });
    await vi.advanceTimersByTimeAsync(0);
    const independentRead = fetchImpl.mock.calls.length === 2;
    release(Response.json(answer("previous", before)));
    await vi.advanceTimersByTimeAsync(50);
    const [oldResult, newResult] = await Promise.all([earlier, later]);
    expect(independentRead).toBe(true);
    expect(oldResult.rows.map((row) => row.id)).toEqual(["current"]);
    expect(newResult.rows.map((row) => row.id)).toEqual(["current"]);
    for (const paint of [oldPaint, newPaint]) {
      expect(paint.mock.calls.map(([value]) => value.rows.map((row: { id: string }) => row.id))).toEqual([["current"]]);
    }
    const count = fetchImpl.mock.calls.length;
    expect(await loadWhatsOnTonight({ ...options, fetchImpl })).toEqual(newResult);
    expect(fetchImpl).toHaveBeenCalledTimes(count);
    expect(fetchImpl.mock.calls.every((call) => call[0] === url)).toBe(true);
  });

  it.each(nights)("rejects a snapshot dated by late completion rather than its answer during $label", async ({ before, after }) => {
    vi.setSystemTime(new Date(after));
    writeSurfaceSnapshot(url, answer("previous", before));
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(answer("current", after)));
    const onResult = vi.fn();
    const result = await loadWhatsOnTonight({ ...options, fetchImpl, onResult });
    expect(result.rows.map((row) => row.id)).toEqual(["current"]);
    expect(onResult.mock.calls.map((call) => call[1])).toEqual(["network"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(nights)("reports an error when the server keeps answering for the previous service night during $label", async ({ before, after }) => {
    vi.setSystemTime(new Date(after));
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(answer("previous", before)));
    const onResult = vi.fn();
    const pending = loadWhatsOnTonight({ ...options, fetchImpl, onResult });
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).status).toBe("error");
    expect(onResult).not.toHaveBeenCalled();
    expect(readSurfaceSnapshot(url)).toBeUndefined();
  });
});

it("still joins a same-night read made by another surface when one caller cancels", async () => {
  vi.setSystemTime(new Date(nights[0].before));
  let release = (_response: Response) => {};
  const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const gone = vi.fn();
  const earlier = loadSurfaceJson(variants[0].url, { fetchImpl, signal: controller.signal }, gone);
  await vi.advanceTimersByTimeAsync(0);
  const current = loadWhatsOnTonight({ fetchImpl });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  release(Response.json(answer("current", nights[0].before)));
  expect((await current).rows.map((row) => row.id)).toEqual(["current"]);
  await earlier;
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(gone).not.toHaveBeenCalled();
});

it.each([undefined, null, "invalid", 0])("does not publish or cache an answer with unusable servedAt %s", async (servedAt) => {
  vi.setSystemTime(new Date(nights[0].after));
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(answer("undated", servedAt)));
  const onResult = vi.fn();
  const pending = loadWhatsOnTonight({ fetchImpl, onResult });
  await vi.advanceTimersByTimeAsync(50);
  expect((await pending).status).toBe("error");
  expect(onResult).not.toHaveBeenCalled();
  expect(readSurfaceSnapshot(variants[0].url)).toBeUndefined();
});

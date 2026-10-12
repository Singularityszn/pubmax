import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { loadWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { DEVICE_IDENTITY_CHANGED_EVENT } from "@/lib/deviceAccountIdentity";

const body = {
  get servedAt() { return new Date(Date.now()).toISOString(); },
  rows: [],
  sourceObservedAt: "2026-10-07T09:00:00.000Z",
  sourceFreshnessKind: "dataset-generated",
  kindObservedAt: { quiz: "2026-10-07T09:00:00.000Z" },
};

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T21:00:00.000Z"));
});

afterEach(() => {
  clearSurfaceCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reuses an anonymous answer for a tab return after ten seconds without redating its source", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
  const first = await loadWhatsOnTonight({ fetchImpl });
  vi.advanceTimersByTime(10_000);
  const second = await loadWhatsOnTonight({ fetchImpl });
  expect(second).toEqual(first);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("revalidates after one minute", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
  await loadWhatsOnTonight({ fetchImpl });
  vi.advanceTimersByTime(60_001);
  await loadWhatsOnTonight({ fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("keeps pub-only results separate from the map's public list", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (url: RequestInfo | URL) => Response.json({
    ...body,
    sourceObservedAt: String(url).includes("pubOnly=1") ? "2026-10-07T10:00:00.000Z" : body.sourceObservedAt,
  }));
  const map = await loadWhatsOnTonight({ fetchImpl });
  const pubs = await loadWhatsOnTonight({ fetchImpl, pubOnly: true });
  vi.advanceTimersByTime(10_000);
  expect(await loadWhatsOnTonight({ fetchImpl })).toEqual(map);
  expect(await loadWhatsOnTonight({ fetchImpl, pubOnly: true })).toEqual(pubs);
  expect(pubs.sourceObservedAt).not.toEqual(map.sourceObservedAt);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("revalidates coarse location reads after five seconds and never sends raw coordinates", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
  const near = { lat: 51.51234567, lng: -0.12345678 };
  await loadWhatsOnTonight({ fetchImpl, near });
  vi.advanceTimersByTime(10_000);
  await loadWhatsOnTonight({ fetchImpl, near });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const url = String(fetchImpl.mock.calls[0]?.[0]);
  expect(url).not.toContain("51.51234567");
  expect(url).not.toContain("-0.12345678");
});

it.each([
  ["BST", "2026-10-08T02:59:50.000Z"],
  ["spring clock change", "2026-03-29T02:59:50.000Z"],
  ["autumn clock change", "2026-10-25T03:59:50.000Z"],
])("does not paint the previous night's answer across London's 04:00 boundary during %s", async (_label, instant) => {
  vi.setSystemTime(new Date(instant));
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
  await loadWhatsOnTonight({ fetchImpl, maxAgeMs: 10 * 60_000 });
  vi.advanceTimersByTime(20_000);
  const onResult = vi.fn();
  await loadWhatsOnTonight({ fetchImpl, maxAgeMs: 10 * 60_000, onResult });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(onResult.mock.calls.map((call) => call[1])).toEqual(["network"]);
  expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
    "/api/whats-on?window=tonight&limit=60",
    "/api/whats-on?window=tonight&limit=60",
  ]);
});

it("bypasses a fresh answer for explicit retry", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
  await loadWhatsOnTonight({ fetchImpl });
  await loadWhatsOnTonight({ fetchImpl, fresh: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each([
  { label: "public", options: {} },
  { label: "pub-only", options: { pubOnly: true } },
  { label: "near", options: { near: { lat: 51.51234567, lng: -0.12345678 } } },
  { label: "near pub-only", options: { near: { lat: 51.51234567, lng: -0.12345678 }, pubOnly: true } },
])("retains the fresh $label retry answer after an earlier pending read finishes", async ({ options }) => {
  let answerEarlier: ((response: Response) => void) | undefined;
  const fetchImpl = vi.fn<typeof fetch>()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { answerEarlier = resolve; }))
    .mockResolvedValueOnce(Response.json({ ...body, sourceObservedAt: "2026-10-07T10:00:00.000Z" }));
  const earlier = loadWhatsOnTonight({ fetchImpl, ...options });
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  const onResult = vi.fn();
  const retried = await loadWhatsOnTonight({ fetchImpl, ...options, fresh: true, onResult });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(retried.sourceObservedAt).toBe("2026-10-07T10:00:00.000Z");
  answerEarlier?.(Response.json(body));
  expect((await earlier).sourceObservedAt).toBe(body.sourceObservedAt);
  expect(onResult).toHaveBeenCalledTimes(1);
  const returning = await loadWhatsOnTonight({ fetchImpl, ...options });
  expect(returning.sourceObservedAt).toBe(retried.sourceObservedAt);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("clears public answers when the account rotates", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
  await loadWhatsOnTonight({ fetchImpl });
  window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
  await loadWhatsOnTonight({ fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("never caches a fail-soft outage as an empty night", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ rows: [], error: "Could not check listings." }));
  expect((await loadWhatsOnTonight({ fetchImpl })).status).toBe("error");
  expect((await loadWhatsOnTonight({ fetchImpl })).status).toBe("error");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("does not fetch or publish after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
  const onResult = vi.fn();
  await loadWhatsOnTonight({ fetchImpl, signal: controller.signal, onResult });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(onResult).not.toHaveBeenCalled();
});

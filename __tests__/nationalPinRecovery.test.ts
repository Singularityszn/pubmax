import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PIN_PAINT_RETRY_NOTICE,
  pinRetryPendingNotice,
  pinRetrySpentNotice,
  venueDataFailureNotice,
  venueRetryMayDispatch,
} from "@/components/map/canvas/pinRevealCoordinator";

const canvas = readFileSync(join(process.cwd(), "components/PubMapCanvas.tsx"), "utf8");

// Execute the canvas's recovery closures, including the Retry timer, against a
// painted national basemap whose pub source can independently stall or recover.
function recoveryHarness() {
  const start = canvas.indexOf("    const hasPinsPaintable = () => {");
  const end = canvas.indexOf("    const markBasemapRecovered = () => {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  let sourcePresent = true;
  let sourceLoaded = false;
  let notice: unknown = PIN_PAINT_RETRY_NOTICE;
  const venueDataReadyRef = { current: true };
  const source = { setData: vi.fn() };
  const map = {
    getSource: () => sourcePresent ? source : undefined,
    isSourceLoaded: () => sourceLoaded,
    triggerRepaint: vi.fn(),
  };
  const armPinNoticeRef: { current?: () => void } = {};
  const pinRetryRef: { current?: (kind: string) => void } = {};
  const context = {
    nationalBrowse: true,
    basemapTileReadyForPaint: true,
    venueDataReadyRef,
    venueDataFailedRef: { current: false },
    venueRetrySpentRef: { current: false },
    venueRetryInFlightRef: { current: false },
    styleStructureReadyRef: { current: true },
    pubsDataRef: { current: { type: "FeatureCollection", features: [] } },
    mapRef: { current: map }, map, armPinNoticeRef, pinRetryRef,
    onReloadVenueDataRef: { current: vi.fn() },
    PIN_PAINT_RETRY_NOTICE, pinRetryPendingNotice, pinRetrySpentNotice,
    venueDataFailureNotice, venueRetryMayDispatch,
    PIN_RETRY_WAIT_MS: 10,
    setTimeout, clearTimeout,
    setSoftRetry: (next: unknown) => {
      notice = typeof next === "function" ? next(notice) : next;
    },
    recover: undefined as undefined | (() => void),
  };
  runInNewContext(ts.transpileModule(
    `${canvas.slice(start, end)}\nglobalThis.recover = markPinsRecovered;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText, context);
  armPinNoticeRef.current?.();
  return {
    context, source, retry: () => pinRetryRef.current?.("pins"),
    recover: () => context.recover?.(), notice: () => notice,
    setSourceLoaded: (loaded: boolean) => { sourceLoaded = loaded; },
    setSourcePresent: (present: boolean) => { sourcePresent = present; },
  };
}

afterEach(() => vi.useRealTimers());

describe("pin recovery after national overview", () => {
  it("keeps missing pub-source feedback after basemap paint and a spent retry", () => {
    vi.useFakeTimers();
    const h = recoveryHarness();
    h.recover();
    expect(h.notice()).toEqual(PIN_PAINT_RETRY_NOTICE);
    h.retry();
    expect(h.source.setData).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10);
    expect(h.notice()).toEqual(pinRetrySpentNotice("pins"));
    h.setSourceLoaded(true);
    h.recover();
    expect(h.notice()).toBeNull();
  });

  it("requires both settled venue data and a present loaded pub source", () => {
    const h = recoveryHarness();
    h.setSourceLoaded(true);
    h.context.venueDataReadyRef.current = false;
    h.recover();
    expect(h.notice()).toEqual(PIN_PAINT_RETRY_NOTICE);
    h.context.venueDataReadyRef.current = true;
    h.setSourcePresent(false);
    h.recover();
    expect(h.notice()).toEqual(PIN_PAINT_RETRY_NOTICE);
    h.setSourcePresent(true);
    h.recover();
    expect(h.notice()).toBeNull();
  });
});

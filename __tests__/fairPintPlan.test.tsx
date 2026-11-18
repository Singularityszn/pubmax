// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useFairPintPlan, warmFairPintTime } from "@/components/map/fairpint/useFairPintPlan";
import FairPintResultFallback from "@/components/map/fairpint/FairPintResultFallback";
import type { FairPintGenerated } from "@/lib/fairPint";
import { fairPintDrawPending, waitForFairPintDraw } from "@/lib/mapFirstVisitArrivalGate";
import { inferNightContext } from "@/lib/nightPlanning";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function generated(operationKey: string) { return { operationKey, groundingProof: "fixture-proof", inferredContext: inferNightContext("three stops in Camden").context, planningConfidence: { level: "low", warnings: [], missingEvidence: [], provenance: [], score: 0, routeReady: false }, stops: [1, 2, 3].map((id) => ({ venueId: `venue-${id}`, venueName: `Pub ${id}` })) }; }
it("keeps only the newest draw even if the cancelled request answers late", async () => {
  let first!: (value: Response) => void, second!: (value: Response) => void;
  let beganFirst!: () => void, beganSecond!: () => void;
  const firstStarted = new Promise<void>((resolve) => { beganFirst = resolve; }), secondStarted = new Promise<void>((resolve) => { beganSecond = resolve; });
  const fetcher = vi.fn().mockImplementationOnce(() => { beganFirst(); return new Promise<Response>((resolve) => { first = resolve; }); }).mockImplementationOnce(() => { beganSecond(); return new Promise<Response>((resolve) => { second = resolve; }); });
  vi.stubGlobal("fetch", fetcher);
  let hook: ReturnType<typeof useFairPintPlan>;
  const onGenerated = vi.fn();
  function Host() { hook = useFairPintPlan("london", "camden", onGenerated); return null; }
  const root = createRoot(document.createElement("div")); act(() => root.render(createElement(Host)));
  await act(async () => {
    const old = hook.draw(550); await firstStarted;
    const latest = hook.draw(600); await secondStarted;
    second(Response.json(generated("latest-operation"))); await latest;
    first(Response.json(generated("old-operation"))); await old;
  });
  expect(hook!.state.last?.generated.operationKey).toBe("latest-operation");
  expect(hook!.state.last?.pence).toBe(600);
  act(() => hook!.lineReady("old-operation"));
  expect(onGenerated).not.toHaveBeenCalled();
  act(() => hook!.lineReady("latest-operation"));
  expect(onGenerated).toHaveBeenCalledTimes(1);
  expect(onGenerated.mock.calls[0]?.[0].operationKey).toBe("latest-operation");
  act(() => root.unmount());
});
it("keeps the last route but rejects a cleared first-pint time", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(generated("valid-operation")));
  vi.stubGlobal("fetch", fetcher);
  let hook: ReturnType<typeof useFairPintPlan>;
  function Host() { hook = useFairPintPlan("london", "camden", () => {}); return null; }
  const root = createRoot(document.createElement("div")); act(() => root.render(createElement(Host)));
  await act(async () => { await hook.draw(550); });
  const route = hook!.state.last;
  await act(async () => { await hook.changeStart(""); });
  expect(hook!.start).toBe(""); expect(hook!.state.last).toBe(route); expect(hook!.state.error).not.toBe("");
  expect(fetcher).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it("honours Retry-After for time edits and draws, then validates the latest selected time", async () => {
  await warmFairPintTime();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(generated("original")))
    .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": "30" } }))
    .mockResolvedValueOnce(Response.json(generated("revalidated")));
  vi.stubGlobal("fetch", fetcher);
  let hook: ReturnType<typeof useFairPintPlan>;
  function Host() { hook = useFairPintPlan("london", "camden", () => {}); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  try {
    await act(async () => { await hook.draw(550); });
    const last = hook!.state.last!;
    act(() => hook!.lineReady("original"));
    await act(async () => { await hook.changeStart("2026-11-18T18:00"); });
    expect(hook!.state.error).toBe("Too many plans just now. Try again in a minute.");
    act(() => hook!.editStart("2026-11-18T19:00"));
    await act(async () => { await hook.changeStart("2026-11-18T19:00"); });
    await act(async () => { await hook.draw(600); });
    act(() => hook!.back());
    await act(async () => { await hook.draw(600); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(hook!.state.last).toBe(last);
    expect(hook!.retrying).toBe(true);
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(hook!.retrying).toBe(false);
    await act(async () => { await hook.changeStart("2026-11-18T19:00"); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(hook!.state.last).toMatchObject({ start: "2026-11-18T19:00", startIso: "2026-11-18T19:00:00.000Z", generated: { operationKey: "revalidated" } });
    expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toMatchObject({ planStartIso: "2026-11-18T19:00:00.000Z" });
  } finally { act(() => root.unmount()); }
});

it.each(["pending", "failed"])("restores the validated time after a %s revalidation", async (mode) => {
  let finish!: (response: Response) => void, began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  const response = new Promise<Response>((resolve) => { finish = resolve; });
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(generated("validated"))).mockImplementationOnce(() => {
    began();
    return mode === "pending" ? response : Response.json({ error: "No route at this time." }, { status: 422 });
  });
  vi.stubGlobal("fetch", fetcher);
  let hook: ReturnType<typeof useFairPintPlan>;
  function Host() { hook = useFairPintPlan("london", "camden", () => {}); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  await act(async () => { await hook.draw(550); });
  const last = hook!.state.last!;
  const later = new Date(new Date(`${last.start}:00Z`).getTime() + 3600000).toISOString().slice(0, 16);
  let request!: Promise<void>;
  await act(async () => {
    hook.editStart(later); request = hook.changeStart(later); await started;
    if (mode === "failed") await request;
  });
  act(() => hook!.editStart(last.start));
  expect(hook!.start).toBe(last.start);
  expect(hook!.state).toMatchObject({ phase: "result", error: "", last });
  if (mode === "pending") await act(async () => { finish(Response.json(generated("superseded"))); await request; });
  expect(hook!.state.last).toBe(last);
  expect(fetcher).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
});

it.each([1900, 2100])("releases map reads but waits for the result after a %ims response", async (responseMs) => {
  await warmFairPintTime(); vi.useFakeTimers();
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  let hook: ReturnType<typeof useFairPintPlan>;
  let drawing!: Promise<void>;
  const applied = vi.fn();
  function Host() { hook = useFairPintPlan("london", "camden", applied); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  try {
    act(() => { drawing = hook.draw(550); });
    expect(fairPintDrawPending()).toBe(true);
    const reader = waitForFairPintDraw();
    await act(async () => {
      vi.advanceTimersByTime(responseMs);
      finish(Response.json(generated("delayed-result")));
      await drawing;
    });
    expect(hook!.state.last?.generated.operationKey).toBe("delayed-result");
    expect(applied).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(fairPintDrawPending()).toBe(false);
    await reader;
    expect(applied).not.toHaveBeenCalled();
    act(() => hook!.lineReady("delayed-result"));
    expect(applied).toHaveBeenCalledOnce();
    expect(applied.mock.calls[0]?.[0].operationKey).toBe("delayed-result");
    act(() => hook!.lineReady("delayed-result"));
    expect(applied).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); }
});

it.each(["back", "edit", "unmount"])("ignores delayed readiness after %s", async (action) => {
  await warmFairPintTime(); vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(generated("obsolete-result"))));
  let hook: ReturnType<typeof useFairPintPlan>;
  const applied = vi.fn();
  function Host() { hook = useFairPintPlan("london", "camden", applied); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  try {
    await act(async () => { await hook.draw(550); vi.advanceTimersByTime(2000); });
    act(() => {
      if (action === "back") hook!.back();
      else if (action === "edit") hook!.editStart("");
      else root.unmount();
      hook!.lineReady("obsolete-result");
    });
    expect(applied).not.toHaveBeenCalled();
    expect(fairPintDrawPending()).toBe(false);
  } finally { if (action !== "unmount") act(() => root.unmount()); }
});

it("activates the fallback route only after its result surface mounts", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(generated("fallback-result"))));
  let hook: ReturnType<typeof useFairPintPlan>;
  const applied = vi.fn((_value: FairPintGenerated) => { expect(document.querySelector(".fairPintResultFallback")).not.toBeNull(); });
  function Host() {
    hook = useFairPintPlan("london", "camden", applied);
    return hook.state.last
      ? createElement(FairPintResultFallback, { last: hook.state.last, onBack: hook.back, onLineReady: hook.lineReady })
      : null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Host)));
  try {
    expect(applied).not.toHaveBeenCalled();
    await act(async () => { await hook.draw(550); });
    expect(applied).toHaveBeenCalledOnce();
    expect(applied.mock.calls[0]?.[0].operationKey).toBe("fallback-result");
    expect(fairPintDrawPending()).toBe(false);
  } finally { act(() => root.unmount()); container.remove(); }
});

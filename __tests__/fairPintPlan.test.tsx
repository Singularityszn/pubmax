// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useFairPintPlan } from "@/components/map/fairpint/useFairPintPlan";
import { inferNightContext } from "@/lib/nightPlanning";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());
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

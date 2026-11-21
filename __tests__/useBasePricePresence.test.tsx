/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: Root;
let host: HTMLDivElement;
let usePresence: typeof import("@/components/map/pubmap/useBasePricePresence").useBasePricePresence;
function View({ ids, evidence }: { ids: string[]; evidence: Map<string, string> }) {
  const result = usePresence(ids, evidence);
  return createElement("output", null, ids.map((id) => result.get(id) ?? "unknown").join(","));
}
beforeEach(async () => {
  vi.resetModules();
  usePresence = (await import("@/components/map/pubmap/useBasePricePresence")).useBasePricePresence;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("reuses completed base-pub reads and refreshes changed evidence", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const ids = new URL(String(input), "http://localhost").searchParams.getAll("venueId");
    return Response.json({ presence: Object.fromEntries(ids.map((id) => [id, "absent"])) });
  });
  vi.stubGlobal("fetch", fetcher);
  const ids = Array.from({ length: 250 }, (_, index) => `venue-uk-n${index}`);
  const evidence = new Map(ids.map((id) => [id, "unchanged"]));
  await act(async () => root.render(createElement(View, { ids, evidence })));
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(host.textContent?.split(",")[0]).toBe("absent");
  await act(async () => root.render(createElement(View, { ids: [...ids].reverse(), evidence })));
  expect(fetcher).toHaveBeenCalledTimes(3);
  const changed = new Map(evidence);
  changed.set(ids[0]!, "new price");
  await act(async () => root.render(createElement(View, { ids, evidence: changed })));
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("does not cache unknown reads", async () => {
  const fetcher = vi.fn(async () => Response.json({ presence: {} }));
  vi.stubGlobal("fetch", fetcher);
  const ids = ["venue-uk-n1"];
  const evidence = new Map([[ids[0]!, "unchanged"]]);
  await act(async () => root.render(createElement(View, { ids, evidence })));
  expect(host.textContent).toBe("unknown");
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(View, { ids, evidence })));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

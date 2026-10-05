import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error - plain .mjs CLI helper has no declaration file.
import { monthPlacesRequests, setDailyOverrides } from "../scripts/lib/googlePlacesQuota.mjs";
import { defined } from "@/__tests__/helpers/defined";

afterEach(() => vi.unstubAllGlobals());

it("counts only Details usage for UK verification and all requests for other jobs", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ timeSeries: [
      { resource: { labels: { method: "google.maps.places.v1.Places.GetPlace" } }, points: [{ value: { int64Value: "12" } }] },
      { resource: { labels: { method: "google.maps.places.v1.Places.SearchText" } }, points: [{ value: { int64Value: "80" } }] },
    ] }));
  });
  expect(await monthPlacesRequests("test-token", true)).toBe(12);
  expect(new URL(defined(urls[0])).searchParams.has("aggregation.crossSeriesReducer")).toBe(false);
  expect(await monthPlacesRequests("test-token")).toBe(92);
  expect(new URL(defined(urls[1])).searchParams.get("aggregation.crossSeriesReducer")).toBe("REDUCE_SUM");
});

it("preserves default quota request reason and accepts the hours job reason", async () => {
  const reasons: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, options: { headers: Record<string, string> }) => {
    reasons.push(defined(options.headers["X-Goog-Request-Reason"]));
    return new Response(JSON.stringify({ done: true }));
  });
  await setDailyOverrides("test-token", 10, 20);
  await setDailyOverrides("test-token", 10, 20, "london-pub-hours-verify");
  expect(reasons).toEqual(["london-osm-places-verify", "london-pub-hours-verify"]);
});

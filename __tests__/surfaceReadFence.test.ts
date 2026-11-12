// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConditionsChip from "@/components/desktop/ConditionsChip";
import { useTonightLaneCue } from "@/components/map/usePersonaTonight";
import { loadWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import VenueTonightChips from "@/components/map/VenueTonightChips";
import TonightAnswerCards from "@/components/tonight/TonightAnswerCards";
import { useTonightAnswers } from "@/components/tonight/useTonightAnswers";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

describe("Tonight selected-detail exemption behaviour", () => {
  const digest = "abcdefghijklmnopqrstuv";
  const origin = { lat: 51.51, lng: -0.13 };
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let reply: (response: Response) => void;
  let reject: (error: Error) => void;
  let signal: AbortSignal | undefined;
  let detailRequests: string[];
  const cityRows = [{ venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 5, chain: null,
    drinkLabel: "City lager", servingSize: "Pint", publisher: { label: "City menu", url: "https://city.example/menu" }, observedAt: "2026-07-04" }];

  function Probe({ area = false, located = true }: { area?: boolean; located?: boolean }) {
    const answers = useTonightAnswers({
      origin: located && !area ? origin : null,
      tonightNear: located && area ? { patchLabel: "Soho", near: origin } : null,
      listingRows: [], listingsStateKind: "refreshing", selectableVenueIds: new Set<string>(),
      cheapPints: cityRows, renderedAt: 1793707200000,
    });
    return createElement(TonightAnswerCards, { ...answers, onShareLocation: () => undefined });
  }

  async function render(props: Parameters<typeof Probe>[0] = {}) {
    await act(async () => root.render(createElement(Probe, props)));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(container.querySelector('[data-testid="tonight-answer-cheapest"]')?.textContent)
        .toContain(props.located === false ? "City Arms" : "Near Arms");
    });
  }

  function detail(overrides: Record<string, unknown> = {}): Response {
    return { ok: true, json: async () => ({ priceDatasetDigest: digest,
      venue: { id: "near", prices: [
        { price_gbp: 4.5, pint_name: "Selected lager", measure: "pint", pub_url: "https://selected.example/menu", scraped_at_values: "2026-07-03T12:00:00Z" },
        { price_gbp: 4.5, pint_name: "Other lager", measure: "pint", pub_url: "https://other.example/menu", scraped_at_values: "2026-07-04T12:00:00Z" },
      ] }, ...overrides,
    }) } as Response;
  }

  function expectUnavailable() {
    const card = container.querySelector('[data-testid="tonight-answer-cheapest"]');
    expect(card?.textContent).toContain("Near Arms");
    expect(card?.textContent).toContain("Drink unavailable");
    expect(card?.textContent).toContain("Serving unavailable");
    expect(card?.textContent).toContain("Publisher not recorded");
    expect(card?.textContent).toContain("Read date not recorded");
    expect(card?.textContent).not.toContain("Slim lager");
    expect(card?.textContent).not.toContain("Slim menu");
    expect(card?.querySelector("time")).toBeNull();
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearSurfaceCache();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    detailRequests = [];
    signal = undefined;
    const held = new Promise<Response>((resolve, fail) => { reply = resolve; reject = fail; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split("?")[0];
      if (path?.startsWith("/api/venue/")) {
        detailRequests.push(path);
        signal = init?.signal ?? undefined;
        return held;
      }
      if (path === "/data/venues_slim.manifest.json") return { ok: true, json: async () => ({
        version: 2, priceDatasetDigest: digest,
        grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
        shards: [{ id: "core", core: true, url: "/data/venues_slim.core.json", count: 1, bbox: [-0.2, 51.45, 0, 51.55] }],
      }) } as Response;
      if (path === "/data/venues_slim.core.json") return { ok: true, json: async () => ({ d: digest, rows: [{
        id: "near", name: "Near Arms", lat: origin.lat, lng: origin.lng, borough: "Soho", cheapestPrice: 4.5,
        priceSource: "Slim menu", priceSourceUrl: "https://slim.example/menu", priceObservedAt: "2026-07-03",
        cheapestPint: "Slim lager", measure: "pint",
      }] }) } as Response;
      return { ok: true, json: async () => ({ rows: [] }) } as Response;
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearSurfaceCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("withholds all nearby facts until matching detail succeeds, area=%s", async (area) => {
    await render({ area });
    expectUnavailable();
    expect(detailRequests).toEqual(["/api/venue/near"]);
    await act(async () => { reply(detail()); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const card = container.querySelector('[data-testid="tonight-answer-cheapest"]');
    expect(card?.textContent).toContain("Selected lager");
    expect(card?.textContent).toContain("3 Jul 2026");
    expect(card?.querySelector('a[href="https://selected.example/menu"]')).not.toBeNull();
    expect(card?.textContent).not.toContain("Other lager");
  });

  it.each(["failed", "http", "snapshot", "venue", "missing"])("keeps facts unavailable after a %s detail read", async (failure) => {
    await render();
    await act(async () => {
      if (failure === "failed") reject(new Error("offline"));
      else if (failure === "http") reply({ ok: false } as Response);
      else if (failure === "snapshot") reply(detail({ priceDatasetDigest: "other" }));
      else if (failure === "venue") reply(detail({ venue: { id: "other", prices: [{ pint_name: "Wrong lager" }] } }));
      else reply(detail({ venue: { id: "near", prices: [] } }));
    });
    expectUnavailable();
  });

  it("cancels detail when the nearby winner disappears and preserves city evidence", async () => {
    await render();
    expect(signal?.aborted).toBe(false);
    await render({ located: false });
    expect(signal?.aborted).toBe(true);
    await act(async () => { reply(detail()); });
    expect(container.textContent).toContain("City lager");
    expect(container.textContent).toContain("4 Jul 2026");
    expect(container.textContent).not.toContain("Selected lager");
    expect(container.querySelector('a[href="https://city.example/menu"]')).not.toBeNull();
  });

  it("cancels the selected read on unmount", async () => {
    await render();
    expect(signal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    await act(async () => { reply(detail()); });
    root = createRoot(container);
    expect(container.textContent).toBe("");
  });
});

describe("painted read reuse", () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T19:00:00Z"));
    clearSurfaceCache();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearSurfaceCache();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function WeatherReader() {
    const cue = useTonightLaneCue(true);
    return createElement("output", null, cue.gardenCue);
  }

  it("shares conditions between the map chip and persona, including a return visit", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({ summary: {
        drinkLine: "Warm enough for the garden.", factsLine: "18°C, dry.",
        dateLabel: "Today", stale: false,
      } });
    });
    const readers = () => createElement("div", null,
      createElement(ConditionsChip), createElement(WeatherReader));

    await act(async () => root.render(readers()));
    expect(container.querySelector(".conditionsChip")?.textContent).toContain("18°C, dry.");
    expect(container.querySelector("output")?.textContent).toBe("Warm enough for the garden.");
    expect(requests).toEqual(["/api/tonight-conditions"]);

    await act(async () => root.render(null));
    await act(async () => root.render(readers()));
    expect(container.querySelector("output")?.textContent).toBe("Warm enough for the garden.");
    expect(container.querySelector(".conditionsChip")?.textContent).toContain("18°C, dry.");
    expect(requests).toEqual(["/api/tonight-conditions"]);
  });

  it("shares a live listings answer between the map loader and venue chips", async () => {
    const requests: string[] = [];
    const listing = {
      id: "quiz-1", venueId: "v1", placeName: "The Test Arms", kind: "quiz",
      startsAt: new Date().toISOString(), title: "Quiz night",
      source: { label: "Venue", url: "https://example.com/quiz" },
      observedAt: new Date().toISOString(), confidence: "listed",
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({ rows: [listing], servedAt: new Date().toISOString() });
    });

    const result = await loadWhatsOnTonight();
    expect(result.status).toBe("ready");
    expect(result.rows).toEqual([listing]);
    await act(async () => root.render(createElement(VenueTonightChips, {
      id: "v1", name: "The Test Arms",
    })));
    expect(container.textContent).toContain("Quiz");
    expect(requests).toEqual(["/api/whats-on?window=tonight&limit=60"]);
  });
});

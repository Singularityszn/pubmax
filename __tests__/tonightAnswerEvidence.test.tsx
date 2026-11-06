// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TonightAnswerCards from "@/components/tonight/TonightAnswerCards";
import { tonightCheapestAnswer } from "@/lib/tonightAnswers";
import { useTonightPintEvidence } from "@/components/tonight/useTonightAnswerReads";

const mounted: Array<ReturnType<typeof createRoot>> = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(cheapest: ReturnType<typeof tonightCheapestAnswer>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => root.render(createElement(TonightAnswerCards, {
    cheapest, listing: null, regular: null, lastTrain: { status: "no-location" },
    onShareLocation: () => undefined,
  })));
  return container.querySelector('[data-testid="tonight-answer-cheapest"]') as HTMLElement;
}

describe("Tonight's selected pint evidence", () => {
  it("shows the chosen city's drink, serving, publisher link and full read day", async () => {
    const cheapest = tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [{
      venueId: "selected", name: "Selected Arms", borough: "Soho", priceGbp: 4.5, chain: null,
      drinkLabel: "House Lager", servingSize: "Pint", publisher: { label: "The menu", url: "https://example.org/menu" }, observedAt: "2026-10-02T12:00:00Z",
    }] });
    const card = await show(cheapest);
    expect(card.textContent).toContain("House Lager");
    expect(card.textContent).toContain("Pint");
    expect(card.textContent).toContain("The menu");
    expect(card.querySelector('a[href="https://example.org/menu"]')?.textContent).toBe("The menu");
    expect(card.textContent).toContain("2 Oct 2026");
  });

  it("states unavailable evidence for a nearby selected row without borrowing city facts", async () => {
    const cheapest = tonightCheapestAnswer({ origin: { lat: 51.51, lng: -0.13 }, patch: null,
      nearby: [{ id: "near", name: "Near Arms", lat: 51.51, lng: -0.13, cheapestPrice: 4.5, priceSource: "Near source", priceObservedAt: "2026-07-03" }],
      cityRows: [{ venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 4.5, chain: null,
        drinkLabel: "Other lager", servingSize: "Pint", publisher: { label: "Other menu", url: "https://example.org/other" }, observedAt: "2026-10-02" }],
    });
    const card = await show(cheapest);
    expect(card.textContent).toContain("Drink unavailable");
    expect(card.textContent).toContain("Serving unavailable");
    expect(card.textContent).toContain("Publisher not recorded");
    expect(card.textContent).not.toContain("Near source");
    expect(card.textContent).toContain("Read date not recorded");
    expect(card.textContent).not.toContain("3 Jul 2026");
    expect(card.textContent).not.toContain("Other menu");
    expect(card.textContent).not.toContain("Other lager");
  });

  it("states missing publisher and date on a legacy city row", async () => {
    const cheapest = tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [{
      venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 4.5, chain: null,
    }] });
    const card = await show(cheapest);
    expect(card.textContent).toContain("Publisher not recorded");
    expect(card.textContent).toContain("Read date not recorded");
  });

  it("does not link an unsafe publisher URL", async () => {
    const cheapest = tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [{
      venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 4.5, chain: null,
      publisher: { label: "Menu", url: "javascript:alert(1)" },
    }] });
    const card = await show(cheapest);
    expect(card.textContent).toContain("Menu (link unavailable)");
    expect(card.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("uses only the first selected detail row when snapshot identities agree", async () => {
    const digest = "abcdefghijklmnopqrstuv";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      priceDatasetDigest: digest,
      venue: { id: "near", prices: [
        { price_gbp: 4.5, pint_name: "First lager", measure: "pint", pub_url: "https://first.example/menu", scraped_at_values: "2026-07-03T12:00:00Z" },
        { price_gbp: 4.5, pint_name: "Other lager", measure: "pint", pub_url: "https://other.example/menu", scraped_at_values: "2026-10-02T12:00:00Z" },
      ] },
    }) }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push(root);
    function Probe() {
      const evidence = useTonightPintEvidence("near", digest);
      return createElement("span", null, evidence ? JSON.stringify(evidence) : "waiting");
    }
    await act(async () => { root.render(createElement(Probe)); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.textContent).toContain("First lager");
    expect(container.textContent).toContain("https://first.example/menu");
    expect(container.textContent).toContain("2026-07-03");
    expect(container.textContent).not.toContain("Other lager");
  });

  it("refuses a detail response from a different snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      priceDatasetDigest: "other", venue: { id: "near", prices: [{ pint_name: "Wrong lager" }] },
    }) }));
    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(root);
    function Probe() {
      const evidence = useTonightPintEvidence("near", "abcdefghijklmnopqrstuv");
      return createElement("span", null, evidence ? JSON.stringify(evidence) : "waiting");
    }
    await act(async () => { root.render(createElement(Probe)); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.textContent).toBe("waiting");
  });

  it("does not let a late response replace the new winner's evidence", async () => {
    const digest = "abcdefghijklmnopqrstuv";
    let finishFirst: (response: unknown) => void = () => undefined;
    const first = new Promise((resolve) => { finishFirst = resolve; });
    const body = (id: string, name: string) => ({ ok: true, json: async () => ({
      priceDatasetDigest: digest, venue: { id, prices: [{ pint_name: name }] },
    }) });
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => first).mockResolvedValueOnce(body("second", "Second lager")));
    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(root);
    function Probe({ id }: { id: string }) {
      const evidence = useTonightPintEvidence(id, digest);
      return createElement("span", null, evidence?.drinkLabel ?? "waiting");
    }
    await act(async () => root.render(createElement(Probe, { id: "first" })));
    await act(async () => { root.render(createElement(Probe, { id: "second" })); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.textContent).toBe("Second lager");
    await act(async () => { finishFirst(body("first", "First lager")); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.textContent).toBe("Second lager");
  });
});


describe("selected evidence request lifetime", () => {
  const digest = "abcdefghijklmnopqrstuv";
  const otherDigest = "zyxwvutsrqponmlkjihgfed";

  it.each(["venue", "snapshot"])("retires an earlier %s request before a late response", async (change) => {
    const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => pending.push({ signal: init?.signal as AbortSignal, resolve })),
    ));
    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(root);
    function Probe({ id, snapshot }: { id: string; snapshot: string }) {
      const evidence = useTonightPintEvidence(id, snapshot);
      return createElement("span", null, evidence?.drinkLabel ?? "unavailable");
    }
    const response = (id: string, snapshot: string, name: string) => ({ ok: true, json: async () => ({
      priceDatasetDigest: snapshot, venue: { id, prices: [{ pint_name: name }] },
    }) } as Response);
    await act(async () => root.render(createElement(Probe, { id: "near", snapshot: digest })));
    const first = pending[0];
    expect(first).toBeDefined();
    const nextId = change === "venue" ? "other" : "near";
    const nextDigest = change === "snapshot" ? otherDigest : digest;
    await act(async () => root.render(createElement(Probe, { id: nextId, snapshot: nextDigest })));
    expect(first?.signal.aborted).toBe(true);
    await act(async () => { pending[1]?.resolve(response(nextId, nextDigest, "Current lager")); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toBe("Current lager");
    await act(async () => { first?.resolve(response("near", digest, "Stale lager")); });
    expect(container.textContent).toBe("Current lager");
  });

  it.each(["venue", "snapshot"])("does not reuse evidence after a failed return to the same %s", async (change) => {
    const body = { ok: true, json: async () => ({ priceDatasetDigest: digest,
      venue: { id: "near", prices: [{ pint_name: "Old lager" }] },
    }) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(body).mockRejectedValue(new Error("offline")));
    const container = document.createElement("div");
    const root = createRoot(container);
    mounted.push(root);
    function Probe({ id, snapshot = digest }: { id: string | null; snapshot?: string }) {
      const evidence = useTonightPintEvidence(id, snapshot);
      return createElement("span", null, evidence?.drinkLabel ?? "unavailable");
    }
    await act(async () => root.render(createElement(Probe, { id: "near" })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toBe("Old lager");
    await act(async () => root.render(createElement(Probe, change === "venue" ? { id: null } : { id: "near", snapshot: otherDigest })));
    expect(container.textContent).toBe("unavailable");
    await act(async () => root.render(createElement(Probe, { id: "near" })));
    expect(container.textContent).toBe("unavailable");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HarvestMenuTransportError,
  createMenuPageHarvester,
  parseMenuTransportArg,
  refreshJobForTransport,
} from "@/scripts/lib/harvestMenuTransport.mjs";

const FIXTURE = readFileSync(
  join(process.cwd(), "__tests__/fixtures/harvest/greene-king-prospect-menu.md"),
  "utf8",
);

const GK_MENU =
  "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu";
const REFUSED_PRIVATE = "http://127.0.0.1/menu";

afterEach(() => {
  vi.useRealTimers();
});

describe("harvest menu transport", () => {
  it("parses --transport tavily from argv", () => {
    expect(parseMenuTransportArg(["node", "script.mjs", "--transport", "tavily"])).toBe("tavily");
    expect(parseMenuTransportArg(["node", "script.mjs"])).toBe("browserbase");
  });

  it("maps transports to refresh provider jobs", () => {
    expect(refreshJobForTransport("tavily")).toBe("plain-page");
    expect(refreshJobForTransport("browserbase")).toBe("rendered-menu");
  });

  it("refuses hosts sourcePolicy blocks before any provider call", async () => {
    const fetchImpl = vi.fn();
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
    });
    await expect(harvester.fetchMenuMarkdown(REFUSED_PRIVATE)).rejects.toMatchObject({
      code: "policy-refused",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches permitted Greene King menus through Tavily extract with crawl spacing", async () => {
    vi.useFakeTimers();
    const tavilyPayload = () =>
      Response.json({
        results: [{ url: GK_MENU, raw_content: FIXTURE }],
        failed_results: [],
      });
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(tavilyPayload()));
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      crawlDelayMs: 1000,
      extractBudget: 5,
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
    });

    const first = harvester.fetchMenuMarkdown(GK_MENU);
    await vi.advanceTimersByTimeAsync(0);
    await first;

    const second = harvester.fetchMenuMarkdown(GK_MENU);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.tavily.com/extract");
    expect(harvester.extractsSpent).toBe(2);
  });

  it("stops Tavily runs when the extract budget is spent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [{ url: GK_MENU, raw_content: FIXTURE }],
        failed_results: [],
      }),
    );
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      crawlDelayMs: 0,
      extractBudget: 1,
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
    });
    await harvester.fetchMenuMarkdown(GK_MENU);
    await expect(harvester.fetchMenuMarkdown(GK_MENU)).rejects.toBeInstanceOf(
      HarvestMenuTransportError,
    );
  });
});

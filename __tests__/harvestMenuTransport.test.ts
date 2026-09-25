import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HarvestMenuTransportError,
  assertLocalPolicyEnforcedTransport,
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
const ALLOWED_ROBOTS = async () => ({ allowed: true, reason: "allowed" as const, evidence: "test fixture" });

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

  it("requires local request interception for the soft-drinks lane", () => {
    expect(() => assertLocalPolicyEnforcedTransport("playwright")).not.toThrow();
    expect(() => assertLocalPolicyEnforcedTransport("tavily")).toThrow(
      expect.objectContaining({ code: "unsafe-transport" }),
    );
    expect(() => assertLocalPolicyEnforcedTransport("browserbase")).toThrow(
      expect.objectContaining({ code: "unsafe-transport" }),
    );
  });

  it("refuses hosts sourcePolicy blocks before any provider call", async () => {
    const fetchImpl = vi.fn();
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
      robotsChecker: ALLOWED_ROBOTS,
    });
    await expect(harvester.fetchMenuPage(REFUSED_PRIVATE)).rejects.toMatchObject({
      code: "policy-refused",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses protocol and chain mismatches before any provider call", async () => {
    const fetchImpl = vi.fn();
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      sourceId: "youngs-menu-prices",
      environment: { TAVILY_API_KEY: "test-key" },
      crawlDelayMs: 0,
      fetchImpl,
      robotsChecker: ALLOWED_ROBOTS,
    });

    await expect(
      harvester.fetchMenuPage("ftp://www.youngs.co.uk/our-pubs"),
    ).rejects.toMatchObject({ code: "policy-refused" });
    await expect(
      harvester.fetchMenuPage("https://www.slugandlettuce.co.uk/bars/soho/menus"),
    ).rejects.toMatchObject({ code: "policy-refused" });
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
      robotsChecker: ALLOWED_ROBOTS,
    });

    const first = harvester.fetchMenuPage(GK_MENU);
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ finalUrl: GK_MENU });

    const second = harvester.fetchMenuPage(GK_MENU);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.tavily.com/extract");
    expect(harvester.extractsSpent).toBe(2);
  });

  it("rejects a provider result that resolves outside the bound menu origin", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [{ url: "https://evil.example/menu", raw_content: FIXTURE }],
        failed_results: [],
      }),
    );
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      crawlDelayMs: 0,
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
      robotsChecker: ALLOWED_ROBOTS,
    });

    await expect(harvester.fetchMenuPage(GK_MENU)).rejects.toMatchObject({
      code: "policy-refused",
    });
  });

  it("fails closed when a menu page response omits its resolved URL", async () => {
    const harvester = createMenuPageHarvester({
      transport: "playwright",
      crawlDelayMs: 0,
      robotsChecker: ALLOWED_ROBOTS,
      fetchLocalPlaywrightMenuPage: (async () => ({
        markdown: FIXTURE,
        links: [],
      })) as never,
    });

    await expect(harvester.fetchMenuPage(GK_MENU)).rejects.toMatchObject({
      code: "missing-final-url",
    });
  });

  it("fails closed with a transport error when the resolved URL is not absolute", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [{ url: "/menu", raw_content: FIXTURE }],
        failed_results: [],
      }),
    );
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      crawlDelayMs: 0,
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
      robotsChecker: ALLOWED_ROBOTS,
    });

    await expect(harvester.fetchMenuPage(GK_MENU)).rejects.toMatchObject({
      code: "invalid-final-url",
    });
  });

  it("rechecks robots before returning a same-origin redirect landing", async () => {
    const finalUrl = `${GK_MENU}?canonical=1`;
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [{ url: finalUrl, raw_content: FIXTURE }],
        failed_results: [],
      }),
    );
    const robotsChecker = vi.fn(async (url: string) => ({
      allowed: url === GK_MENU,
      reason: url === GK_MENU ? ("allowed" as const) : ("robots-disallowed" as const),
      evidence: url === GK_MENU ? "requested URL allowed" : "redirect landing refused",
    }));
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      crawlDelayMs: 0,
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
      robotsChecker,
    });

    await expect(harvester.fetchMenuPage(GK_MENU)).rejects.toMatchObject({
      code: "robots-refused",
    });
    expect(robotsChecker).toHaveBeenCalledWith(GK_MENU);
    expect(robotsChecker).toHaveBeenCalledWith(finalUrl);
  });

  it("refuses live robots denial before contacting a provider", async () => {
    const fetchImpl = vi.fn();
    const harvester = createMenuPageHarvester({
      transport: "tavily",
      crawlDelayMs: 0,
      environment: { TAVILY_API_KEY: "test-key" },
      fetchImpl,
      robotsChecker: async () => ({ allowed: false, reason: "robots-disallowed" as const, evidence: "Disallow: /" }),
    });

    await expect(harvester.fetchMenuPage(GK_MENU)).rejects.toMatchObject({
      code: "robots-refused",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not let a menu host override a live robots refusal", async () => {
    const render = vi.fn();
    const harvester = createMenuPageHarvester({
      transport: "playwright",
      sourceId: "youngs-menu-prices",
      crawlDelayMs: 0,
      robotsChecker: async () => ({ allowed: false, reason: "robots-disallowed" as const, evidence: "Disallow: /" }),
      fetchLocalPlaywrightMenuPage: render,
    });

    await expect(
      harvester.fetchMenuPage("https://www.youngs.co.uk/our-pubs"),
    ).rejects.toMatchObject({ code: "robots-refused" });
    expect(render).not.toHaveBeenCalled();
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
      robotsChecker: ALLOWED_ROBOTS,
    });
    await harvester.fetchMenuPage(GK_MENU);
    await expect(harvester.fetchMenuPage(GK_MENU)).rejects.toBeInstanceOf(
      HarvestMenuTransportError,
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { fetchLocalPlaywrightMenuPage } from "@/scripts/lib/localPlaywrightMenuPage.mjs";

const MENU_URL = "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu";
const htmlFetch = async () =>
  new Response("<html><body>bounded menu</body></html>", {
    headers: { "content-type": "text/html" },
  });

type MockRoute = {
  request: () => { url: () => string; resourceType: () => string };
  abort: (reason?: string) => Promise<void>;
  continue: () => Promise<void>;
  fulfill: (options: { status: number; headers: Record<string, string>; body: Buffer }) => Promise<void>;
};

function makePage(
  responseHeaders: Record<string, string> = { "content-type": "text/html" },
  links: { href: string; text: string }[] = [],
  html = "<html><body>Coke Zero £2.80</body></html>",
) {
  let routeHandler: ((route: MockRoute) => Promise<void>) | undefined;
  let currentUrl = "";
  const page = {
    route: vi.fn(async (_pattern: string, handler: (route: MockRoute) => Promise<void>) => {
      routeHandler = handler;
    }),
    goto: vi.fn(async (targetUrl: string) => {
      currentUrl = targetUrl;
      return {
        ok: () => true,
        status: () => 200,
        allHeaders: async () => responseHeaders,
      };
    }),
    url: () => currentUrl,
    evaluate: vi.fn(async () => ({ markdown: "Coke Zero £2.80", links: [] })),
    locator: vi.fn(() => ({ evaluateAll: vi.fn(async () => links) })),
    content: vi.fn(async () => html),
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  const browserType = { launch: vi.fn(async () => browser) };
  return { page, browser, browserType, getRouteHandler: () => routeHandler };
}

describe("local rendered menu page", () => {
  it("refuses URL policy failures before launching Chromium", async () => {
    const { browserType } = makePage();
    await expect(
      fetchLocalPlaywrightMenuPage("https://slugandlettuce.co.uk/bars/soho/menus", {
        sourceId: "youngs-menu-prices",
        browserType,
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toThrow(/sourcePolicy refused/);
    expect(browserType.launch).not.toHaveBeenCalled();
  });

  it("blocks cross-origin resources and returns final URL for an allowed page", async () => {
    const { browserType, getRouteHandler } = makePage();
    const result = await fetchLocalPlaywrightMenuPage(MENU_URL, {
      sourceId: "greene-king-menu-prices",
      browserType,
      fetchImpl: htmlFetch,
      robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
    });
    expect(result.finalUrl).toBe(MENU_URL);

    const route = {
      request: () => ({ url: () => "https://evil.example/pixel.js", resourceType: () => "script" }),
      abort: vi.fn(async () => {}),
      continue: vi.fn(async () => {}),
      fulfill: vi.fn(async () => {}),
    };
    await getRouteHandler()?.(route);
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(route.continue).not.toHaveBeenCalled();

    const documentRoute = {
      request: () => ({ url: () => MENU_URL, resourceType: () => "document" }),
      abort: vi.fn(async () => {}),
      continue: vi.fn(async () => {}),
      fulfill: vi.fn(async () => {}),
    };
    await getRouteHandler()?.(documentRoute);
    expect(documentRoute.fulfill).toHaveBeenCalledWith({
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-length": String(Buffer.byteLength("<html><body>bounded menu</body></html>")),
      },
      body: Buffer.from("<html><body>bounded menu</body></html>"),
    });
    expect(documentRoute.continue).not.toHaveBeenCalled();
  });

  it("refuses an unbounded or non-HTML top-level response", async () => {
    const { browserType } = makePage({ "content-type": "application/pdf" });
    await expect(
      fetchLocalPlaywrightMenuPage(MENU_URL, {
        sourceId: "greene-king-menu-prices",
        browserType,
        fetchImpl: htmlFetch,
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toThrow(/not bounded HTML/);
  });

  it("blocks same-origin paths disallowed by robots", async () => {
    const { browserType, getRouteHandler } = makePage();
    const route = {
      request: () => ({ url: () => "https://www.greeneking.co.uk/private.js", resourceType: () => "script" }),
      abort: vi.fn(async () => {}),
      continue: vi.fn(async () => {}),
      fulfill: vi.fn(async () => {}),
    };
    await fetchLocalPlaywrightMenuPage(MENU_URL, {
      sourceId: "greene-king-menu-prices",
      browserType,
      fetchImpl: htmlFetch,
      robotsChecker: async (url: string) => ({
        allowed: !new URL(url).pathname.startsWith("/private"),
        reason: new URL(url).pathname.startsWith("/private") ? "robots-disallowed" : "allowed",
        evidence: "fixture",
      }),
    });
    await getRouteHandler()?.(route);
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
  });

  it("refuses a disallowed top-level menu before launching Chromium", async () => {
    const { browserType } = makePage();
    await expect(
      fetchLocalPlaywrightMenuPage("https://www.youngs.co.uk/our-pubs", {
        sourceId: "youngs-menu-prices",
        browserType,
        fetchImpl: htmlFetch,
        robotsChecker: async () => ({ allowed: false, reason: "robots-disallowed", evidence: "Disallow: /" }),
      }),
    ).rejects.toThrow(/robots\.txt refused/);
    expect(browserType.launch).not.toHaveBeenCalled();
  });

  it("follows one unique same-origin menu link instead of guessing a path", async () => {
    const menuUrl = "https://www.theeaglew12.co.uk/food-drink";
    const { page, browserType } = makePage(
      { "content-type": "text/html" },
      [{ href: menuUrl, text: "Our Menus" }],
    );
    const result = await fetchLocalPlaywrightMenuPage("https://www.theeaglew12.co.uk/", {
      sourceId: "youngs-menu-prices",
      associatedHosts: ["theeaglew12.co.uk"],
      followMenuLink: true,
      browserType,
      fetchImpl: htmlFetch,
      robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
    });
    expect(page.goto).toHaveBeenNthCalledWith(2, menuUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    expect(result.finalUrl).toBe(menuUrl);
  });

  it("refuses ambiguous menu links instead of choosing one", async () => {
    const { browserType } = makePage(
      { "content-type": "text/html" },
      [
        { href: "https://www.theeaglew12.co.uk/food-drink", text: "Our Menus" },
        { href: "https://www.theeaglew12.co.uk/menus", text: "Food and Drink" },
      ],
    );
    await expect(
      fetchLocalPlaywrightMenuPage("https://www.theeaglew12.co.uk/", {
        sourceId: "youngs-menu-prices",
        associatedHosts: ["theeaglew12.co.uk"],
        followMenuLink: true,
        browserType,
        fetchImpl: htmlFetch,
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toThrow(/expected one same-origin menu link/);
  });

  it("refuses oversized declared HTML during bounded preflight before launching Chromium", async () => {
    const { browserType } = makePage();
    await expect(
      fetchLocalPlaywrightMenuPage(MENU_URL, {
        sourceId: "greene-king-menu-prices",
        browserType,
        maxHtmlBytes: 100,
        fetchImpl: async () =>
          new Response("small body", {
            headers: { "content-type": "text/html", "content-length": "101" },
          }),
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(browserType.launch).not.toHaveBeenCalled();
  });

  it("streams chunked HTML through the byte cap before launching Chromium", async () => {
    const { browserType } = makePage();
    await expect(
      fetchLocalPlaywrightMenuPage(MENU_URL, {
        sourceId: "greene-king-menu-prices",
        browserType,
        maxHtmlBytes: 100,
        fetchImpl: async () =>
          new Response(new Uint8Array(101), {
            headers: { "content-type": "text/html" },
          }),
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(browserType.launch).not.toHaveBeenCalled();
  });

  it("refuses cross-origin redirects during preflight before launching Chromium", async () => {
    const { browserType } = makePage();
    await expect(
      fetchLocalPlaywrightMenuPage(MENU_URL, {
        sourceId: "greene-king-menu-prices",
        browserType,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/menu" },
          }),
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toMatchObject({ code: "redirect-refused" });
    expect(browserType.launch).not.toHaveBeenCalled();
  });

  it("refuses non-HTML preflight responses before launching Chromium", async () => {
    const { browserType } = makePage();
    await expect(
      fetchLocalPlaywrightMenuPage(MENU_URL, {
        sourceId: "greene-king-menu-prices",
        browserType,
        fetchImpl: async () =>
          new Response("not HTML", { headers: { "content-type": "application/pdf" } }),
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toMatchObject({ code: "content-type-refused" });
    expect(browserType.launch).not.toHaveBeenCalled();
  });

  it("keeps the post-render HTML byte cap as a second-stage guard", async () => {
    const oversizedRenderedHtml = `<html><body>${"x".repeat(101)}</body></html>`;
    const { browserType } = makePage({ "content-type": "text/html" }, [], oversizedRenderedHtml);
    await expect(
      fetchLocalPlaywrightMenuPage(MENU_URL, {
        sourceId: "greene-king-menu-prices",
        browserType,
        maxHtmlBytes: 100,
        fetchImpl: htmlFetch,
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
      }),
    ).rejects.toThrow(/rendered menu HTML exceeds 100 byte limit/);
  });
});

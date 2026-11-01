import { createHash } from "node:crypto";
import { createServer, request, type ClientRequest } from "node:http";
import { expect, test, type Page } from "@playwright/test";

type SplashMeasurements = {
  __pubmaxSplashCls: number;
  __pubmaxSplashShifts: Array<{
    time: number;
    value: number;
    hadRecentInput: boolean;
    fonts: FontFaceSetLoadStatus;
    sources: Array<{
      element: string | null;
      previousRect: DOMRectInit;
      currentRect: DOMRectInit;
    }>;
  }>;
};

// feat(landing): hero scroll cinema with aperture splash - PIECE 3.
// The splash block in public/theme-init.js skips real automated browsers by
// default (navigator.webdriver), which every other spec in this suite relies on
// implicitly (they never see the splash). This is the one dedicated spec
// that opts back in, via page.addInitScript overriding navigator.webdriver,
// so the aperture animation itself gets real-browser proof: it appears,
// animates, and resolves within the 700ms hard ceiling with zero CLS, then
// flows into the hero cinema's dark-start frame (see
// the retired landing hero cinema, removed with the relaunch landing).

async function overrideWebdriver(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "webdriver", {
      get: () => false,
      configurable: true,
    });
  });
}

async function trackCls(page: Page) {
  await page.addInitScript(() => {
    const measurements = window as unknown as SplashMeasurements;
    measurements.__pubmaxSplashCls = 0;
    measurements.__pubmaxSplashShifts = [];
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources: Array<{
              node: Node | null;
              previousRect: DOMRectReadOnly;
              currentRect: DOMRectReadOnly;
            }>;
          }
        >) {
          measurements.__pubmaxSplashShifts.push({
            time: entry.startTime,
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
            fonts: document.fonts.status,
            sources: entry.sources.map((source) => ({
              element: source.node instanceof Element
                ? source.node.outerHTML
                : source.node?.parentElement?.outerHTML ?? null,
              previousRect: source.previousRect.toJSON(),
              currentRect: source.currentRect.toJSON(),
            })),
          });
          if (!entry.hadRecentInput) {
            measurements.__pubmaxSplashCls += entry.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
  });
}

// Deliver the real response unchanged, splitting after the first Pal action.
// Hold the remaining HTML and real font bytes for controlled transport timing.
// This models the partial-header paint, not a naturally observed CI schedule.
async function fragmentedLandingProxy(baseURL: string) {
  const upstreamOrigin = new URL(baseURL);
  if (upstreamOrigin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(upstreamOrigin.hostname)) {
    throw new Error("The streamed landing regression requires a local HTTP baseURL.");
  }
  const requests = new Set<ClientRequest>();
  const waitingFonts: Array<() => void> = [];
  const delivery = { originalSha256: "", htmlBytes: 0, splitAt: 0, heldFonts: 0, errors: [] as string[] };
  // Open from the header split until the HTML tail is written. A font the
  // browser asks for in that window is held until the tail, decided when the
  // request arrives so a slow upstream reply cannot slip past the hold.
  let headerStreaming = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const server = createServer((incoming, outgoing) => {
    const fontRequestedWhileStreaming = headerStreaming && /\.woff2?$/.test(new URL(incoming.url ?? "/", upstreamOrigin).pathname);
    const upstreamURL = new URL(upstreamOrigin);
    const path = new URL(incoming.url ?? "/", upstreamOrigin);
    upstreamURL.pathname = path.pathname;
    upstreamURL.search = path.search;
    const upstream = request(upstreamURL, {
      method: incoming.method,
      headers: { ...incoming.headers, host: upstreamOrigin.host, "accept-encoding": "identity" },
    }, (reply) => {
      const isLanding = path.pathname === "/" && reply.statusCode === 200 &&
        String(reply.headers["content-type"]).includes("text/html");
      const holdFont = fontRequestedWhileStreaming && reply.statusCode === 200;
      if (!isLanding && !holdFont) {
        outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(outgoing);
        return;
      }
      const chunks: Buffer[] = [];
      reply.on("data", (chunk: Buffer) => chunks.push(chunk));
      reply.on("error", (error) => {
        delivery.errors.push(error.message);
        outgoing.destroy(error);
      });
      reply.on("end", () => {
        const body = Buffer.concat(chunks);
        if (holdFont) {
          const release = () => {
            outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
            outgoing.end(body);
          };
          delivery.heldFonts += 1;
          if (headerStreaming) waitingFonts.push(release);
          else release();
          return;
        }
        const actions = body.indexOf("siteNavActions lpNavActions");
        const firstLinkEnd = body.indexOf("</a>", actions);
        const headerEnd = body.indexOf("</header>", actions);
        if (actions < 0 || firstLinkEnd < 0 || headerEnd < firstLinkEnd) {
          delivery.errors.push("The response has no complete public landing action link.");
          outgoing.writeHead(502);
          outgoing.end("Landing header boundary unavailable");
          return;
        }
        delivery.splitAt = firstLinkEnd + Buffer.byteLength("</a>");
        delivery.htmlBytes = body.length;
        delivery.originalSha256 = createHash("sha256").update(body).digest("hex");
        const headers = { ...reply.headers };
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        outgoing.writeHead(200, headers);
        headerStreaming = true;
        outgoing.flushHeaders();
        outgoing.write(body.subarray(0, delivery.splitAt));
        releaseTimer = setTimeout(() => {
          headerStreaming = false;
          for (const release of waitingFonts.splice(0)) release();
          outgoing.end(body.subarray(delivery.splitAt));
        }, 500);
      });
    });
    requests.add(upstream);
    upstream.once("close", () => requests.delete(upstream));
    upstream.setTimeout(10_000, () => upstream.destroy(new Error("Local landing upstream timed out.")));
    upstream.on("error", (error) => {
      delivery.errors.push(error.message);
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end("Local landing upstream unavailable");
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The landing proxy has no private port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    delivery,
    async close() {
      clearTimeout(releaseTimer);
      waitingFonts.length = 0;
      for (const pending of requests) pending.destroy();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

test.describe("aperture splash - eligible session (navigator.webdriver overridden)", () => {
  test("holds CLS below 0.01 when the header stream and real fonts finish together", async ({ page, baseURL }) => {
    expect(baseURL, "The local production server must provide baseURL").toBeTruthy();
    const proxy = await fragmentedLandingProxy(baseURL!);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await overrideWebdriver(page);
      await trackCls(page);
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      const response = await page.goto(proxy.origin);
      expect(response?.status()).toBe(200);
      expect(createHash("sha256").update(await response!.body()).digest("hex")).toBe(proxy.delivery.originalSha256);
      expect(proxy.delivery.heldFonts, "The reproduction must hold real font responses with the HTML").toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("layout-shift"))).toBe(true);
      await expect(page.locator(".lpNav")).toBeVisible();
      await expect(page.locator(".lpNav").getByRole("link", { name: "PUBMAXX home", exact: true })).toBeVisible();
      await page.waitForTimeout(900);
      const measurements = await page.evaluate(() => {
        const measured = window as unknown as SplashMeasurements;
        return { cls: measured.__pubmaxSplashCls, shifts: measured.__pubmaxSplashShifts };
      });
      await test.info().attach("fragmented-landing-layout-shifts", {
        body: JSON.stringify({ delivery: proxy.delivery, ...measurements }, null, 2),
        contentType: "application/json",
      });
      expect(proxy.delivery.errors).toEqual([]);
      expect(measurements.cls, `Streamed landing shifts: ${JSON.stringify(measurements.shifts)}`).toBeLessThan(0.01);
    } finally {
      await proxy.close();
    }
  });

  test("plays once, resolves within the 700ms ceiling, and holds CLS at zero", async ({ page }) => {
    await overrideWebdriver(page);
    await trackCls(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Set pre-paint by public/theme-init.js - must already be present by
    // the time Playwright can observe it, with no flash of an unstyled mark.
    const splashOn = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOn).toBe("on");

    const overlay = page.locator("#pubmax-splash");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS("position", "fixed");

    const mark = page.locator(".pubmaxSplashMark");
    await expect(mark).toBeVisible();

    // Give the sequence its full 700ms hard ceiling plus a settle margin,
    // then confirm both the backdrop and the mark have finished animating
    // (fill: forwards leaves them transparent, not removed from the DOM).
    await page.waitForTimeout(900);
    const backdropOpacity = await overlay.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(backdropOpacity)).toBeLessThan(0.05);
    const markOpacity = await mark.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(markOpacity)).toBeLessThan(0.05);

    // The overlay is inert throughout, and the hero cinema underneath - the
    // "one continuous shot" the splash resolves into - is reachable and
    // interactive once it finishes.
    await expect(overlay).toHaveCSS("pointer-events", "none");
    await expect(
      page.getByRole("heading", {
        name: "What a pint costs, pub by pub.",
        exact: true,
      }),
    ).toBeVisible();

    const measurements = await page.evaluate(() => {
      const measured = window as unknown as SplashMeasurements;
      return { cls: measured.__pubmaxSplashCls, shifts: measured.__pubmaxSplashShifts };
    });
    await test.info().attach("landing-layout-shifts", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    expect(
      measurements.cls,
      `Landing layout shifts: ${JSON.stringify(measurements.shifts, null, 2)}`,
    ).toBeLessThan(0.01);
  });

  test("does not replay on a second load in the same session", async ({ page }) => {
    await overrideWebdriver(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.splash))
      .toBe("on");

    await page.reload();
    const splashOnSecondLoad = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOnSecondLoad).toBeUndefined();
  });

  test("never triggers off the landing route", async ({ page }) => {
    await overrideWebdriver(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/map");
    const splashOnMap = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOnMap).toBeUndefined();
  });

  test("skips entirely under prefers-reduced-motion, even though webdriver is overridden", async ({ page }) => {
    await overrideWebdriver(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    const splashUnderReducedMotion = await page.evaluate(
      () => document.documentElement.dataset.splash,
    );
    expect(splashUnderReducedMotion).toBeUndefined();
  });
});

test.describe("aperture splash - default automated session", () => {
  test("never plays for a real automated browser (navigator.webdriver left as-is)", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    const splashDefault = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashDefault).toBeUndefined();
  });
});

test.describe("landing header without JavaScript", () => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    test(`keeps the public header visible at ${viewport.width}px`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        const header = page.locator(".lpNav");
        await expect(header).toBeVisible();
        await expect(header.getByRole("link", { name: "PUBMAXX home", exact: true })).toBeVisible();
        if (viewport.width === 1280) {
          await expect(header.getByRole("button", { name: "More pages", exact: true })).toBeVisible();
        }
      } finally {
        await context.close();
      }
    });
  }
});

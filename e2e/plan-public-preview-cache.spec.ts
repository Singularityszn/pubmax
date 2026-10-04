import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Route } from "@playwright/test";

const anchorId = "venue-11e0hkh";
const privateTitle = "Private anchored preview browser fixture";

async function createAnchoredPlan(request: APIRequestContext): Promise<string> {
  const operationKey = randomUUID();
  const generated = await request.post("/api/plans/generate", {
    data: {
      query: "A pint in Clapham for two",
      context: { nightArea: "clapham", stopCount: 1 },
      operationKey,
      anchor: { venueId: anchorId, source: "map-search", acceptedArea: null, startsAt: null },
    },
  });
  expect(generated.status()).toBe(200);
  const draft = await generated.json() as {
    groundingProof: string; outcome: string; anchorVenueId: string; anchorSource: string;
    inferredContext: unknown; stops: Array<{ venueId: string; venueName: string }>;
  };
  expect(draft.anchorVenueId).toBe(anchorId);
  expect(draft.groundingProof).toEqual(expect.any(String));
  expect(draft.stops[0].venueId).toBe(anchorId);
  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": operationKey },
    data: {
      title: privateTitle, creatorName: "Preview host",
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      groundingProof: draft.groundingProof, context: draft.inferredContext,
      anchor: { venueId: anchorId, source: draft.anchorSource, outcome: draft.outcome },
      stops: draft.stops.map(({ venueId, venueName }) => ({ venueId, venueName })),
    },
  });
  expect(created.status()).toBe(201);
  const body = await created.json() as { plan: { plan: { id: string; anchorVenueId: string } } };
  expect(body.plan.plan.anchorVenueId).toBe(anchorId);
  return body.plan.plan.id;
}

test("anonymous anchored Plan HTML and APIs withhold the accepted venue", async ({ request, playwright }, info) => {
  test.setTimeout(90_000);
  const id = await createAnchoredPlan(request);
  const anon = await playwright.request.newContext({ baseURL: info.project.use.baseURL });
  try {
    for (const path of [`/plan/${id}`, `/api/plans/${id}`, `/api/plans/${id}/recap`]) {
      const response = await anon.get(path);
      expect(response.status()).toBe(200);
      const body = await response.text();
      await info.attach(path.startsWith("/api/") ? `anonymous-${path.split("/").at(-1)}.json` : "anonymous-plan.html", {
        contentType: path.startsWith("/api/") ? "application/json" : "text/html", body,
      });
      expect(body, `${path} must withhold the private accepted venue`).not.toContain(anchorId);
      expect(body).not.toContain(privateTitle);
    }
  } finally {
    await anon.dispose();
  }
});

test("the worker refuses legacy Plan HTML during navigation network failures", async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const id = await createAnchoredPlan(request);
  const legacyId = await createAnchoredPlan(request);
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL, serviceWorkers: "allow", storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  // Match the E2E build registration so the page cannot replace this worker
  // with another test version after its own OfflineReady delay.
  const version = "local";
  const unsafePath = `/plan/${legacyId}`;
  const legacyMarker = "Legacy private accepted venue";
  const legacyCache = "pubmax-sw-plan-private-preview-before-fix";
  const safeCache = `pubmax-sw-preview-plan-v2-${version}`;
  const aborted: string[] = [];
  const offlinePaths = new Set([unsafePath, `/plan/${id}`]);
  const offlineNavigation = async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().serviceWorker() && offlinePaths.has(url.pathname)) {
      aborted.push(url.pathname);
      await route.abort("internetdisconnected");
    } else {
      await route.continue();
    }
  };
  const offlinePattern = /\/plan\//;
  let intercepting = false;
  try {
    await page.goto("/offline.html");
    // A synthetic historical cache entry models HTML that an earlier worker
    // retained. Live Plan HTML and all network responses remain real.
    await page.evaluate(async ({ name, path, marker }) => {
      await (await caches.open(name)).put(path, new Response(`<h1>${marker}</h1>`, {
        headers: { "Content-Type": "text/html" },
      }));
    }, { name: legacyCache, path: unsafePath, marker: legacyMarker });
    await page.evaluate(async (workerUrl) => {
      await navigator.serviceWorker.register(workerUrl, { updateViaCache: "none" });
      await navigator.serviceWorker.ready;
    }, `/sw.js?v=${version}&cache-policy=plan-preview-safe-v2`);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ""))
      .toContain(version);
    // Test actual fallback before any live Plan navigation. The old worker
    // can migrate this entry into its current family, so disappearance of
    // the original cache name alone does not prove privacy.
    await context.route(offlinePattern, offlineNavigation);
    intercepting = true;
    const legacy = await page.goto(unsafePath);
    expect(legacy).not.toBeNull();
    const legacyBody = await legacy!.text();
    await info.attach("legacy-navigation.html", { contentType: "text/html", body: legacyBody });
    expect(aborted).toContain(unsafePath);
    expect(legacyBody).not.toContain(legacyMarker);
    await expect.poll(() => page.evaluate(async () =>
      (await caches.keys()).filter((name) => name.startsWith("pubmax-sw-plan-")),
    )).toEqual([]);
    await context.unroute(offlinePattern, offlineNavigation);
    intercepting = false;

    const live = await page.goto(`/plan/${id}`);
    expect(live?.status()).toBe(200);
    const html = await live!.text();
    expect(html).not.toContain(anchorId);
    expect(html).not.toContain(privateTitle);
    await expect.poll(() => page.evaluate(async ({ name, path }) => {
      const response = await (await caches.open(name)).match(path);
      return response ? response.text() : "";
    }, { name: safeCache, path: `/plan/${id}` })).toBe(html);

    await context.route(offlinePattern, offlineNavigation);
    intercepting = true;
    const cached = await page.goto(`/plan/${id}`);
    expect(cached?.status()).toBe(200);
    expect(await cached!.text()).toBe(html);
    expect(aborted).toContain(`/plan/${id}`);
    await info.attach("worker-owned-navigation-failures.json", {
      contentType: "application/json", body: JSON.stringify({ version, legacyCache, safeCache, aborted }),
    });
    await info.attach("public-plan-offline.png", { contentType: "image/png", body: await page.screenshot() });
  } finally {
    try {
      if (intercepting) await context.unroute(offlinePattern, offlineNavigation);
    } finally {
      await context.close();
    }
  }
});

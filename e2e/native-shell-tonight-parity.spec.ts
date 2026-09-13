import { expect, test, type Page } from "@playwright/test";

// THE SHELL AND THE WEB MUST DRAW ONE /tonight.
//
// The 13 September 2026 audit caught the iOS shell drawing /tonight with its
// way-onward doors ABOVE the listings while phone web drew them after
// (`actionsAfterContent`, components/ui/screen.tsx). On a clean install of
// main the shell drew the web's composition: the simulator binary under audit
// was a 5 September build whose synced config loaded a preview deployment
// from before #1575. So the root cause was a stale rig, not a shell defect,
// and this spec is the fence that keeps it that way. It drives the ways the
// shell reaches /tonight - the pre-paint entry rewrite from `/`, and the same
// launch once the offline worker controls the page with a stale shell copy in
// its cache - and holds each one to a plain fetch of the same URL.

const VIEWPORT = { width: 390, height: 844 };
const PARITY_VERSION = "parity";

type Order = { actionsAfterLede: boolean; actionRows: number };

/** Where the way-onward row sits against the lede, read out of server HTML. */
function orderInHtml(html: string): Order {
  const lede = html.indexOf('data-testid="tonight-lede"');
  const actions = html.indexOf('class="screenActions');
  expect(lede, "the /tonight document carries no lede region").toBeGreaterThan(-1);
  expect(actions, "the /tonight document carries no action row").toBeGreaterThan(-1);
  return {
    actionsAfterLede: actions > lede,
    actionRows: html.split('class="screenActions').length - 1,
  };
}

/** The same question asked of the painted DOM. */
async function orderInDom(page: Page): Promise<Order> {
  await expect(page.getByTestId("tonight-lede")).toBeAttached({ timeout: 30_000 });
  return page.evaluate(() => {
    const lede = document.querySelector('[data-testid="tonight-lede"]');
    const rows = document.querySelectorAll(".screenActions");
    const first = rows[0];
    return {
      actionsAfterLede: Boolean(
        lede && first && lede.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      actionRows: rows.length,
    };
  });
}

/**
 * The Capacitor probe lib/nativePlatform.ts and public/theme-init.js read, past
 * first run. Installed on the CONTEXT, so a relaunch in a new page is the shell
 * too.
 */
async function bootAsShell(page: Page) {
  await page.setViewportSize(VIEWPORT);
  await page.context().addInitScript(() => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { isNativePlatform: () => true, getPlatform: () => "ios" },
    });
    window.localStorage.setItem("pubmax:nativeFirstRun:routed:v1", "1");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

/** Put the audit's stale composition, doors first, into the worker's shell cache. */
async function plantStaleTonight(page: Page) {
  await page.evaluate(async (version) => {
    const cache = await caches.open(`pubmax-sw-shell-${version}`);
    await cache.put(
      "/tonight",
      new Response(
        '<!doctype html><main data-testid="tonight-screen"><div class="screenActions">stale</div>' +
          '<div data-testid="tonight-lede"></div></main>',
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      ),
    );
  }, PARITY_VERSION);
}

test.describe.configure({ mode: "serial" });

test("a shell cold start lands on the same /tonight a plain fetch serves", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const plain = orderInHtml(await (await request.get("/tonight")).text());
  expect(plain).toEqual({ actionsAfterLede: true, actionRows: 1 });

  await bootAsShell(page);
  await page.goto("/");
  await page.waitForURL(/\/tonight$/, { timeout: 30_000 });
  expect(await orderInDom(page)).toEqual(plain);
});

test("a worker-controlled shell never serves a stale /tonight while the network answers", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const plain = orderInHtml(await (await request.get("/tonight")).text());

  await bootAsShell(page);
  await page.goto("/tonight");
  await orderInDom(page);
  const version = await page.evaluate(async (v) => {
    await navigator.serviceWorker.register(`/sw.js?v=${v}&cache-policy=write-safe-v1`);
    const ready = await navigator.serviceWorker.ready;
    return new URL(ready.active?.scriptURL ?? location.href).searchParams.get("v");
  }, PARITY_VERSION);
  expect(version).toBe(PARITY_VERSION);
  await plantStaleTonight(page);

  // A fresh launch of the same shell: a new page in the same context, so the
  // worker controls the navigation from its first request.
  const relaunch = await context.newPage();
  await relaunch.setViewportSize(VIEWPORT);
  await relaunch.goto("/");
  await relaunch.waitForURL(/\/tonight$/, { timeout: 30_000 });
  await expect
    .poll(() => relaunch.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 15_000,
    })
    .toBe(true);
  expect(await orderInDom(relaunch)).toEqual(plain);
  await expect(relaunch.locator(".screenActions", { hasText: "stale" })).toHaveCount(0);

  // With the network gone the cached copy is the honest fallback, which is
  // what the offline ladder in public/sw.js promises. The online launch above
  // refreshed the shelf, so the stale copy is planted again first.
  await plantStaleTonight(relaunch);
  await context.setOffline(true);
  await relaunch.reload();
  await expect(relaunch.locator(".screenActions", { hasText: "stale" })).toHaveCount(1);
  await context.setOffline(false);
});

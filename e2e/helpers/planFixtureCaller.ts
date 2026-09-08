import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

// These journey tests share a server, but do not represent one caller.
// A stable RFC 3849 address keeps every request within a test in one bucket.
export const test = base.extend<{ planFixtureHeaders: Record<string, string> }>({
  planFixtureHeaders: [async ({ page, baseURL }, use, testInfo) => {
    const origin = `http://localhost:${process.env.PW_PORT ?? 3100}`;
    if (baseURL !== origin) throw new Error("Plan fixtures require the configured local test origin.");
    const groups = createHash("sha256").update(testInfo.testId).digest("hex").slice(0, 24).match(/.{4}/g)!;
    const headers = { "x-vercel-forwarded-for": `2001:db8:${groups.join(":")}` };
    await page.route(
      (url) => url.origin === origin && ["/api/plans", "/api/plans/generate"].includes(url.pathname),
      (route) => route.request().method() === "POST"
        ? route.continue({ headers: { ...route.request().headers(), ...headers } })
        : route.fallback(),
    );
    await use(headers);
  }, { auto: true }],
});

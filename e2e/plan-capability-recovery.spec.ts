import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type Response } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { completeRealPlanHostOnboarding, seedRealPlanHost } from "./helpers/realPlanAuth";
import { describeFirstQuery, describeFirstSubmit } from "./helpers/planDescribeFirst";

// A signed-in browser that has LOST its Plan capability cookie must get it
// back, and a signed-out one must never spend the write finding that out.
//
// This is the lane the Plan claim PR (#1301) could not prove in a browser,
// because the auth doubles it needed were trapped inside
// e2e/account-switch-identity.spec.ts. They are shared now, so the journey is
// provable rather than only unit-covered.
//
// The capability lives in an HttpOnly cookie the page cannot read, so "losing
// it" is done through the browser context, exactly as a cookie expiry or a
// cleared jar would do it.

const CAPABILITY_COOKIE = (planId: string) => `pubmax_plan_member_${planId}`;
const RECOVERY_OBSERVATION_BUDGET_MS = 20_000;

/** The composer needs React attached before a tap counts. */
async function openHydratedPlanComposer(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** London-local `datetime-local` value a couple of hours out. */
function futureLondonFirstPint(): string {
  const when = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

function trackMainFrameDocumentNavigations(page: Page): () => number {
  let documentRequests = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest()
      && request.resourceType() === "document"
      && request.frame() === page.mainFrame()
    ) {
      documentRequests += 1;
    }
  });
  return () => documentRequests;
}

/** Create a real Plan as the signed-in host and answer its id. */
async function lockInAPlan(
  page: Page,
  options: { waitForAccountClaim?: boolean } = {},
): Promise<string> {
  await test.step("Hydrate the Plan composer", () => openHydratedPlanComposer(page));
  await describeFirstQuery(page).fill("Quiet in Clapham for 4, not pricey");
  await describeFirstSubmit(page).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  await page.getByLabel("First pint").fill(futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  const claim = options.waitForAccountClaim
    ? page.waitForResponse(
        (response) =>
          response.request().method() === "PUT"
          && /\/api\/plans\/[0-9a-f-]{36}\/session$/.test(response.url())
          && response.ok(),
        { timeout: RECOVERY_OBSERVATION_BUDGET_MS },
      )
    : null;
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);
  if (claim) await claim;
  return page.url().replace(/#.*$/, "").split("/plan/")[1]!;
}

/** Drop the HttpOnly capability cookie, leaving every other cookie alone. */
async function loseTheCapabilityCookie(page: Page, planId: string): Promise<void> {
  const context = page.context();
  const name = CAPABILITY_COOKIE(planId);
  const cookies = await context.cookies();
  expect(
    cookies.some((cookie) => cookie.name === name),
    "the capability cookie exists before the reset",
  ).toBe(true);
  await context.clearCookies({ name });
  expect(
    (await context.cookies()).some((cookie) => cookie.name === name),
    "the capability cookie is gone before the recovery attempt",
  ).toBe(false);
}

test.describe("signed-in Plan capability recovery", () => {
  test("a signed-in host who lost the capability cookie recovers it on the Plan page", async ({
    page,
  }) => {
    // Keyless runs cannot verify a signed-in caller. Only the private GoTrue
    // runner enables this journey. Production authentication stays unchanged.
    test.skip(
      process.env.PW_DISPOSABLE_PLAN_AUTH !== "1",
      "No service-role key in the keyless e2e server: verifyCallerAuth answers \"unavailable\", so the claim PUT and the recovery PATCH both answer 503 by design.",
    );
    const host = await test.step("Enter the genuine disposable session", () => seedRealPlanHost(page));
    try {
      await test.step("Complete genuine handle onboarding", () => completeRealPlanHostOnboarding(page));
      const planId = await test.step("Create and claim the Plan", () => lockInAPlan(page, { waitForAccountClaim: true }));
      await test.step("Remove only the Plan capability cookie", () => loseTheCapabilityCookie(page, planId));

      const documentRequestCount = trackMainFrameDocumentNavigations(page);

      // The recovery write is a PATCH under one idempotency key, so a second tab
      // or a retry converges rather than rotating the token twice.
      const recovery = page.waitForRequest(
        (request) =>
          request.method() === "PATCH"
          && request.url().includes(`/api/plans/${planId}/session`),
        { timeout: RECOVERY_OBSERVATION_BUDGET_MS },
      );

      await test.step("Reload the Plan for cookie-based entry", () => page.reload());

      const request = await test.step("Observe the recovery write", () => recovery);
      expect(
        request.headers()["idempotency-key"],
        "recovery is sent under an idempotency key",
      ).toBeTruthy();

      // Access is back: the host-only control returns without a second reload.
      await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible({
        timeout: RECOVERY_OBSERVATION_BUDGET_MS,
      });
      expect(documentRequestCount(), "one main-frame document request after cookie loss").toBe(1);
      expect(
        (await page.context().cookies()).some(
          (cookie) => cookie.name === CAPABILITY_COOKIE(planId),
        ),
        "the capability cookie is restored",
      ).toBe(true);
    } finally {
      await host.cleanup();
    }
  });

  test("recovers lost capability on the mounted Plan after a crew status action", async ({ page }, testInfo) => {
    testInfo.setTimeout(testInfo.timeout + RECOVERY_OBSERVATION_BUDGET_MS);
    test.skip(process.env.PW_DISPOSABLE_PLAN_AUTH !== "1", "Mounted recovery needs the genuine disposable authentication runner.");
    const host = await test.step("Enter the genuine disposable session", () => seedRealPlanHost(page));
    let finishDiagnostics: (() => Promise<void>) | undefined;
    try {
      await test.step("Complete genuine handle onboarding", () => completeRealPlanHostOnboarding(page));
      const planId = await test.step("Create and claim the Plan", () => lockInAPlan(page, { waitForAccountClaim: true }));
      // Ordinary setup re-entry drops the creator's volatile body bearer.
      // The mounted test begins only after the real cookie session restores.
      const cookieSession = page.waitForResponse((response) =>
        response.request().method() === "GET"
          && new URL(response.url()).pathname === `/api/plans/${planId}/session`,
      { timeout: RECOVERY_OBSERVATION_BUDGET_MS });
      await test.step("Reload the Plan for cookie-based entry", () => page.reload());
      const restored = await test.step("Observe cookie-backed host restoration", () => cookieSession);
      expect(restored.ok(), "setup restores the existing cookie-backed host").toBe(true);
      expect(await restored.json()).toMatchObject({ active: true, role: "host" });
      await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible();
      const presence = page.getByRole("group", { name: "Update your status" });
      const statusButton = presence.getByRole("button", { name: "On the way", exact: true });
      await expect(statusButton).toBeEnabled();
      type Observation = {
        endpoint: "presence" | "session";
        method: "POST" | "GET" | "PATCH";
        status: number;
        errorCode?: string;
        expectedStatus: boolean;
        cookieNamePresent: boolean;
        authorityKind: "absent" | "http_only_marker" | "opaque_bearer";
      };
      const observations: Observation[] = [];
      const pending = new Set<Promise<void>>();
      const captured = new WeakMap<Response, Promise<void>>();
      let captureFailed = false;
      const allowedCodes = new Set([
        "PLAN_PRESENCE_INVALID", "PLAN_PRESENCE_FORBIDDEN", "PLAN_PRESENCE_UNAVAILABLE",
        "PLAN_PRESENCE_RATE_LIMITED", "PLAN_NOT_FOUND", "PLAN_SESSION_REQUIRED",
        "PLAN_SESSION_FORBIDDEN", "PLAN_SESSION_UNAVAILABLE", "PLAN_ACCOUNT_RECOVERY_UNAVAILABLE",
        "UNAUTHENTICATED", "RATE_LIMITED",
      ]);
      const captureResponse = (response: Response): Promise<void> => {
        const path = new URL(response.url()).pathname;
        const request = response.request();
        const method = request.method();
        const endpoint = path === `/api/plans/${planId}/presence` && method === "POST" ? "presence"
          : path === `/api/plans/${planId}/session` && (method === "GET" || method === "PATCH") ? "session" : null;
        if (!endpoint || observations.length + pending.size >= 32) return Promise.resolve();
        const previous = captured.get(response);
        if (previous) return previous;
        const observation = (async () => {
          const headers = await request.allHeaders();
          let body: Record<string, unknown> = {};
          if (endpoint === "presence") {
            try { body = request.postDataJSON() as Record<string, unknown>; } catch { /* No raw body evidence. */ }
          }
          const marker = "__pubmax_http_only_plan_session__";
          const bearer = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
          const bodyToken = typeof body?.memberToken === "string" ? body.memberToken.trim() : "";
          const authority = bearer || bodyToken;
          let errorCode: string | undefined;
          if (!response.ok()) {
            const failure = await response.json().catch(() => null) as { code?: unknown } | null;
            if (typeof failure?.code === "string" && allowedCodes.has(failure.code)) errorCode = failure.code;
          }
          observations.push({
            endpoint, method: method as Observation["method"], status: response.status(),
            ...(errorCode ? { errorCode } : {}),
            expectedStatus: endpoint === "presence" && body?.status === "on_the_way",
            cookieNamePresent: (headers.cookie ?? "").split(";").some((item) => item.trim().startsWith(`${CAPABILITY_COOKIE(planId)}=`)),
            authorityKind: !authority ? "absent" : authority === marker ? "http_only_marker" : "opaque_bearer",
          });
        })().catch(() => { captureFailed = true; });
        captured.set(response, observation);
        pending.add(observation);
        void observation.finally(() => pending.delete(observation));
        return observation;
      };
      const onResponse = (response: Response): void => { void captureResponse(response); };
      page.on("response", onResponse);
      finishDiagnostics = async () => {
        page.off("response", onResponse);
        await Promise.allSettled([...pending]);
        let domOutcome: "invalid_presence" | "forbidden_presence" | "pressed_success" | "pending" = "pending";
        try {
          if (await page.getByRole("alert").filter({ hasText: /^Choose a valid crew status\.$/ }).isVisible()) domOutcome = "invalid_presence";
          else if (await page.getByRole("alert").filter({ hasText: /^That member token isn't valid\.$/ }).isVisible()) domOutcome = "forbidden_presence";
          else if (await statusButton.getAttribute("aria-pressed") === "true") domOutcome = "pressed_success";
        } catch { /* A closed page leaves only the finite pending outcome. */ }
        const diagnosticPath = testInfo.outputPath("mounted-recovery-diagnostics.json");
        await writeFile(diagnosticPath, JSON.stringify({ observations, domOutcome, captureFailed }), { mode: 0o600 });
        await testInfo.attach("mounted-recovery-diagnostics", {
          path: diagnosticPath,
          contentType: "application/json",
        });
      };
      const firstPresence = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/plans/${planId}/presence`,
      { timeout: RECOVERY_OBSERVATION_BUDGET_MS });
      void firstPresence.catch(() => undefined);
      await test.step("Remove only the Plan capability cookie", () => loseTheCapabilityCookie(page, planId));
      const documentRequests = trackMainFrameDocumentNavigations(page);
      const mountedUrl = page.url();

      // A real status action encounters the missing HttpOnly cookie. No test
      // calls restorePlanCapability, changes volatile authority or navigates.
      const recovery = page.waitForResponse((response) =>
        response.request().method() === "PATCH"
          && new URL(response.url()).pathname === `/api/plans/${planId}/session`,
      { timeout: RECOVERY_OBSERVATION_BUDGET_MS });
      // Observe the first presence result without changing any authority or action.
      // A side catch prevents an unhandled rejection while this response is captured;
      // the ORIGINAL recovery promise remains awaited and asserted below.
      void recovery.catch(() => undefined);
      await test.step("Request the mounted crew-status action", () => statusButton.click());
      const firstPresenceResponse = await test.step("Observe the initial presence response", () => firstPresence);
      await captureResponse(firstPresenceResponse);
      const recovered = await test.step("Observe mounted capability recovery", () => recovery);
      expect(recovered.ok(), "account recovery succeeds on the mounted page").toBe(true);
      expect(recovered.request().headers()["idempotency-key"]).toBeTruthy();
      expect((await page.context().cookies()).some((cookie) => cookie.name === CAPABILITY_COOKIE(planId))).toBe(true);

      // The recovered capability must support a real mutation, not only leave
      // stale host controls painted. A second explicit tap is a safe retry.
      await expect(statusButton).toBeEnabled();
      const saved = page.waitForResponse((response) =>
        response.request().method() === "POST"
          && new URL(response.url()).pathname === `/api/plans/${planId}/presence`,
      { timeout: RECOVERY_OBSERVATION_BUDGET_MS });
      await test.step("Retry the crew-status action with recovered authority", () => statusButton.click());
      expect((await test.step("Observe the recovered crew-status save", () => saved)).ok(), "the recovered host can update crew status").toBe(true);
      await expect(statusButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible();
      expect(page.url()).toBe(mountedUrl);
      expect(documentRequests(), "mounted recovery sends no main-frame document request").toBe(0);
    } finally {
      try { await finishDiagnostics?.(); } finally { await host.cleanup(); }
    }
  });

  test("a signed-out browser never spends a recovery write", async ({ page }, testInfo) => {
    testInfo.setTimeout(testInfo.timeout + RECOVERY_OBSERVATION_BUDGET_MS);
    const realHost = process.env.PW_DISPOSABLE_PLAN_AUTH === "1"
      ? await test.step("Enter the genuine disposable session", () => seedRealPlanHost(page)) : null;
    try {
      if (!realHost) {
        await installAuthDoubles(page);
        await seedSignedIn(page, "A");
      }
      if (realHost) await test.step("Complete genuine handle onboarding", () => completeRealPlanHostOnboarding(page));
      const planId = await test.step("Create and claim the Plan", () => lockInAPlan(page, { waitForAccountClaim: realHost !== null }));
      await test.step("Remove only the Plan capability cookie", () => loseTheCapabilityCookie(page, planId));

      // The genuine lane revokes its provider session. The ordinary keyless
      // refusal control retains its existing local authentication double.
      if (realHost) await test.step("Sign out through genuine GoTrue", () => realHost.signOut());
      else await page.evaluate(() => window.localStorage.clear());

      const documentRequestCount = trackMainFrameDocumentNavigations(page);
      const writes: string[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "PATCH"
          && request.url().includes(`/api/plans/${planId}/session`)
        ) {
          writes.push(request.url());
        }
      });

      const reloadResponse = await test.step("Reload the signed-out Plan", () => page.reload());
      expect(reloadResponse?.status(), "public Plan reload succeeds").toBe(200);
      await expect(
        page.getByRole("heading", { name: /^Your night out(?: in .+)?$/ }),
      ).toBeVisible({ timeout: RECOVERY_OBSERVATION_BUDGET_MS });
      // Give the effect the same budget the signed-in case gets before concluding
      // that nothing was sent, so this cannot pass by simply being quicker.
      await page.waitForTimeout(RECOVERY_OBSERVATION_BUDGET_MS);

      expect(
        documentRequestCount(),
        "one main-frame document request after cookie loss",
      ).toBe(1);
      expect(writes, "a signed-out browser sends no recovery PATCH").toEqual([]);
      await expect(
        page.getByRole("button", { name: "Copy invite link" }),
      ).toHaveCount(0);
    } finally {
      await realHost?.cleanup();
    }
  });
});

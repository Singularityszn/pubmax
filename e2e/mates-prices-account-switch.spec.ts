import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  accessJwt,
  installAuthDoubles,
  seedSignedIn,
  switchRememberedAccount,
} from "./helpers/authDoubles";
import { COMMUNITY_SHEET_FIXTURE_MAP_PATH } from "./helpers/communitySheetFixture";
import { expectStreamedPageSettled } from "./helpers/streamedPage";

test("a mounted phone map recovers A's prices after B's failed read through another tab", async ({ page: control, context }) => {
  test.slow();
  await context.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await control.setViewportSize({ width: 390, height: 844 });
  const auth = await installAuthDoubles(control);
  await seedSignedIn(control, "A");
  await control.goto("/tonight");
  await expectStreamedPageSettled(control);
  await control.getByRole("button", { name: /Account options/ }).first().click();
  await expect(control.locator(".authAccountMenu .authAccountHandle")).toHaveText(`@${ACCOUNTS.A.handle}`);
  await auth.signedInAs("B");
  await control.reload();
  await expectStreamedPageSettled(control);
  await switchRememberedAccount(control, "B", "A");
  // Init scripts seed only new documents. The mounted map never reloads.
  await auth.signedInAs("A");

  const map = await context.newPage();
  await map.setViewportSize({ width: 390, height: 844 });
  await installAuthDoubles(map);
  const reads: string[] = [];
  let heldA: Promise<void> | null = null;
  await map.route("**/api/mates-prices?**", async (route) => {
    const bearer = await route.request().headerValue("authorization");
    const account = (["A", "B"] as const).find((key) =>
      bearer === `Bearer ${accessJwt(ACCOUNTS[key])}` || bearer === `Bearer pubmaxx-e2e-access-token-${key}`,
    );
    expect(account, "Every private price read must carry a known fixture credential").toBeDefined();
    reads.push(account!);
    if (account === "A" && heldA) await heldA;
    await route.fulfill({
      status: account === "B" ? 503 : 200,
      json: account === "B" ? { error: "unavailable" } : {
        prices: [{ handle: "alice_mate", priceGbp: 4.25, drink: "Lager", measure: "pint", loggedAt: new Date().toISOString() }],
      },
    });
  });
  await map.goto(COMMUNITY_SHEET_FIXTURE_MAP_PATH);
  const mates = map.locator(".matesPrices");
  await expect(mates).toContainText("@alice_mate", { timeout: 60_000 });
  await expect(mates).toContainText("£4.25");
  const documentMark = await map.evaluate(() => {
    const mark = crypto.randomUUID();
    Object.assign(window, { __matesAccountDocument: mark });
    return mark;
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await Promise.all([
      map.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/mates-prices" && response.status() === 503,
      ),
      switchRememberedAccount(control, "A", "B"),
    ]);
    await expect(mates).toHaveCount(0);
    const previousReads = reads.length;
    let releaseA!: () => void;
    heldA = new Promise<void>((resolve) => { releaseA = resolve; });
    try {
      await switchRememberedAccount(control, "B", "A");
      await expect.poll(() => reads.slice(previousReads)).toContain("A");
      // A's old result cannot return before its new response body arrives.
      await expect(mates).toHaveCount(0);
    } finally {
      heldA = null;
      releaseA();
    }
    await expect(mates).toContainText("@alice_mate");
    await expect(mates).toContainText("£4.25");
    await expect(mates).not.toContainText("@bob_mate");
    expect(await map.evaluate(() => (window as Window & { __matesAccountDocument?: string }).__matesAccountDocument)).toBe(documentMark);
  }
});

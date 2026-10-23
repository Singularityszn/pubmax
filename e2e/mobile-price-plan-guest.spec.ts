import { expect, test } from "@playwright/test";

import { pinLondonEvening, setFirstPintIn } from "./helpers/planFirstPint";

test("a phone user checks a price, corrects an incomplete plan, and invites a guest", async ({ page, browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await pinLondonEvening(page);
  await page.goto("/near?patch=clapham");
  const venueName = "The Coach & Horses";
  const answer = page.getByRole("button", { name: /The Coach & Horses.*View pub/ });
  await expect(answer).toBeVisible();
  const price = (await answer.innerText()).match(/£\d+\.\d{2}/)?.[0];
  expect(price).toBeTruthy();
  await answer.click();
  const pub = page.getByRole("dialog", { name: venueName, exact: true });
  await expect(pub).toContainText(price!);
  await expect(pub.getByRole("link", { name: "Pint Prices", exact: true })).toBeVisible();
  await pub.getByRole("button", { name: `Make ${venueName} Stop 1` }).click();
  await expect(page).toHaveURL(/\/plan$/);

  const description = page.getByRole("textbox", { name: "Where, how many, what budget" });
  await description.fill("Three pubs in Clapham with short walks and listed pint prices.");
  const incomplete = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/plans/generate"));
  await page.getByRole("button", { name: "Make a plan", exact: true }).click();
  expect((await (await incomplete).json()).outcome).toBe("anchor-only");
  await expect(page.locator("#plan-route-status")).toHaveText(
    `We kept ${venueName}. We could not build the 3-stop route you asked for. Change the details or add pubs.`,
  );
  await page.screenshot({ path: testInfo.outputPath("incomplete-plan-explained.png") });

  await page.getByRole("button", { name: "Tune details" }).click();
  await expect(page.getByRole("combobox", { name: "Stops", exact: true })).toHaveValue("3");
  await description.fill("Three pubs in Clapham with listed pint prices.");
  const corrected = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/plans/generate"));
  await page.getByRole("button", { name: "Plan it again", exact: true }).click();
  const response = await corrected;
  expect(response.request().postDataJSON().context.transportConstraints).toEqual([]);
  expect((await response.json()).outcome).toBe("route");
  await expect(page.locator(".planStop__name")).toHaveCount(3);
  await expect(page.locator(".planStop__name").first()).toHaveText(venueName);

  await page.getByLabel("Your name", { exact: true }).fill("Flow host");
  await setFirstPintIn(page, 3 * 60);
  await page.getByRole("button", { name: "Regenerate route", exact: true }).click();
  await expect(page.locator("#plan-route-status")).toContainText("Route refreshed.");
  const venueNames = await page.locator(".planStop__name").allTextContents();
  await page.getByRole("button", { name: "Lock it in", exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);

  const whatsapp = page.getByRole("link", { name: "Send on WhatsApp", exact: true });
  await expect(whatsapp).toHaveAttribute("href", /invite/);
  const text = new URL((await whatsapp.getAttribute("href"))!).searchParams.get("text");
  const shared = text?.match(/https?:\/\/[^\s]+/)?.[0];
  expect(shared).toBeTruthy();
  const invite = new URL(shared!);
  expect(invite.hash).toMatch(/^#invite=.+/);

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`${new URL(page.url()).origin}${invite.pathname}${invite.search}${invite.hash}`);
    await expect(guest.getByText("You'll see the full route once you join the crew. No account needed.")).toBeVisible();
    await expect(guest.locator("main")).not.toContainText(venueName);
    const decline = guest.getByRole("button", { name: "No thanks", exact: true });
    if (await decline.isVisible()) await decline.click();
    await guest.locator("#join-name").fill("Flow guest");
    await guest.getByRole("button", { name: "I’m in", exact: true }).click();
    const route = guest.getByRole("region", { name: "The route", exact: true });
    await expect(async () => {
      const accountPrompt = guest.getByRole("dialog", { name: "Keep your nights", exact: true });
      if (await accountPrompt.isVisible()) {
        await accountPrompt.getByRole("button", { name: "Not now", exact: true }).click();
      }
      await route.scrollIntoViewIfNeeded();
      for (const name of venueNames) await expect(route.getByText(name, { exact: true })).toBeVisible();
      await route.getByRole("link", { name: "Open on the map", exact: true }).first().click({ trial: true, timeout: 1_000 });
      await expect(guest.getByRole("dialog")).toHaveCount(0);
    }).toPass({ timeout: 20_000 });
    await expect(route).toBeInViewport();
    await expect(guest.getByRole("link", { name: "Join the crew to see the route" })).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("guest-route-revealed.png") });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  } finally {
    await guestContext.close();
  }
});

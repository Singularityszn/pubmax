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
  // One link (launch review 3.5): WhatsApp carries the public invite page.
  const invite = new URL(shared!);
  expect(invite.pathname).toMatch(/^\/invite\/[0-9a-f]{32}$/);
  const inviteToken = invite.pathname.split("/").pop()!;

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    // The plan-page join through an old /plan/{id}#invite= link still works.
    await guest.goto(`${new URL(page.url()).origin}${new URL(page.url()).pathname}#invite=${inviteToken}`);
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

test("a five-stop incomplete plan keeps its count after clearing, then accepts a new count", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pinLondonEvening(page);
  await page.goto("/near?patch=clapham");
  await page.getByRole("button", { name: /The Coach & Horses.*View pub/ }).click();
  await page.getByRole("dialog", { name: "The Coach & Horses", exact: true })
    .getByRole("button", { name: "Make The Coach & Horses Stop 1" }).click();
  const description = page.getByRole("textbox", { name: "Where, how many, what budget" });
  await description.fill("Five pubs in Clapham with short walks and listed pint prices.");
  await page.getByRole("button", { name: "Make a plan", exact: true }).click();
  await expect(page.locator("#plan-route-status")).toContainText("5-stop route");
  await page.getByRole("button", { name: "Tune details", exact: true }).click();
  const stops = page.getByRole("combobox", { name: "Stops", exact: true });
  await expect(stops).toHaveValue("5");
  await description.click();
  await description.press("ControlOrMeta+A");
  await description.press("Backspace");
  await expect(description).toHaveValue("");
  const cleared = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/plans/generate"));
  await page.getByRole("button", { name: "Plan it again", exact: true }).click();
  const response = await cleared;
  const clearedRequest = response.request().postDataJSON();
  const clearedResult = await response.json();
  await testInfo.attach("cleared-description.json", {
    body: JSON.stringify({ request: clearedRequest, inferredContext: clearedResult.inferredContext, outcome: clearedResult.outcome }, null, 2),
    contentType: "application/json",
  });
  expect(clearedRequest.context.stopCount).toBe(5);
  expect(clearedResult.inferredContext.stopCount).toBe(5);
  await page.getByRole("button", { name: "Tune details", exact: true }).click();
  await expect(stops).toHaveValue("5");
  await page.screenshot({ path: testInfo.outputPath("cleared-description-five-stops.png") });

  await description.fill("Three pubs in Clapham with listed pint prices.");
  const resized = page.waitForResponse((next) =>
    next.request().method() === "POST" && next.url().endsWith("/api/plans/generate"));
  await page.getByRole("button", { name: "Plan it again", exact: true }).click();
  const resizedResponse = await resized;
  const resizedResult = await resizedResponse.json();
  await testInfo.attach("three-stop-description.json", {
    body: JSON.stringify({ request: resizedResponse.request().postDataJSON(), inferredContext: resizedResult.inferredContext, outcome: resizedResult.outcome }, null, 2),
    contentType: "application/json",
  });
  expect(resizedResult.inferredContext.stopCount).toBe(3);
  await page.getByRole("button", { name: "Tune details", exact: true }).click();
  await expect(stops).toHaveValue("3");
  await page.screenshot({ path: testInfo.outputPath("new-description-three-stops.png") });
});

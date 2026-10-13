import { expect, test } from "@playwright/test";

test("Big one tonight returns a sourced plan through the real keyless chat route", async ({ page }) => {
  await page.goto("/pal/chat");
  const chip = page.getByRole("button", { name: "Big one tonight", exact: true });
  const query = "Plan a big night for four of us, with cheap pints and a lively route";
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/pub-pal/chat" && response.request().method() === "POST",
  );
  await expect(chip).toBeVisible();
  await expect(async () => {
    await chip.click();
    await expect(page.getByText(query, { exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().query).toBe(query);
  const body = await response.json();
  expect(body.toolsUsed).toEqual(["propose_plan"]);
  expect(body.cards).toHaveLength(3);
  expect(body.proposals).toContainEqual(expect.objectContaining({ kind: "draft_plan", query }));
  const openPlan = page.getByRole("link", { name: "Open in Plan", exact: true });
  await expect(openPlan).toBeVisible();
  const href = await openPlan.getAttribute("href");
  expect(new URL(href!, "http://localhost").searchParams.get("query")).toBe(query);
  await openPlan.click();
  await expect(page).toHaveURL(/\/plan\?/);
});

test("the phone voice choice survives Back and reload without unused character controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");
  await expect(async () => {
    await page.getByRole("button", { name: "Meet your Pub Pal", exact: true }).click();
    await expect(page.getByRole("heading", { name: "The grown-up bit first.", exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("checkbox", { name: /18 or over/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Who finds you?", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: /^Name/ }).fill("Beacon");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tune the signal.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Choose a voice.", exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByText("Character settings do not change replies yet.", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Relationship|Temper|Energy|Conversation/ })).toHaveCount(0);
  const voice = page.getByRole("button", { name: /^Velvet/ });
  await voice.click();
  await expect(voice).toHaveAttribute("aria-pressed", "true");
  expect((await voice.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("If this voice isn't available, your Pal uses its default voice.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You decide what stays.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).last().click();
  await expect(heading).toBeVisible();
  await expect(voice).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(voice).toHaveAttribute("aria-pressed", "true");
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});

test("the chat greeting and suggestions do not start a provider turn", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/pub-pal/chat") requests.push(request.method());
  });
  await page.goto("/pal/chat");
  await expect(page.getByText("Hi. What kind of night are you planning?", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Pick a vibe", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  expect(requests).toEqual([]);
});

import { expect, test } from "@playwright/test";

import { VIBE_CHIPS } from "../lib/vibeChips";

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

for (const chip of VIBE_CHIPS.filter((chip) => chip.id !== "bender")) {
  test(`${chip.label} submits the actual starter question to the keyless chat route`, async ({ page }) => {
    await page.goto("/pal/chat");
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/pub-pal/chat" && response.request().method() === "POST",
    );
    await expect(async () => {
      await page.getByRole("button", { name: chip.label, exact: true }).click();
      await expect(page.getByText(chip.ask, { exact: true })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().query).toBe(chip.ask);
    const body = await response.json();
    const expectedTool = {
      bender: "propose_plan", lit: "whats_on", quiet: "search_venues", cheeky: "search_venues",
      match: "whats_on", quiz: "whats_on", date: "search_venues",
    }[chip.id];
    expect(body.toolsUsed).toEqual([expectedTool]);
    if (["lit", "match", "quiz"].includes(chip.id)) {
      const occasion = { lit: /live-music nights? tonight/i, match: /live-sport screenings? tonight/i, quiz: /quiz nights? tonight/i }[chip.id as "lit" | "match" | "quiz"];
      expect(body.answer).toMatch(occasion);
      expect(body.cards.every((card: { provenance?: { kind: string } }) => card.provenance?.kind === "whats-on")).toBe(true);
    }

    if (["quiet", "cheeky", "date"].includes(chip.id)) {
      expect(body.cards.length).toBeGreaterThan(0);
      expect(body.proposals).toContainEqual(expect.objectContaining({ kind: "open_venue" }));
      expect(body.cards.every((card: { price: number; provenance?: { kind: string } }) => typeof card.price === "number" && card.provenance?.kind === "directory")).toBe(true);
      if (chip.id === "cheeky") expect(body.cards.every((card: { price: number }) => card.price <= 6)).toBe(true);
      if (chip.id === "quiet") expect(body.cards.some((card: { note: string }) => /calmer fit/i.test(card.note))).toBe(true);
      if (chip.id === "date") expect(body.cards.some((card: { note: string }) => /calmer fit|date-night fit/i.test(card.note))).toBe(true);
    }

    expect(body.answer).not.toMatch(/not prices for that item|can't compare/i);
    await expect(page.getByText(chip.ask, { exact: true })).toBeVisible();
  });
}

for (const query of ["somewhere cheap and quiet", "Somewhere cheap in Soho"]) {
  test(`typed discovery retains the budget through chat: ${query}`, async ({ page }) => {
    await page.goto("/pal/chat");
    const input = page.getByRole("textbox", { name: "Describe the outing", exact: true });
    await expect(input).toBeVisible();
    await input.fill(query);
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/pub-pal/chat" && response.request().method() === "POST",
    );
    await input.press("Enter");
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().query).toBe(query);
    const body = await response.json();
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.cards.every((card: { price: number }) => card.price <= 6)).toBe(true);
    await expect(page.getByText(query, { exact: true })).toBeVisible();
  });
}

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

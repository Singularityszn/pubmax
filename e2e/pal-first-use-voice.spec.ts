import { expect, test } from "@playwright/test";

import { VIBE_CHIPS } from "../lib/vibeChips";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const width of [390, 1440]) {
  test(`${width}px: Sherlock Holmes wine response opens its published Menu`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await installDeterministicMapBasemap(page);
    await page.goto("/pal/chat");
    const input = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await input.fill("Wine prices at Sherlock Holmes");
    const reply = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/pub-pal/chat" && response.request().method() === "POST",
    );
    await input.press("Enter");
    const response = await reply;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(body.cards).toHaveLength(8);
    expect(body.cards).toContainEqual(expect.objectContaining({ venueId: "venue-gk2fp9", price: 7.2,
      menuEvidence: expect.objectContaining({ itemName: "Organic Pinot Grigio, Riff, Italy", serving: null, caloriesKcal: null, observedAt: "2026-09-21T18:41:07.759Z" }),
      provenance: expect.objectContaining({ kind: "published-menu", url: "https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu" }),
    }));
    expect(body.answer).toContain("£7.20");
    expect(body.answer).toContain("Serving size not recorded.");
    expect(body.answer).toContain("Price observed 2026-09-21.");
    expect(body.proposals).toMatchObject([{ kind: "open_venue", label: "Open Sherlock Holmes", venueId: expect.any(String) }]);
    await expect(page.getByText(body.answer, { exact: true })).toBeVisible();
    const publishedCard = page.locator(".palChatCard").filter({ hasText: "Organic Pinot Grigio, Riff, Italy" });
    await expect(publishedCard).toHaveCount(1);
    await expect(publishedCard).toContainText("£7.20");
    await expect(publishedCard).toContainText("Serving size not recorded.");
    await expect(publishedCard).toContainText("Price observed 2026-09-21.");
    await expect(publishedCard.locator('a[href="https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu"]')).toBeVisible();
    const venueLink = publishedCard.locator(`a.palChatCardMain[href="/map?sel=${body.proposals[0].venueId}"]`);
    await expect(venueLink).toBeVisible();
    await venueLink.click();
    await expect(page).toHaveURL(new RegExp(`sel=${body.proposals[0].venueId}`));
    const menu = page.getByRole("tab", { name: "Menu", exact: true });
    await expect(async () => {
      await menu.click();
      await expect(menu).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const panel = page.locator("#venuePanel-menu");
    await panel.locator('[data-menu-door="wine"]').click();
    const row = panel.locator(".drinkRow").filter({ has: page.getByText("Organic Pinot Grigio, Riff, Italy", { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".drinkPrice")).toHaveText("£7.20");
    await expect(row.locator(".drinkServing")).toHaveCount(0);
    await expect(row.locator(".drinkProvChip")).toHaveAttribute("href", "https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu");
    await expect(row.locator("time")).toHaveAttribute("datetime", "2026-09-21T18:41:07.759Z");
  });
}

for (const query of [
  "Directions to Fox and Anchor",
  "How do I get from Kings Cross to Fox and Anchor?",
  "Directions to Fox & Anchor from Kings Cross",
  "Directions to Fox and Anchor from Fox and Firkin this evening",
]) {
  test(`the rendered chat preserves the complete journey question: ${query}`, async ({ page }) => {
    await page.goto("/pal/chat");
    const input = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await input.fill(query);
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/pub-pal/chat" && response.request().method() === "POST",
    );
    await input.press("Enter");
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().query).toBe(query);
    const body = await response.json();
    expect(body.toolsUsed).toEqual(["journey"]);
    expect(body.cards.length, `Journey service returned no canonical destination evidence: ${body.answer}`).toBeGreaterThan(0);
    expect(body.cards.every((card: { venueId: string; place: string }) => card.venueId === "venue-phg4ss" && card.place === "Fox and Anchor")).toBe(true);
    // Distinct upstream fixtures catch a lost origin as well as a lost destination.
    const durationMinutes = query.includes("Fox and Firkin") ? 42 : query.includes("Kings Cross") ? 18 : 12;
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].note).toBe(`${durationMinutes} min`);
    expect(body.proposals).toContainEqual(expect.objectContaining({ kind: "open_venue", venueId: "venue-phg4ss" }));
    expect(body.proposals.every((proposal: { kind: string; venueId: string }) => proposal.kind === "open_venue" && proposal.venueId === "venue-phg4ss")).toBe(true);
    expect(body.answer).toMatch(/journey/i);
    await expect(page.getByText(query, { exact: true })).toBeVisible();
    await expect(page.getByText(body.answer, { exact: true })).toBeVisible();
  });
}

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
    const input = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
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

for (const query of [
  "Find me the cheapest pub in Soho, with a glass of wine near the Tube",
  "Somewhere cheap for a burger near Elephant and Castle station",
  "Somewhere cheap in Soho with bottles of Coke near the Tube",
  "Wine prices at Fox and Anchor",
  "Wine prices at Fox and Anchor this evening?",
  "Pint prices at Fox and Anchor now?",
  "Drink prices later at Fox and Anchor?",
  "Wine prices at Fox & Anchor",
  "Wine prices at The Black Friar, Blackfriars",
]) {
  test(`typed item and destination constraints survive rendered chat: ${query}`, async ({ page }) => {
    await page.goto("/pal/chat");
    const input = page.getByRole("textbox", { name: "Where, how many, what budget", exact: true });
    await expect(input).toBeVisible();
    await input.fill(query);
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/pub-pal/chat" && response.request().method() === "POST",
    );
    await input.press("Enter");
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.json();
    const namedPrice = /^(?:Wine|Pint|Drink) prices/.test(query);
    expect(body.toolsUsed).toEqual(namedPrice ? [query.startsWith("Pint") ? "venue_prices" : "venue_drinks"] : []);
    if (namedPrice) {
      expect(body.answer).toContain(query.includes("Black Friar") ? "The Blackfriar" : "Fox and Anchor");
      if (query.startsWith("Wine")) expect(body.answer).toMatch(/wine/i);
    } else {
      expect(body.answer).toMatch(/other drinks across pubs|meal prices|not prices for that item/i);
      expect(body.cards).toEqual([]);
      expect(body.proposals).toEqual([]);
    }
    if (!namedPrice || query.startsWith("Wine")) expect(body.cards.every((card: { note: string }) => !/listed pint|recorded pint/i.test(card.note))).toBe(true);
    await expect(page.getByText(body.answer, { exact: true })).toBeVisible();
    await expect(page.getByText(query, { exact: true })).toBeVisible();
  });
}

test("the phone voice choice survives Back and reload without unused character controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");
  await expect(async () => {
    await page.getByRole("button", { name: "Meet your Pub Pal", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Before you start", exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("checkbox", { name: /18 or over/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose your Pub Pal", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: /^Name/ }).fill("Beacon");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose its look", exact: true })).toBeVisible();
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

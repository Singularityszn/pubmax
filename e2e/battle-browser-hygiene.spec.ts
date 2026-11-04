import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installAuthDoubles } from "./helpers/authDoubles";

test("published navigation links resolve through safe GET requests", async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const links = new Set<string>();
  for (const path of ["/", "/tonight", "/plan", "/credits"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    for (const href of await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href))) {
      const url = new URL(href);
      if (url.origin === new URL(page.url()).origin) links.add(url.pathname + url.search);
    }
  }
  const receipts: Array<{ path: string; status: number }> = [];
  for (const path of [...links].sort()) {
    const response = await request.get(path, { maxRetries: 2 });
    receipts.push({ path, status: response.status() });
    expect(response.status(), `Published internal link ${path}`).toBeLessThan(400);
  }
  expect(receipts.length).toBeGreaterThan(10);
  const receiptPath = info.outputPath("internal-link-get-receipts.json");
  await writeFile(receiptPath, JSON.stringify(receipts, null, 2));
  await info.attach("internal-link-get-receipts", { path: receiptPath, contentType: "application/json" });
});

for (const width of [1280, 390]) {
  test(`Tonight explains a pub through the keyboard at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    // A real button, reachable by role on desktop and phone (live walk F20).
    const toggle = page.getByRole("button", { name: "Why this pub" }).first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
    // The button is painted on the server, so an Enter before hydration is
    // dropped. Retry the key press with its result (e2e/AGENTS.md), and press
    // only while the state is still the old one, so a slow answer is never
    // toggled back.
    const pressEnterUntil = async (expanded: "true" | "false") => {
      await expect(async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== expanded) {
          await toggle.focus();
          await page.keyboard.press("Enter");
        }
        await expect(toggle).toHaveAttribute("aria-expanded", expanded, { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
    };
    await pressEnterUntil("true");
    await expect(panel.locator("p").first()).toBeVisible();
    await expect(panel.locator("p").first()).not.toBeEmpty();
    await page.screenshot({ path: info.outputPath("tonight-why-keyboard.png"), fullPage: true });
    await pressEnterUntil("false");
    await expect(panel).toBeHidden();
  });

  test(`analytics denial survives the Home, map and Tonight journey at ${width}px`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      if (!sessionStorage.getItem("battle-consent-prepared")) {
        localStorage.removeItem("pubmaxx:analytics-consent:v1");
        sessionStorage.setItem("battle-consent-prepared", "1");
      }
    });
    const prompt = page.getByLabel("Anonymous analytics choice");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("pubmax:consent-first-route:v1")), { timeout: 30_000 }).not.toBeNull();
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("pubmax:consent-answer-moment:v1")), { timeout: 30_000 }).not.toBeNull();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await prompt.getByRole("button", { name: "No thanks", exact: true }).click();
    await expect(prompt).toHaveCount(0);
    // The live walk's own routes (F19, 30 Oct): a pub selected on the map, a
    // pub ledger, Tonight and Pal.
    const ledgerId = await page.evaluate(async () => {
      const response = await fetch("/sitemap.xml");
      return /\/ledger\/([^<"]+)/.exec(await response.text())?.[1] ?? null;
    });
    expect(ledgerId).not.toBeNull();
    for (const path of ["/map?log=1", `/map?sel=${ledgerId}`, `/ledger/${ledgerId}`, "/tonight", "/pal", "/"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect.poll(() => page.evaluate(() => localStorage.getItem("pubmaxx:analytics-consent:v1"))).toBe("denied");
      await expect(prompt).toHaveCount(0);
    }
    await page.reload();
    await expect(prompt).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("pubmaxx:analytics-consent:v1"))).toBe("denied");
    await page.screenshot({ path: info.outputPath("consent-denied-after-navigation.png"), fullPage: true });
  });

  test(`a failed import preserves the private list for a retry at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const auth = await installAuthDoubles(page);
    const submitted: unknown[] = [];
    await page.route("**/api/pub-list-import", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { drafts: [] } });
        return;
      }
      const body: { text?: string } = route.request().postDataJSON();
      submitted.push(body);
      const items = [
        { rawLine: "The Harp, Soho", name: "The Harp", areaHint: "Soho", state: "matched",
          venue: { id: "harp", name: "The Harp", area: "Soho", layer: "curated" } },
        { rawLine: "The Crown, Soho", name: "The Crown", areaHint: "Soho", state: "matched",
          venue: { id: "crown", name: "The Crown", area: "Soho", layer: "curated" } },
      ];
      await route.fulfill(submitted.length === 1
        ? { status: 503, json: { error: "Matching is unavailable. Try again." } }
        : { json: { importId: "retry-fixture", source: null, truncated: false,
          items: body.text?.includes("\n") ? items : items.slice(0, 1) } });
    });
    await page.goto("/plan");
    const door = page.getByRole("button", { name: "Import a pub list", exact: true });
    await expect(async () => {
      await door.click();
      await expect(page.getByRole("dialog", { name: "Import a pub list" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    const dialog = page.getByRole("dialog", { name: "Import a pub list" });
    await expect(dialog.getByRole("link", { name: "Sign in to import a pub list" })).toBeVisible();
    await expect(dialog.getByLabel("Paste your pub list")).toHaveCount(0);
    expect(submitted).toEqual([]);
    await page.keyboard.press("Escape");
    await auth.signedInAs("A");
    await page.reload();
    await expect(async () => {
      await door.click();
      await expect(dialog.getByLabel("Paste your pub list")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    const text = dialog.getByLabel("Paste your pub list");
    await text.fill("The Harp, Soho");
    const match = dialog.getByRole("button", { name: "Match these pubs" });
    await match.click();
    await expect(dialog.getByRole("status")).toHaveText("Matching is unavailable. Try again.");
    await expect(text).toHaveValue("The Harp, Soho");
    await expect(match).toBeEnabled();
    await match.click();
    await expect(dialog.getByText("1 line to review.", { exact: false })).toBeVisible();
    await expect(text).toHaveCount(0);
    expect(submitted).toEqual([{ text: "The Harp, Soho" }, { text: "The Harp, Soho" }]);
    await dialog.getByRole("button", { name: "Import another list", exact: true }).click();
    await text.fill("The Harp, Soho\nThe Crown, Soho");
    await match.click();
    await expect(dialog.getByText("2 lines to review.", { exact: false })).toBeVisible();
    await expect(text).toHaveCount(0);
    expect(submitted).toEqual([
      { text: "The Harp, Soho" }, { text: "The Harp, Soho" },
      { text: "The Harp, Soho\nThe Crown, Soho" },
    ]);
    await page.screenshot({ path: info.outputPath("import-retry.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(door).toBeFocused();
  });
}

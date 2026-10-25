import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installAuthDoubles } from "./helpers/authDoubles";

const venue = (id: string, name: string, area: string) => ({ id, name, area, layer: "curated" });

test("reviews a pasted list at 390px with keyboard, honest states and private saving", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const auth = await installAuthDoubles(page);
  const savedBodies: Record<string, unknown>[] = [];
  const imported = {
    importId: "53c329da-dcda-49be-abcd-337b90996c36", source: null, truncated: false,
    items: [
      { rawLine: "The Harp, Soho - cosy", name: "The Harp", areaHint: "Soho", state: "matched", venue: venue("harp", "The Harp", "Soho") },
      { rawLine: "The Crown", name: "The Crown", areaHint: "", state: "ambiguous", candidateCount: 2, candidates: [venue("crown-soho", "The Crown", "Soho"), venue("crown-camden", "The Crown", "Camden")] },
      { rawLine: "Imaginary Arms", name: "Imaginary Arms", areaHint: "", state: "unmatched" },
      { rawLine: "Old Bell", name: "Old Bell", areaHint: "", state: "closed", venue: { ...venue("closed", "Old Bell", "Soho"), closed: true } },
      { rawLine: "Blue Bell", name: "Blue Bell", areaHint: "", state: "matched", venue: { ...venue("national", "Blue Bell", "York"), layer: "national", price: null } },
    ],
  };
  await page.route("**/api/pub-list-import", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: { drafts: [] } }); return;
    }
    const body = request.postDataJSON();
    if (body.action === "save") {
      savedBodies.push(body);
      await route.fulfill({ json: { draft: { id: imported.importId, venueIds: body.venueIds, source: null, createdAt: "2026-10-22T12:00:00Z" } } });
    } else if (body.text === "The Harp, Soho") {
      await route.fulfill({ json: { ...imported, items: [imported.items[0]] } });
    } else await route.fulfill({ json: imported });
  });
  await page.goto("/plan");
  await auth.signedInAs("A");
  await page.reload();
  const door = page.getByRole("button", { name: "Import a pub list", exact: true });
  await expect(async () => {
    await door.click();
    await expect(page.getByRole("dialog", { name: "Import a pub list" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const dialog = page.getByRole("dialog", { name: "Import a pub list" });
  await expect(dialog.getByLabel("Paste your pub list")).toBeVisible();
  await dialog.getByLabel("Paste your pub list").fill("The Harp\nThe Crown\nImaginary Arms\nOld Bell\nBlue Bell");
  await dialog.getByRole("button", { name: "Match these pubs" }).click();
  await expect(dialog.getByText("5 lines to review.", { exact: false })).toBeInViewport();
  await expect(dialog.getByText("We couldn't find this one", { exact: true })).toBeAttached();
  await expect(dialog.getByText("No price listed", { exact: false })).toBeAttached();
  await expect(dialog.getByRole("button", { name: "Plan a crawl from these" })).toBeDisabled();
  await expect(dialog.getByLabel("Paste your pub list")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("pub-list-import-390-review.png"), fullPage: true, style: "nextjs-portal { visibility: hidden; }" });
  const size = await dialog.evaluate((node) => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, overflow: node.scrollWidth > node.clientWidth }));
  expect(size.left).toBeGreaterThanOrEqual(0);
  expect(size.right).toBeLessThanOrEqual(390);
  expect(size.overflow).toBe(false);
  const choices = dialog.getByLabel("Which The Crown?");
  await choices.selectOption("crown-soho");
  await expect(choices).toHaveCount(0);
  await dialog.getByRole("button", { name: "Edit line 3" }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await dialog.getByLabel("Edit line 3", { exact: true }).fill("The Harp, Soho");
  await dialog.getByRole("button", { name: "Match edited line" }).click();
  await expect(dialog.getByText("We couldn't find this one", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Remove line 4" }).click();
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await save.scrollIntoViewIfNeeded();
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Saved as a night draft");
  await dialog.getByRole("status").scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("status")).toBeInViewport({ ratio: 1 });
  expect(savedBodies).toEqual([{ action: "save", importId: imported.importId, venueIds: ["harp", "crown-soho", "national"] }]);
  await page.screenshot({ path: testInfo.outputPath("pub-list-import-390.png"), fullPage: true, style: "nextjs-portal { visibility: hidden; }" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(door).toBeFocused();
});

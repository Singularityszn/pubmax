import { expect, test } from "@playwright/test";
import { runAccessibilityGate } from "./accessibilityGate";

test("axe gate accepts a serious/critical-clean document", async ({ page }, testInfo) => {
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head><title>Accessibility gate fixture</title></head>
      <body>
        <main>
          <h1>Find a trusted pint</h1>
          <button type="button">Use this Venue</button>
        </main>
      </body>
    </html>
  `);

  const results = await runAccessibilityGate({ page, testInfo });
  expect(
    results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("axe gate rejects an intentional serious contrast failure", async ({ page }, testInfo) => {
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head><title>Accessibility failing fixture</title></head>
      <body style="background:#fff">
        <main><p style="color:#aaa">Unreadable fixture</p></main>
      </body>
    </html>
  `);

  await expect(runAccessibilityGate({ page, testInfo })).rejects.toThrow(
    /serious:color-contrast/,
  );
});

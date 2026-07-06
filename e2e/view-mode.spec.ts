import { expect, test } from "@playwright/test";

// View Mode (Lock-In / Ledger) switch — WebGL-agnostic. We exercise the switch's
// behaviour contract only: does html[data-mode] flip, does Ledger compose the
// existing html[data-legacy] flag, and do both persist across a reload. No map
// canvas / WebGL is required, so we drive it from /feed where SiteNav (and its
// actions cluster) render in normal flow. Mirrors the smoke spec's theme-toggle
// test style: read the pre-hydration attribute, click, assert flip + storage +
// survival across reload.

test("view-mode switch flips html[data-mode], composes data-legacy, persists across reload", async ({
  page,
}) => {
  await page.goto("/feed");

  const html = page.locator("html");
  // The no-flash script sets data-mode before hydration, defaulting to lock-in.
  await expect(html).toHaveAttribute("data-mode", "lock-in");

  // Ledger option lives in the nav's radiogroup. force: it can sit under the
  // floating bar in headless layout; we assert the contract, not hit-testing.
  await page
    .getByRole("radio", { name: /ledger/i })
    .click({ force: true });

  // Ledger IS the heritage view: it drives data-mode AND the SAME data-legacy
  // attribute Legacy Mode owns (no forked flag).
  await expect(html).toHaveAttribute("data-mode", "ledger");
  await expect(html).toHaveAttribute("data-legacy", "1");

  // Persisted under both keys (mode + the composed legacy flag).
  const storedMode = await page.evaluate(() => localStorage.getItem("pubmax-mode"));
  const storedLegacy = await page.evaluate(() =>
    localStorage.getItem("pubmax-legacy"),
  );
  expect(storedMode).toBe("ledger");
  expect(storedLegacy).toBe("1");

  // Survives a reload — the no-flash script re-applies both attributes, and the
  // switch's mount effect re-asserts them (React 19 hydration can drop them).
  await page.reload();
  await expect(html).toHaveAttribute("data-mode", "ledger");
  await expect(html).toHaveAttribute("data-legacy", "1");

  // And it's reversible — flipping back to Lock-In clears the legacy flag.
  await page
    .getByRole("radio", { name: /lock-in/i })
    .click({ force: true });
  await expect(html).toHaveAttribute("data-mode", "lock-in");
  await expect(html).not.toHaveAttribute("data-legacy", "1");
  const clearedLegacy = await page.evaluate(() =>
    localStorage.getItem("pubmax-legacy"),
  );
  expect(clearedLegacy).toBe("0");
});

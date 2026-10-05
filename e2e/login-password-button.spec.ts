import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${viewport.width}px ${theme}: handle sign-in submit uses the rendered button surface`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((value) => {
        localStorage.setItem("pubmax-theme", value);
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
      }, theme);
      const posts: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
      });

      const response = await page.goto("/login");
      expect(response?.status()).toBe(200);
      const form = page.getByRole("form", { name: "Sign in with handle and password" });
      const toggle = page.getByRole("button", { name: "Sign in with handle and password", exact: true });
      await expect(async () => {
        await toggle.click();
        await expect(form).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      const submit = form.getByRole("button", { name: "Sign in", exact: true });
      await expect(submit).toBeEnabled();
      await expect(form.getByLabel("Handle", { exact: true })).toHaveValue("");
      await expect(form.getByLabel("Password", { exact: true })).toHaveValue("");
      await submit.scrollIntoViewIfNeeded();
      const measured = await submit.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        // Resolve the same public theme tokens through CSS, rather than
        // accepting a class name whose stylesheet might not have loaded.
        const token = document.createElement("span");
        token.style.backgroundColor = "var(--control-secondary-surface, var(--color-surface-raised))";
        token.style.borderRadius = "var(--control-radius, 14px)";
        token.style.fontWeight = "var(--control-font-weight, 700)";
        token.style.position = "absolute";
        token.style.visibility = "hidden";
        element.append(token);
        const resolved = getComputedStyle(token);
        const expectedBackground = resolved.backgroundColor;
        const expectedRadius = resolved.borderTopLeftRadius;
        const expectedFontWeight = resolved.fontWeight;
        token.remove();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          viewport: { width: innerWidth, height: innerHeight },
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
          width: rect.width, height: rect.height,
          display: style.display,
          fontWeight: style.fontWeight,
          radius: style.borderTopLeftRadius,
          background: style.backgroundColor,
          expectedBackground, expectedRadius, expectedFontWeight,
          pointerOwned: hit !== null && element.contains(hit),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      await testInfo.attach("login-password-button-measurements", {
        body: JSON.stringify(measured), contentType: "application/json",
      });
      await testInfo.attach(`login-password-button-${viewport.width}-${theme}`, {
        body: await page.screenshot(), contentType: "image/png",
      });
      expect(measured.viewport).toEqual(viewport);
      expect(measured.theme).toBe(theme);
      expect(measured.height).toBeGreaterThanOrEqual(44);
      expect(measured.width).toBeGreaterThanOrEqual(44);
      // A flex item's outer inline display is blockified by CSS; both
      // computed values retain the primitive's flex layout.
      expect(["flex", "inline-flex"]).toContain(measured.display);
      expect(measured.fontWeight).toBe(measured.expectedFontWeight);
      expect(parseFloat(measured.radius)).toBeGreaterThan(0);
      expect(measured.radius).toBe(measured.expectedRadius);
      expect(measured.expectedBackground).not.toBe("rgba(0, 0, 0, 0)");
      expect(measured.background).toBe(measured.expectedBackground);
      expect(measured.overflow).toBeLessThanOrEqual(1);
      expect(measured.pointerOwned).toBe(true);
      expect(posts).toEqual([]);
    });
  }
}

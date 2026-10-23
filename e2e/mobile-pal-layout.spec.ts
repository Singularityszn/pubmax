import { expect, test } from "@playwright/test";

for (const scenario of [
  { viewport: { width: 390, height: 844 }, colorScheme: "light" as const },
  { viewport: { width: 430, height: 932 }, colorScheme: "dark" as const },
]) {
  const { viewport, colorScheme } = scenario;
  test(`keeps Pub Pal onboarding clear at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
        version: 1,
        activatedAt: new Date().toISOString(),
      }));
    });
    await page.goto("/pal");
    const meetButton = page.getByRole("button", { name: "Meet your Pub Pal" });
    const meetButtonBox = await meetButton.boundingBox();
    expect(meetButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await meetButton.click();

    const preview = page.locator(".palOnboardingPreview");
    const panel = page.locator(".palOnboardingPanel");
    const actions = page.locator(".palOnboardingActions");
    const [previewBox, panelBox, actionsBox] = await Promise.all([
      preview.boundingBox(),
      panel.boundingBox(),
      actions.boundingBox(),
    ]);

    expect(previewBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect((previewBox?.y ?? 0) + (previewBox?.height ?? 0)).toBeLessThanOrEqual(
      (panelBox?.y ?? 0) + 1,
    );
    expect((actionsBox?.x ?? -1) + (actionsBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    await expect(page.locator(".palPortraitCore")).toBeVisible();
    await expect(page.locator(".palPortraitCore")).toHaveCSS("animation-name", "none");
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(viewport.width);

    // ONE SURFACE, TOP TO BOTTOM (UX sprint, 15 Oct 2026, 390x844 dark): below
    // the Continue bar the page changed colour. The surface was painted on the
    // main box, so it stopped where the box stopped and the body's own gradient
    // showed under it, and the in-flow bar drew a fill band of its own across
    // the page. The body paints the canvas now, and nothing inside repaints it.
    // The canvas is plain paper since the taste pass (18 Oct 2026) took the
    // coral and river washes off it, so the body's fill is the paper token.
    const surface = await page.evaluate(() => {
      const read = (element: Element | null) => {
        if (!element) return null;
        const style = getComputedStyle(element);
        return { color: style.backgroundColor, image: style.backgroundImage };
      };
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--paper)";
      document.body.append(probe);
      const paper = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        paper,
        body: read(document.body),
        main: read(document.querySelector(".palExperience")),
        bar: read(document.querySelector(".palOnboardingActions")),
      };
    });
    expect(surface.paper, "the paper token resolves to a fill").not.toBe("rgba(0, 0, 0, 0)");
    expect(surface.body?.color, "the body paints the Pal canvas").toBe(surface.paper);
    expect(surface.body?.image, "the canvas is plain paper, with no wash").toBe("none");
    expect(surface.main, "the main box is in the document").not.toBeNull();
    expect(surface.main?.image, "the main box paints no surface of its own").toBe("none");
    expect(surface.main?.color, "the main box paints no fill of its own").toBe("rgba(0, 0, 0, 0)");
    expect(surface.bar, "the Continue bar is in the document").not.toBeNull();
    expect(surface.bar?.image, "the Continue bar paints no band").toBe("none");
    expect(surface.bar?.color, "the Continue bar paints no band").toBe("rgba(0, 0, 0, 0)");

    await page.getByRole("checkbox", { name: /18 or over/ }).check();
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("button", { name: /^Black Cat/ }).click();
    await expect(page.getByRole("button", { name: /^Black Cat/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Fox/ }).click();
    await expect(page.getByRole("button", { name: /^Fox/ })).toHaveAttribute("aria-pressed", "true");
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`keeps the Pub Pal first meeting composed at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: viewport.width === 1280 ? "light" : "dark" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
        version: 1,
        activatedAt: new Date().toISOString(),
      }));
    });
    await page.goto("/pal");

    await expect(page.getByRole("heading", { name: "A little signal that becomes yours." })).toBeVisible();
    await expect(page.locator(".palPortraitCore")).toBeVisible();
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(viewport.width);
  });
}

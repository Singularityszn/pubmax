import { expect, test } from "@playwright/test";

// The landing's drawing of London names a handful of historic pubs. A label
// laid over another label or over a named pin reads as one tangle (site audit
// 13 Sep 2026, D21), so what a unit test estimates, the browser measures: at a
// phone, a tablet and a desktop, no painted name or date touches a named pin,
// and no pin's writing runs into another pin's. A plain pub dot may sit under
// the writing, which carries a halo to stay legible over it. The unit fence
// beside it is __tests__/landingMapSnapshot.test.ts.

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

type Box = { left: number; right: number; top: number; bottom: number };
type Measured = {
  texts: { pin: number; text: string; box: Box }[];
  pins: Box[];
};

for (const viewport of WIDTHS) {
  test(`no pin label covers a named pin or another label at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const map = page.locator("svg.lpMapSnapshot");
    await expect(map).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const measured: Measured = await map.evaluate((node) => {
      const svg = node as SVGSVGElement;
      const toBox = (rect: DOMRect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      });
      const texts = [...svg.querySelectorAll(".lpMapPins > g")].flatMap((group, pin) =>
        [...group.querySelectorAll("text")].map((text) => ({
          pin,
          text: text.textContent ?? "",
          box: toBox(text.getBoundingClientRect()),
        })),
      );
      const pins = [...svg.querySelectorAll(".lpMapPinDot")].map((circle) =>
        toBox(circle.getBoundingClientRect()),
      );
      return { texts, pins };
    });

    // At least four named pins, a name and a date each, or there is nothing to measure.
    expect(measured.texts.length).toBeGreaterThanOrEqual(8);

    const overlaps = (a: Box, b: Box) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const collisions: string[] = [];
    for (const text of measured.texts) {
      const covered = measured.pins.filter((pin) => overlaps(text.box, pin));
      if (covered.length > 0) collisions.push(`"${text.text}" covers ${covered.length} named pins`);
      for (const other of measured.texts) {
        if (other.pin <= text.pin) continue;
        if (overlaps(text.box, other.box)) collisions.push(`"${text.text}" runs into "${other.text}"`);
      }
    }
    expect(collisions).toEqual([]);
  });
}

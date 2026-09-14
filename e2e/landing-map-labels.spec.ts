import { expect, test } from "@playwright/test";

// The landing's drawing of London names a handful of historic pubs. A name laid
// over the City's cluster of pub dots reads with pubs through it (site audit
// 13 Sep 2026, D21), so what a unit test estimates, the browser measures: at a
// phone, a tablet and a desktop, no painted name or date touches a pub mark,
// and no pin's writing runs into another pin's. The unit fence beside it is
// __tests__/landingMapSnapshot.test.ts.

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

type Box = { left: number; right: number; top: number; bottom: number };
type Measured = {
  texts: { pin: number; text: string; box: Box }[];
  marks: { kind: "dot" | "pin"; box: Box }[];
};

for (const viewport of WIDTHS) {
  test(`no pin label covers a pub mark at ${viewport.width}`, async ({ page }) => {
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
      const pins = [...svg.querySelectorAll(".lpMapPinDot")].map((circle) => ({
        kind: "pin" as const,
        box: toBox(circle.getBoundingClientRect()),
      }));
      // Every dot is one subpath of ONE path, so its box comes from the path
      // data through the SVG's own screen transform rather than from an element.
      const matrix = svg.getScreenCTM();
      const d = svg.querySelector(".lpMapDots")?.getAttribute("d") ?? "";
      const dots = [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)a([\d.]+)/g)].map(([, x, y, r]) => {
        const radius = Number(r);
        const centre = new DOMPoint(Number(x) + radius, Number(y)).matrixTransform(matrix ?? undefined);
        const scaled = radius * (matrix?.a ?? 1);
        return {
          kind: "dot" as const,
          box: {
            left: centre.x - scaled,
            right: centre.x + scaled,
            top: centre.y - scaled,
            bottom: centre.y + scaled,
          },
        };
      });
      return { texts, marks: [...pins, ...dots] };
    });

    expect(measured.texts.length).toBeGreaterThanOrEqual(8);
    expect(measured.marks.filter((mark) => mark.kind === "dot").length).toBeGreaterThan(100);

    const overlaps = (a: Box, b: Box) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const collisions: string[] = [];
    for (const text of measured.texts) {
      const covered = measured.marks.filter((mark) => overlaps(text.box, mark.box));
      if (covered.length > 0) collisions.push(`"${text.text}" covers ${covered.length} pub marks`);
      for (const other of measured.texts) {
        if (other.pin <= text.pin) continue;
        if (overlaps(text.box, other.box)) collisions.push(`"${text.text}" runs into "${other.text}"`);
      }
    }
    expect(collisions).toEqual([]);
  });
}

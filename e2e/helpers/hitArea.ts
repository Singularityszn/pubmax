import type { Locator, Page } from "@playwright/test";

export type HitArea = {
  /** The element's own box. */
  boxWidth: number;
  boxHeight: number;
  /** How far a tap through its centre lines still lands on it, pseudo-elements included. */
  hitWidth: number;
  hitHeight: number;
};

/**
 * Measure the area a tap lands on an element, by walking out from its centre
 * along each axis and asking the browser what is under each point. A
 * pseudo-element that widens the hit area counts; a sibling painted over it
 * does not.
 */
export async function measureHitArea(target: Locator): Promise<HitArea> {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const lands = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    };
    const reach = (step: (n: number) => [number, number]) => {
      let n = 0;
      while (n < 80 && lands(...step(n + 1))) n += 1;
      return n;
    };
    const up = reach((n) => [cx, cy - n]);
    const down = reach((n) => [cx, cy + n]);
    const left = reach((n) => [cx - n, cy]);
    const right = reach((n) => [cx + n, cy]);
    return {
      boxWidth: box.width,
      boxHeight: box.height,
      hitWidth: left + right + 1,
      hitHeight: up + down + 1,
    };
  });
}

/**
 * The computed colour a CSS colour expression resolves to inside `scope`, so a
 * check can compare an element against a theme token rather than a literal.
 */
export async function resolvedColour(
  page: Page,
  scope: string,
  expression: string,
): Promise<string> {
  return page.evaluate(
    ({ scope, expression }) => {
      const host = document.querySelector(scope) ?? document.body;
      const probe = document.createElement("span");
      probe.style.color = expression;
      host.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    },
    { scope, expression },
  );
}

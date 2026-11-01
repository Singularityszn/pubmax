import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Wait until an element has reached its resting layout.
 *
 * A layout check that reads a box mid-motion measures a sheet scaling in, a
 * chip under its rest size or a drawer short of its edge. Comparing two
 * boxes read a poll apart does not prove rest on a CI runner whose software
 * GL starves frames: both reads can land on the same stale frame while the
 * motion still has most of its way to go.
 *
 * This waits on what the product itself says instead:
 * - every finite CSS animation and transition on the element and its
 *   ancestors has finished (Web Animations API; a looping animation such as a
 *   spinner never rests, so it is not waited on);
 * - no `SpringDrawer` around it is running, which it publishes by holding
 *   `will-change: transform` only while its spring moves;
 * - the box then holds across two rendered frames.
 */
export async function expectLayoutSettled(
  locator: Locator,
  options: { timeout?: number } = {},
): Promise<void> {
  await expect(locator).toBeVisible(options);
  await expect
    .poll(
      () =>
        locator.evaluate(async (element) => {
          const nextFrame = () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });
          const moving = (node: Element) =>
            node.getAnimations().some((animation) => {
              const iterations = animation.effect?.getTiming().iterations;
              return (
                iterations !== Infinity &&
                (animation.playState === "running" ||
                  animation.pending)
              );
            });
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          ) {
            if (moving(node)) return false;
            if (
              node.classList.contains("springDrawer") &&
              getComputedStyle(node).willChange !== "auto"
            ) {
              return false;
            }
          }
          const before = element.getBoundingClientRect();
          await nextFrame();
          await nextFrame();
          const after = element.getBoundingClientRect();
          return (
            before.x === after.x &&
            before.y === after.y &&
            before.width === after.width &&
            before.height === after.height
          );
        }),
      {
        message: "element reaches its resting layout",
        timeout: options.timeout ?? 20_000,
      },
    )
    .toBe(true);
}

/**
 * Wait until the whole page has come to rest: every finite CSS animation and
 * transition in the document has finished, then two frames have rendered.
 *
 * A page-wide sweep needs this where a single target cannot name its own
 * element. A scroll walk trips scroll entrances (Discover's `[data-reveal]`
 * cards rise 14px into place), and a box read through a moving transform is
 * mapped through a matrix: a 44px link mid-rise can read 43.99px and fail a
 * 44px floor it meets at rest. A looping animation such as a spinner never
 * rests, so it is not waited on.
 */
export async function expectPageAtRest(
  page: Page,
  options: { timeout?: number } = {},
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const nextFrame = () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => resolve());
            });
          const moving = document.getAnimations().some((animation) => {
            const iterations = animation.effect?.getTiming().iterations;
            return (
              iterations !== Infinity &&
              (animation.playState === "running" || animation.pending)
            );
          });
          if (moving) return false;
          await nextFrame();
          await nextFrame();
          return true;
        }),
      {
        message: "the page reaches its resting layout",
        timeout: options.timeout ?? 20_000,
      },
    )
    .toBe(true);
}

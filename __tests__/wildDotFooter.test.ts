import { describe, expect, it } from "vitest";

import {
  canvasHeight,
  dotStep,
  dotsAtRest,
  pushRadius,
  scatterDots,
  settleDots,
  stepDots,
  type WordDot,
} from "@/components/wild/dotFooterMotion";

// The giant dot footer's physics (components/wild/dotFooterMotion.ts): a hand
// pushes the dots near it away, a spring brings every dot home, and the word
// comes to rest so the drawing loop can stop.

function dots(): WordDot[] {
  const out: WordDot[] = [];
  for (let x = 10; x <= 100; x += 10) {
    for (let y = 10; y <= 40; y += 10) out.push({ hx: x, hy: y, x, y, vx: 0, vy: 0, accent: x > 90 });
  }
  return out;
}

describe("the dot wordmark", () => {
  it("sizes to any width, with a dot spacing that is never too fine", () => {
    expect(dotStep(320)).toBe(4);
    expect(dotStep(1300)).toBe(10);
    expect(canvasHeight(320)).toBe(84);
    expect(canvasHeight(1100)).toBe(275);
    expect(canvasHeight(4000)).toBe(320);
    expect(pushRadius(320)).toBe(34);
    expect(pushRadius(4000)).toBe(96);
  });

  it("pushes the dots near a hand away and leaves the far ones alone", () => {
    const word = dots();
    const near = word.find((dot) => dot.hx === 50 && dot.hy === 20)!;
    const far = word.find((dot) => dot.hx === 100 && dot.hy === 40)!;
    stepDots(word, { x: 46, y: 20 }, 20);
    expect(near.x).toBeGreaterThan(50);
    expect(far.x).toBe(100);
    expect(far.y).toBe(40);
  });

  it("pushes harder on the frame a finger lands", () => {
    const soft = dots();
    const hard = dots();
    stepDots(soft, { x: 46, y: 20 }, 20, 1);
    stepDots(hard, { x: 46, y: 20 }, 20, 3);
    const at = (word: WordDot[]) => word.find((dot) => dot.hx === 50 && dot.hy === 20)!.x;
    expect(at(hard)).toBeGreaterThan(at(soft));
  });

  it("brings every dot home once the hand has gone, and comes to rest", () => {
    const word = dots();
    scatterDots(word, 120, 50);
    expect(word.some((dot) => dot.x !== dot.hx)).toBe(true);
    let motion = Number.POSITIVE_INFINITY;
    let frames = 0;
    while (!dotsAtRest(motion, word.length) && frames < 2000) {
      motion = stepDots(word, null, 20);
      frames += 1;
    }
    expect(frames).toBeLessThan(400);
    for (const dot of word) {
      expect(Math.abs(dot.x - dot.hx)).toBeLessThan(0.5);
      expect(Math.abs(dot.y - dot.hy)).toBeLessThan(0.5);
    }
    settleDots(word);
    expect(word.every((dot) => dot.x === dot.hx && dot.y === dot.hy && dot.vx === 0 && dot.vy === 0)).toBe(true);
  });

  it("calls an empty word at rest", () => {
    expect(dotsAtRest(0, 0)).toBe(true);
  });
});

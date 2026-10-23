// Two small helpers for a gesture that writes its own transform: the spring
// that takes over at release, and the soft edge before a boundary. Both are
// plain functions over lib/springMotion.ts, so a component keeps one physics
// and no extra state per frame.

import { isSpringSettled, stepSpring, type SpringConfig } from "@/lib/springMotion";

function reducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** How long a pointer may rest before release and still be moving. */
const RELEASE_REST_MS = 80;

/**
 * The velocity a gesture lets go with. Velocity is only sampled on a move, so a
 * pointer that stopped before it lifted would keep its last fast sample: it is
 * still, so it releases at rest.
 */
export function releaseVelocity(velocity: number, lastMoveTime: number, releaseTime: number): number {
  return releaseTime - lastMoveTime > RELEASE_REST_MS ? 0 : velocity;
}

/** Resistance past an edge: the further past, the less the element follows. */
export function rubberband(overshoot: number, dimension: number): number {
  const constant = 0.55;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Run a spring on one number and hand each frame to `write`, starting from the
 * live value and the release velocity (units per second). Returns a cancel.
 * Reduced motion lands on the target at once.
 */
export function springTo(
  from: number,
  velocity: number,
  target: number,
  config: SpringConfig,
  write: (value: number) => void,
  done: () => void,
): () => void {
  if (reducedMotion() || (from === target && velocity === 0)) {
    write(target);
    done();
    return () => {};
  }
  let state = { value: from, velocity };
  let last = performance.now();
  let frame = requestAnimationFrame(function tick(now) {
    state = stepSpring(state, target, (now - last) / 1000, config);
    last = now;
    if (isSpringSettled(state, target)) {
      write(target);
      done();
      return;
    }
    write(state.value);
    frame = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(frame);
}

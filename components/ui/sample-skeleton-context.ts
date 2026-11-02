"use client";

import { createContext, useContext } from "react";

/**
 * True inside a SampleSkeleton (components/ui/sample-skeleton.tsx).
 *
 * `inert` stops a sampled card being tapped or focused, but it cannot stop
 * what a component does on its own. Next prefetches every `Link` that comes
 * into view, so a sampled card would ask the server for its sample routes
 * while the reader waits for the real read. A real component asks this hook
 * and turns that kind of side effect off for its sample copy. It lives apart
 * from the primitive so a card can ask it without loading the skeleton's
 * stylesheet.
 */
export const SampleSkeletonContext = createContext(false);

export function useIsSample(): boolean {
  return useContext(SampleSkeletonContext);
}

/**
 * A clear one-pixel GIF for a sample picture. An image with a source draws its
 * own box, so a sampled avatar or photo becomes a block in its own shape, and
 * nothing is fetched to draw it.
 */
export const SAMPLE_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

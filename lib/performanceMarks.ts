export type PubmaxPerformanceMark =
  | "pubmax:drop-tap"
  | "pubmax:drop-route-ready"
  | "pubmax:map-chunk-ready"
  | "pubmax:slim-venues-ready"
  | "pubmax:composer-mounted"
  | "pubmax:composer-interactive"
  | "pubmax:first-pins"
  | "pubmax:pin-entrance-settled";

export function markPubmaxTiming(name: PubmaxPerformanceMark): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(name);
  } catch {
    // Timing marks are diagnostic only; locked-down browsers should not break UI.
  }
}

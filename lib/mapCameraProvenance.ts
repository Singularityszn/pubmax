import type { MapViewportSnapshot } from "@/lib/mobileShell";

export type MapCameraProvenance = {
  version: 1;
  source: "public-place";
};

export type MapCameraWrite = {
  provenance: MapCameraProvenance;
  isCurrent: () => boolean;
};

export function readMapCameraProvenance(value: unknown): MapCameraProvenance | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return raw.version === 1 && raw.source === "public-place"
    ? { version: 1, source: raw.source }
    : null;
}

function sameViewport(left: MapViewportSnapshot, right: MapViewportSnapshot): boolean {
  return left.center[0] === right.center[0] && left.center[1] === right.center[1] &&
    left.zoom === right.zoom && left.pitch === right.pitch && left.bearing === right.bearing;
}

/** Explicit intent permits one settled camera. Later automatic moves do not inherit it. */
export function createMapCameraOwnership(initial?: {
  viewport: MapViewportSnapshot | null;
  cameraProvenance?: MapCameraProvenance | null;
} | null) {
  let revision = 0;
  let active = true;
  let locationExposed = false;
  let held = initial?.viewport && readMapCameraProvenance(initial.cameraProvenance)
    ? { viewport: initial.viewport, provenance: readMapCameraProvenance(initial.cameraProvenance)! }
    : null;
  let pending: { source: MapCameraProvenance["source"]; center?: [number, number] } | null = null;
  const invalidate = () => {
    revision += 1;
    held = null;
    pending = null;
  };
  return {
    invalidate,
    checkpoint() {
      const capturedRevision = revision;
      return () => active && revision === capturedRevision;
    },
    exposeLocation() {
      locationExposed = true;
      invalidate();
    },
    beginPublicPlace(center: [number, number]) {
      invalidate();
      if (!locationExposed) pending = { source: "public-place", center: [...center] };
    },
    settle(viewport: MapViewportSnapshot) {
      if (!active) return;
      if (pending) {
        const target = pending.center;
        if (target && (Math.abs(viewport.center[0] - target[0]) > 0.0000001 ||
          Math.abs(viewport.center[1] - target[1]) > 0.0000001)) return;
        held = { viewport, provenance: { version: 1, source: pending.source } };
        pending = null;
      } else if (held && !sameViewport(held.viewport, viewport)) {
        invalidate();
      }
    },
    capture(viewport: MapViewportSnapshot): MapCameraWrite | null {
      if (!active || !held || !sameViewport(held.viewport, viewport)) return null;
      const capturedRevision = revision;
      return {
        provenance: held.provenance,
        isCurrent: () => active && revision === capturedRevision && held !== null && sameViewport(held.viewport, viewport),
      };
    },
    attach() { active = true; },
    detach() { active = false; invalidate(); },
  };
}

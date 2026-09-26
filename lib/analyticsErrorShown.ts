import { trackEvent } from "@/lib/analytics";

const ERROR_SURFACES = new Set([
  "landing", "home", "map", "tonight", "plan", "you", "pal", "recap", "near", "other",
]);
const ERROR_KINDS = new Set(["network", "auth", "validation", "server", "unknown"]);

export type ErrorShownSurface = "landing" | "home" | "map" | "tonight" | "plan" | "you" | "pal" | "recap" | "near" | "other";
export type ErrorShownKind = "network" | "auth" | "validation" | "server" | "unknown";

export function trackErrorShown(surface: ErrorShownSurface, kind: ErrorShownKind): void {
  if (!ERROR_SURFACES.has(surface) || !ERROR_KINDS.has(kind)) return;
  trackEvent("error_shown", { surface, kind });
}

/**
 * The error kind a failed request earned, from the HTTP status it answered
 * with, or `null` when no response arrived at all.
 */
export function errorShownKindFromStatus(status: number | null): ErrorShownKind {
  if (status === null) return "network";
  if (status === 401 || status === 403) return "auth";
  if (status >= 400 && status < 500) return "validation";
  if (status >= 500 && status < 600) return "server";
  return "unknown";
}

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

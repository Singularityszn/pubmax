import { MAP_STYLES } from "@/lib/mapBasemapStyles";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";

// No pin draws before MapLibre has its worker module, the basemap style and the
// style's TileJSON. Left alone, the engine asks for the style only once the map
// exists and for the worker only once the style has loaded, so on a cold phone
// those downloads queue at the very end of the wait. This asks for the same
// URLs, with the same mode and credentials, when the map shell mounts, so the
// engine's own requests wait on or reuse these and each file crosses the wire
// once. Measured on a cold throttled phone: pins 1.1 s sooner.

type BasemapTheme = keyof typeof MAP_STYLES;

let warmed = false;

function okResponse(request: Promise<Response>): Promise<Response | null> {
  return request.then(
    (response) => {
      if (response.ok) return response;
      void response.body?.cancel().catch(() => {});
      return null;
    },
    () => null,
  );
}

function readToEnd(url: string): void {
  void okResponse(fetch(url))
    .then((response) => response?.arrayBuffer())
    .catch(() => {});
}

async function warmStyle(theme: BasemapTheme): Promise<void> {
  const response = await okResponse(fetch(MAP_STYLES[theme]));
  const style: unknown = await response?.json().catch(() => null);
  const sources =
    style && typeof style === "object" && "sources" in style ? style.sources : null;
  if (!sources || typeof sources !== "object") return;
  for (const source of Object.values(sources)) {
    if (source && typeof source === "object" && "url" in source && typeof source.url === "string") {
      readToEnd(source.url);
    }
  }
}

/** Start the map engine's own downloads. Once per page, and it never throws. */
export function warmMapEngine(): void {
  if (warmed || typeof fetch !== "function" || typeof document === "undefined") return;
  warmed = true;
  const theme: BasemapTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  readToEnd(MAPLIBRE_WORKER_URL);
  void warmStyle(theme).catch(() => {});
}

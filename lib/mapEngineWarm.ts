import { MAP_LABEL_FONT, MAP_STYLES } from "@/lib/mapBasemapStyles";

// The map shell starts the style, TileJSON and pin glyph reads before MapLibre
// needs them. MapLibre loads its own worker when the canvas starts.

// A pin's figure needs the label font's first range: the digits and the pound
// sign. MapLibre asks for it only once its worker has laid the pins out, and on
// a cold phone that request queued behind the basemap tiles, so the first priced
// pin waited seconds for 44 KB. The warm fills the HTTP cache MapLibre reads.
const PIN_GLYPH_RANGE = "0-255";

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
  if (style && typeof style === "object" && "glyphs" in style && typeof style.glyphs === "string") {
    readToEnd(style.glyphs.replace("{fontstack}", MAP_LABEL_FONT).replace("{range}", PIN_GLYPH_RANGE));
  }
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
  void warmStyle(theme).catch(() => {});
}

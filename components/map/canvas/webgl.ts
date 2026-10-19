/**
 * Whether this browser can create a WebGL2 context, with its creation status.
 * MapLibre 6 emits GPUInitializationError from inside its constructor instead
 * of throwing, so callers probe before constructing a map.
 */
export function probeWebGl2(): { hasContext: boolean; status: string } {
  let status = "";
  try {
    const canvas = document.createElement("canvas");
    canvas.addEventListener(
      "webglcontextcreationerror",
      (event) => {
        status = (event as WebGLContextEvent).statusMessage || status;
      },
      { once: true },
    );
    const context = canvas.getContext("webgl2");
    const hasContext = Boolean(context);
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return { hasContext, status };
  } catch {
    return { hasContext: false, status };
  }
}

/**
 * The most canvas pixels the map draws for each CSS pixel.
 *
 * An iPhone reports a device pixel ratio of 3, and MapLibre's default follows
 * it: a 390x664 map stage became a 1170x1992 canvas, nine times the pixels of
 * a 1x screen, every one of them shaded on each frame with the extrusions and
 * labels on top. At 2 the same stage is 780x1328, 44% of the pixels, and the
 * text and pins stay sharp. Measured against production in iPhone emulation
 * at 4x CPU throttle: pins visible 8.2-8.5s at 3x, 6.5-6.9s at 2x.
 */
export const MAX_MAP_PIXEL_RATIO = 2;

export function mapPixelRatio(devicePixelRatio = window.devicePixelRatio): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, MAX_MAP_PIXEL_RATIO);
}

type PixelRatioMap = {
  getPixelRatio(): number;
  setPixelRatio(pixelRatio: number): void;
};

/**
 * Keep a capped map's ratio in step with the screen it is on.
 *
 * MapLibre reads `devicePixelRatio` afresh on every resize only while no
 * `pixelRatio` is set; the cap is a fixed override, so browser zoom or a window
 * dragged to another monitor would leave the canvas at the ratio it opened
 * with, blurred on the sharper screen or paying for pixels the duller one
 * cannot show. A `resolution` media query fires once when the ratio leaves its
 * value, so it is re-armed at the new value on every change. Returns the
 * teardown.
 */
export function followMapPixelRatio(
  map: PixelRatioMap,
  win: Pick<Window, "devicePixelRatio" | "matchMedia"> = window,
): () => void {
  let query: MediaQueryList | null = null;
  const onChange = () => {
    arm();
    const next = mapPixelRatio(win.devicePixelRatio);
    if (next !== map.getPixelRatio()) map.setPixelRatio(next);
  };
  const disarm = () => {
    query?.removeEventListener("change", onChange);
    query = null;
  };
  const arm = () => {
    disarm();
    if (typeof win.matchMedia !== "function") return;
    query = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    query.addEventListener("change", onChange);
  };
  arm();
  return disarm;
}

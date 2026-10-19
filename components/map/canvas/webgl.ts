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

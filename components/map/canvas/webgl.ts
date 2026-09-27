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

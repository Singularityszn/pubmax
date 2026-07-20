export const PUSH_FETCH_TIMEOUT_MS = 5_000;
export const PUSH_RECOVERY_TIMEOUT_MS = 4_000;
export const PUSH_RESPONSE_MAX_BYTES = 64 * 1024;

export async function pushFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = PUSH_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("Push request timed out", "AbortError");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal });
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > PUSH_RESPONSE_MAX_BYTES) {
          throw new Error("Push response body is too large.");
        }
        // Consume the body while the same deadline is still armed. Returning a
        // live Response would bound headers only and let response.json() hang.
        const body = await response.arrayBuffer();
        if (body.byteLength > PUSH_RESPONSE_MAX_BYTES) {
          throw new Error("Push response body is too large.");
        }
        return new Response(body.byteLength > 0 ? body : null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      })(),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withPushTimeout<T>(promise: Promise<T>, timeoutMs = PUSH_RECOVERY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DOMException("Push recovery timed out", "AbortError")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

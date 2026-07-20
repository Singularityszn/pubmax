export const PUSH_FETCH_TIMEOUT_MS = 5_000;
export const PUSH_RECOVERY_TIMEOUT_MS = 4_000;
export const PUSH_RESPONSE_MAX_BYTES = 64 * 1024;

export async function pushFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = PUSH_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("Push request timed out", "AbortError");
      void activeReader?.cancel(error).catch(() => undefined);
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
          const error = new Error("Push response body is too large.");
          void response.body?.cancel(error).catch(() => undefined);
          controller.abort(error);
          throw error;
        }
        // Consume the body while the same deadline is still armed. Returning a
        // live Response would bound headers only and let response.json() hang.
        if (!response.body) {
          return new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
        const reader = response.body.getReader();
        activeReader = reader;
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > PUSH_RESPONSE_MAX_BYTES) {
            const error = new Error("Push response body is too large.");
            void reader.cancel(error).catch(() => undefined);
            activeReader = null;
            controller.abort(error);
            throw error;
          }
          chunks.push(value);
        }
        activeReader = null;
        reader.releaseLock();
        const body = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
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

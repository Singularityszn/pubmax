export const PUSH_FETCH_TIMEOUT_MS = 5_000;
export const PUSH_RECOVERY_TIMEOUT_MS = 4_000;

export async function pushFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = PUSH_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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

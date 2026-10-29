/** Resolves true once `delayMs` has passed, or false as soon as `signal` aborts. */
export function waitUnlessAborted(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The reason a signal aborted with, or an AbortError when it carries none. */
export function abortReason(
  signal: AbortSignal,
  message = "The operation was aborted.",
): unknown {
  return signal.reason === undefined ? new DOMException(message, "AbortError") : signal.reason;
}

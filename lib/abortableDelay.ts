type AbortableDelayOptions = Readonly<{
  rejectOnAbort?: boolean;
}>;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException("The operation was aborted.", "AbortError")
    : signal.reason;
}

/** Wait for a timer while clearing it and its abort listener on either outcome. */
export function waitForAbortableDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
  options: { rejectOnAbort: true },
): Promise<void>;
export function waitForAbortableDelay(
  delayMs: number,
  signal?: AbortSignal,
  options?: { rejectOnAbort?: false },
): Promise<boolean>;
export function waitForAbortableDelay(
  delayMs: number,
  signal?: AbortSignal,
  options: AbortableDelayOptions = {},
): Promise<boolean | void> {
  const rejectOnAbort = options.rejectOnAbort === true;
  if (signal?.aborted) {
    return rejectOnAbort
      ? Promise.reject(abortReason(signal))
      : Promise.resolve(false);
  }

  return new Promise<boolean | void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (aborted: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted) {
        if (rejectOnAbort) reject(abortReason(signal as AbortSignal));
        else resolve(false);
        return;
      }
      if (rejectOnAbort) resolve();
      else resolve(true);
    };

    const onAbort = (): void => finish(true);
    timer = setTimeout(() => finish(false), delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

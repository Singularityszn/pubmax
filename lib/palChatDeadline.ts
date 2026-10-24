/** The configured chat preparation, opening and provider share one turn budget. */
export const PAL_CHAT_TIMEOUT_MS = 22_000;

export class PalChatDeadlineExceeded extends Error {}

/** Check again after a read before starting the next write or provider operation. */
export function assertPalChatDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw new PalChatDeadlineExceeded();
}

export async function beforePalChatDeadline<T>(deadline: number, operation: () => Promise<T>): Promise<T> {
  assertPalChatDeadline(deadline);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PalChatDeadlineExceeded()), Math.max(0, deadline - Date.now()));
      }),
    ]);
    assertPalChatDeadline(deadline);
    return value;
  } finally {
    clearTimeout(timer);
  }
}

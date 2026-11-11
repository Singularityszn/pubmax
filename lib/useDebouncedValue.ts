import { useEffect, useState } from "react";

/**
 * The value as it stood once it stopped changing for `delayMs`.
 *
 * The first value is answered at once, so a surface has something to show on
 * its first frame; every later change waits until the changes have stopped.
 * The list beside the map uses it so a pan that settles several times in a row
 * re-reads the view once (lib/mapSplitList.ts).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = setTimeout(() => setSettled(() => value), Math.max(0, delayMs));
    return () => clearTimeout(timer);
  }, [delayMs, settled, value]);
  return settled;
}

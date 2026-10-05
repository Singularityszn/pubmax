import { useEffect } from "react";

import { cancelLogIntentReveal } from "@/lib/logIntentReveal";

// A log intent's reveal waits for the composer's price step to mount
// (lib/logIntentReveal.ts), and the request is module state. So the map that
// asked for it takes it back when that wait can no longer end in its own
// composer: when the sheet closes, and when the map itself unmounts. The sheet
// can still be open as the reader navigates away, and without the unmount a
// later visit would hand the stale request to the next composer opened by hand.
export function useLogIntentRevealScope(detailOpen: boolean): void {
  useEffect(() => {
    if (!detailOpen) cancelLogIntentReveal();
  }, [detailOpen]);
  useEffect(() => cancelLogIntentReveal, []);
}

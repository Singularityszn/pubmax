/**
 * Run `tick` every `intervalMs` while the page is visible. A tick that falls due
 * while the page is hidden is held, and runs once when the page comes back.
 *
 * It never runs at start, so a caller that already fetched on mount does not
 * fetch twice. A hidden map tab used to poll the database every 30 seconds for
 * a page nobody was looking at.
 */
export function visibleInterval(tick: () => void, intervalMs: number): () => void {
  if (typeof document === "undefined") {
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }
  let held = false;
  const id = setInterval(() => {
    if (document.visibilityState === "hidden") {
      held = true;
      return;
    }
    tick();
  }, intervalMs);
  const visibility = () => {
    if (document.visibilityState === "hidden" || !held) return;
    held = false;
    tick();
  };
  document.addEventListener("visibilitychange", visibility);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", visibility);
  };
}

/** Poll visible pages only and refresh once when a hidden page returns. */
export function subscribeVisiblePolling(
  refresh: () => void,
  intervalMs: number,
  onHidden: () => void,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const focus = () => {
    if (document.visibilityState !== "hidden") refresh();
  };
  const visibility = () => {
    stop();
    if (document.visibilityState === "hidden") {
      onHidden();
      return;
    }
    refresh();
    timer = setInterval(focus, intervalMs);
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", focus);
  visibility();
  return () => {
    stop();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("focus", focus);
    onHidden();
  };
}

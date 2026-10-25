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

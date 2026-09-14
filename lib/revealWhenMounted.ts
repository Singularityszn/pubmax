const REVEAL_WAIT_MS = 10_000;

/**
 * Run `reveal` now, and again on every DOM change until it answers true or the
 * wait ends. A control whose target lives inside a dynamic import (a chunk that
 * lands after paint) would otherwise do nothing when it is tapped before the
 * chunk arrives. Returns a stop function.
 */
export function revealWhenMounted(
  reveal: () => boolean,
  options: { root?: Node; timeoutMs?: number } = {},
): () => void {
  if (reveal()) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (reveal()) stop();
  });
  function stop() {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  observer.observe(options.root ?? document.body, { childList: true, subtree: true });
  timer = setTimeout(stop, options.timeoutMs ?? REVEAL_WAIT_MS);
  return stop;
}

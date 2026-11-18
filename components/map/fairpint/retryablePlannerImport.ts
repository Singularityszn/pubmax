export function retryablePlannerImport<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  let onFailure = () => {};
  const failed = new Set<HTMLScriptElement>();
  const listeners = new Map<HTMLScriptElement, (event: Event) => void>();
  const watch = (script: HTMLScriptElement) => {
    const error = (event: Event) => {
      // The bundle runtime caches rejected chunk promises. Keep this transfer
      // pending so a replacement script can resolve the original import.
      event.stopImmediatePropagation();
      failed.add(script);
      onFailure();
    };
    script.addEventListener("error", error, { capture: true });
    listeners.set(script, error);
  };
  return (reportFailure: () => void): Promise<T> => {
    onFailure = reportFailure;
    if (pending) {
      const retry = [...failed];
      failed.clear();
      for (const script of retry) {
        const replacement = document.createElement("script");
        for (const attribute of script.attributes) replacement.setAttribute(attribute.name, attribute.value);
        replacement.nonce = script.nonce;
        watch(replacement);
        script.replaceWith(replacement);
      }
      return pending;
    }
    const existing = new Set(document.scripts);
    pending = load().catch((error: unknown) => {
      pending = null;
      throw error;
    }).finally(() => {
      for (const [script, listener] of listeners) script.removeEventListener("error", listener, true);
      listeners.clear();
      failed.clear();
    });
    for (const script of document.scripts) if (!existing.has(script)) watch(script);
    return pending;
  };
}

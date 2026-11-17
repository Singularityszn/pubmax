import {
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT, cancelAuthAttempt, releaseAuthAttempt,
  scrubAuthCallback, scrubLingeringAuthCallback, type CapturedAuthCallback,
} from "@/lib/authRedirect";
import { readNativeEmailReceipt, removeNativeEmailReceipt } from "@/lib/nativeEmailPkce";
import type { CancelAuthAttemptOptions } from "@/components/auth/authContext";

export function browserLocalStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
export function browserSessionStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}
export function browserLockManager(): LockManager | null {
  try { return typeof navigator !== "undefined" ? navigator.locks : null; } catch { return null; }
}
export function releaseBrowserAuthAttempt(attemptId: string): void {
  releaseAuthAttempt(attemptId, browserLocalStorage(), browserSessionStorage());
}
export function cancelBrowserAuthAttempt(keepAttemptId?: string | null): void {
  cancelAuthAttempt(browserLocalStorage(), browserSessionStorage(), keepAttemptId);
}
export function scrubLingeringBrowserAuthCallback(): void {
  scrubLingeringAuthCallback(window.location.href, (cleanUrl) =>
    window.history.replaceState(window.history.state, "", cleanUrl));
}
export function captureBrowserAuthReturn(): Promise<CapturedAuthCallback | null> {
  return scrubAuthCallback(window.location.href,
    (cleanUrl) => window.history.replaceState(window.history.state, "", cleanUrl), {
      persistentStorage: browserLocalStorage(), tabStorage: browserSessionStorage(), lockManager: browserLockManager(),
      onFragmentRestored: () => window.dispatchEvent(new Event(AUTH_RETURN_FRAGMENT_RESTORED_EVENT)),
    });
}
export function releaseBrowserAuthReturn(pending: Promise<CapturedAuthCallback | null>): void {
  void pending.then((captured) => {
    if (captured?.attempt?.attemptId) releaseBrowserAuthAttempt(captured.attempt.attemptId);
    captured?.releaseCoordination();
    scrubLingeringBrowserAuthCallback();
  }).catch(() => { scrubLingeringBrowserAuthCallback(); });
}
export function cancelBeforeAuthRuntime(options?: CancelAuthAttemptOptions): void {
  const storage = browserLocalStorage();
  const receipt = readNativeEmailReceipt(storage, window.location.origin);
  if (!options?.keepEmailLink && receipt) {
    releaseBrowserAuthAttempt(receipt.id);
    removeNativeEmailReceipt(storage, receipt.id);
  }
  cancelBrowserAuthAttempt(options?.keepEmailLink ? receipt?.id : null);
}

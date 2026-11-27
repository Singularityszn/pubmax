import { cancelAuthAttempt, releaseAuthAttempt, scrubLingeringAuthCallback } from "@/lib/authRedirect";

export function browserLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function browserLockManager(): LockManager | null {
  try {
    return typeof navigator !== "undefined" ? navigator.locks : null;
  } catch {
    return null;
  }
}

export function releaseBrowserAuthAttempt(attemptId: string): void {
  releaseAuthAttempt(attemptId, browserLocalStorage(), browserSessionStorage());
}

export function cancelBrowserAuthAttempt(keepAttemptId?: string | null): void {
  cancelAuthAttempt(browserLocalStorage(), browserSessionStorage(), keepAttemptId);
}

/**
 * Defect fence: callback tokens must leave the address bar on every path -
 * success, failure, or a first replaceState the browser refused or a router
 * write reverted. Runs after the exchange settles and once more on a delay.
 */
export function scrubLingeringBrowserAuthCallback(): void {
  scrubLingeringAuthCallback(window.location.href, (cleanUrl) =>
    window.history.replaceState(window.history.state, "", cleanUrl),
  );
}

import { ensureSupabaseBrowser } from "@/lib/authClient";

export function prepareBrowserSignIn(): void {
  void ensureSupabaseBrowser().catch(() => {});
}

export function prepareBrowserSignInFromKey(event: {
  key: string;
  nativeEvent: { isComposing: boolean };
  currentTarget: EventTarget;
}): void {
  if (event.nativeEvent.isComposing) return;
  const activating = event.key === "Enter" || event.key === " ";
  const editing = event.currentTarget instanceof HTMLInputElement && event.key.length === 1;
  if (activating || editing) prepareBrowserSignIn();
}

import { ensureSupabaseBrowser } from "@/lib/authClient";

export function prepareBrowserSignIn(): void {
  void ensureSupabaseBrowser().catch(() => {});
}

"use client";

// Desktop polish shell for /add/[handle] (D1.5). Keeps ConfirmFollow untouched
// (owned outside this allowlist) and layers Escape dismiss + a centred dialog
// frame at wide widths via CSS classes on this host only.

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

export default function AddPageShell({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Do not steal Escape from inputs/textareas if any appear later.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      router.push("/feed");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <div className="addDialogHost">
      <div
        className="addDialogPanel"
        role="dialog"
        aria-modal="true"
        aria-label="Add to your lot"
      >
        {children}
      </div>
      <p className="addDialogEscHint" aria-hidden="true">
        Esc to dismiss
      </p>
    </div>
  );
}

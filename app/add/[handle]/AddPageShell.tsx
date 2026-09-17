"use client";

// Desktop polish shell for /add/[handle] (D1.5). Keeps ConfirmFollow untouched
// (owned outside this allowlist) and layers Escape dismiss + a centred panel
// frame at wide widths via CSS classes on this host only.
//
// Not a modal dialog: no role=dialog / aria-modal (would mark SiteNav inert for
// AT). Visual centring + Esc to Social only. KB-4 focus-trap gate stays N/A here.

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import styles from "./Add.module.css";

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
      router.push("/social");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <div className={styles.addDialogHost}>
      <div className={styles.addDialogPanel}>{children}</div>
      <p className={styles.addDialogEscHint} aria-hidden="true">
        Esc to dismiss
      </p>
    </div>
  );
}

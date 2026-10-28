"use client";

import { useLinkStatus } from "next/link";

import "./navPendingIndicator.css";

/** A Link descendant reads the transition that Next already owns. */
export default function NavPendingIndicator({ announce = true }: { announce?: boolean }) {
  const { pending } = useLinkStatus();

  return (
    <span
      className="navPendingIndicator"
      data-pending={pending || undefined}
      role={pending && announce ? "progressbar" : undefined}
      aria-label={pending && announce ? "Opening page" : undefined}
      aria-hidden={!pending || !announce || undefined}
    />
  );
}

"use client";

// The door the Last Orders Bell comes through. Nothing renders, and the bell's
// chunk and the hours pack are never fetched, while the wild switch is off
// (lib/wildMode.ts). With it on, the bell loads lazily on the client.

import { lazy, Suspense } from "react";

import { useWildMode } from "@/lib/useWildMode";

import type { LastOrdersBellProps } from "./LastOrdersBell";

const LastOrdersBell = lazy(() => import("./LastOrdersBell"));

export default function LastOrdersBellSlot(props: LastOrdersBellProps) {
  const wild = useWildMode();
  if (!wild) return null;
  return (
    <Suspense fallback={null}>
      <LastOrdersBell {...props} />
    </Suspense>
  );
}

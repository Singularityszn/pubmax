"use client";

// The door THE POUR comes through (components/wild/PourLoader.tsx). The shared
// pint loader (components/ui/pint-loader.tsx) stays a server component and
// hands this its classic glass as children. With the wild switch off
// (lib/wildMode.ts) it returns that glass and nothing else, so the pour's
// chunk and its stylesheet are never fetched and the markup is the glass the
// loader always drew. With the switch on the pour loads lazily, and the
// classic glass holds its place until it arrives, so the loader never shows
// nothing.

import { lazy, Suspense, type ReactNode } from "react";

import { useWildMode } from "@/lib/useWildMode";

import type { PourKind } from "./PourLoader";

const PourGlass = lazy(() => import("./PourLoader"));

export default function PourLoaderSlot({
  kind,
  idBase,
  children,
}: {
  kind: PourKind;
  /** The loader's own id, so each pour names its gradient and clip apart. */
  idBase: string;
  /** The classic glass: what shows with the switch off, and while the pour loads. */
  children: ReactNode;
}) {
  const wild = useWildMode();
  if (!wild) return <>{children}</>;
  return (
    <Suspense fallback={children}>
      <PourGlass kind={kind} idBase={idBase} />
    </Suspense>
  );
}

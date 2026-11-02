"use client";

// The door the Sign Foundry comes through. With the wild switch off this
// renders nothing (or, for the photo fallback, exactly what it was handed), and
// the sign's own chunk is never fetched; with it on, the sign loads lazily on
// the client. lib/wildMode.ts explains the switch.

import { lazy, Suspense, type ReactNode } from "react";

import { useWildMode } from "@/lib/useWildMode";

import type { PubSignProps } from "./PubSign";

const PubSign = lazy(() => import("./PubSign"));
const PubSignFallback = lazy(() => import("./PubSign").then((module) => ({ default: module.PubSignFallback })));

/** A page's cover sign, for a pub with no photo. Nothing while the switch is off. */
export default function PubSignSlot(props: PubSignProps) {
  const wild = useWildMode();
  if (!wild) return null;
  return (
    <Suspense fallback={null}>
      <PubSign {...props} />
    </Suspense>
  );
}

/**
 * VenueImage's "No photo yet" with the switch on becomes the pub's sign; with
 * it off, and while the sign loads, it is the plain fallback it was handed.
 */
export function PubSignFallbackSlot({
  alt,
  className,
  children,
}: {
  alt: string;
  className?: string;
  children: ReactNode;
}) {
  const wild = useWildMode();
  if (!wild) return <>{children}</>;
  return (
    <Suspense fallback={children}>
      <PubSignFallback alt={alt} className={className}>
        {children}
      </PubSignFallback>
    </Suspense>
  );
}

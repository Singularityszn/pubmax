"use client";

// The historic cover remains a wild feature. Named venue photo fallbacks load
// the same drawing for everyone, with a plain placeholder while it loads.

import { lazy, Suspense, type ReactNode } from "react";

import { useWildMode } from "@/lib/useWildMode";

import type { PubSignProps } from "./PubSign";

const PubSign = lazy(() => import("./PubSign"));
const PubSignFallback = lazy(() => import("./PubSign")
  .then((module) => ({ default: module.PubSignFallback }))
  .catch(() => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> })));

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
 * Only explicit pub identity can create a sign. Uploaded pint photographs and
 * other unnamed media keep the plain fallback.
 */
export function PubSignFallbackSlot({
  name,
  area,
  className,
  children,
}: {
  name?: string;
  area?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!name?.trim()) return <>{children}</>;
  return (
    <Suspense fallback={children}>
      <PubSignFallback name={name} area={area} className={className}>
        {children}
      </PubSignFallback>
    </Suspense>
  );
}

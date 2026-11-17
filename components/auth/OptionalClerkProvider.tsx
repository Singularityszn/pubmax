"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import type { ClerkProvider } from "@clerk/nextjs";

import { AuthProvider } from "@/components/auth/AuthProvider";

type OptionalClerkProviderProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
  clerkIntegrationConfigured: boolean;
  children?: ReactNode;
};

type ConfiguredClerkTreeProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
};

type ConfiguredClerkTreeComponent = (props: ConfiguredClerkTreeProps) => React.JSX.Element;

/**
 * Loads Clerk after first paint. Children and AuthProvider are never behind
 * React.lazy/Suspense, so cold opens keep map, nav and tab bar visible while the
 * optional Clerk chunk downloads.
 *
 * The Clerk tree mounts as a SIBLING after the children and never wraps them.
 * Wrapping would change the element type above the product when the chunk
 * lands, and React would remount the whole app (map, WebGL, tab bar, mount
 * fetches, typed input). Clerk-dependent controls reach the product through
 * ClerkAccountSlot portals instead.
 */
export default function OptionalClerkProvider({
  appearance,
  clerkIntegrationConfigured,
  children,
}: OptionalClerkProviderProps): React.JSX.Element {
  const [ClerkTree, setClerkTree] = useState<ConfiguredClerkTreeComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@/components/auth/ConfiguredClerkTree").then((mod) => {
      if (!cancelled) setClerkTree(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthProvider clerkIntegrationConfigured={clerkIntegrationConfigured}>
      {children}
      {ClerkTree ? <ClerkTree appearance={appearance} /> : null}
    </AuthProvider>
  );
}

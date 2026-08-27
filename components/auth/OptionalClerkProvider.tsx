"use client";

import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

import type { ClerkProvider } from "@clerk/nextjs";

type OptionalClerkProviderProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
  clerkIntegrationConfigured: boolean;
  children: ReactNode;
};

const ConfiguredClerkTree = lazy(
  () => import("@/components/auth/ConfiguredClerkTree"),
);

/** Loads Clerk only when the server has already opened its two-key gate. */
export default function OptionalClerkProvider({
  appearance,
  clerkIntegrationConfigured,
  children,
}: OptionalClerkProviderProps): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <ConfiguredClerkTree
        appearance={appearance}
        clerkIntegrationConfigured={clerkIntegrationConfigured}
      >
        {children}
      </ConfiguredClerkTree>
    </Suspense>
  );
}

"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps, ReactNode } from "react";

import ClerkAuthRevision from "@/components/auth/ClerkAuthRevision";
import { AuthProvider } from "@/components/auth/AuthProvider";

type ConfiguredClerkTreeProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
  clerkIntegrationConfigured: boolean;
  children: ReactNode;
};

export default function ConfiguredClerkTree({
  appearance,
  clerkIntegrationConfigured,
  children,
}: ConfiguredClerkTreeProps): React.JSX.Element {
  return (
    <ClerkProvider appearance={appearance}>
      <AuthProvider clerkIntegrationConfigured={clerkIntegrationConfigured}>
        <ClerkAuthRevision />
        {children}
      </AuthProvider>
    </ClerkProvider>
  );
}

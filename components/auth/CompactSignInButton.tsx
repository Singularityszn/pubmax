"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/authContext";
import { isClerkProductSessionAvailable } from "@/lib/clerkAvailability";

function CompactAuthPending(): React.JSX.Element {
  return (
    <span
      className="authUser authUserNav authCompactPending"
      aria-hidden="true"
      inert
      data-auth-configured="true"
      data-auth-resolved="false"
      data-auth-empty="true"
    >
      <span className="authCompact">
        <span className="authCompactTrigger">
          <span className="authCompactIcon" />
          <span className="authCompactLabel" />
        </span>
      </span>
    </span>
  );
}

const FullSignInButton = dynamic(
  () => import("@/components/auth/SignInButton"),
  { ssr: true, loading: CompactAuthPending },
);

function subscribeClientHydration(): () => void {
  return () => {};
}

function readClientHydration(): boolean {
  return true;
}

function readServerHydration(): boolean {
  return false;
}

/** The compact nav host uses the same account authority as its full controls. */
export default function CompactSignInButton(): React.JSX.Element {
  const { user, configured, clerkIntegrationConfigured } = useAuth();
  const clientHydrated = useSyncExternalStore(
    subscribeClientHydration,
    readClientHydration,
    readServerHydration,
  );

  if (!configured && !isClerkProductSessionAvailable(user, clerkIntegrationConfigured)) {
    return (
      <span
        hidden
        data-auth-configured="false"
        data-auth-resolved={clientHydrated ? "true" : "false"}
        data-auth-empty="true"
      />
    );
  }

  return <FullSignInButton compact />;
}

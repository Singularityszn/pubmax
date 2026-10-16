"use client";

import { ClerkProvider } from "@clerk/nextjs";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { createPortal } from "react-dom";

import ClerkAuthRevision from "@/components/auth/ClerkAuthRevision";
import { useClerkAccountSlots } from "@/components/auth/ClerkAccountSlot";

const ClerkAccountControls = dynamic(
  () => import("@/components/auth/ClerkAccountControls"),
);

type ConfiguredClerkTreeProps = {
  appearance?: ComponentProps<typeof ClerkProvider>["appearance"];
};

/** Fill each ClerkAccountSlot from inside the provider, so Clerk hooks resolve. */
function ClerkAccountPortals(): React.JSX.Element {
  const slots = useClerkAccountSlots();
  return <>{slots.map((slot) => createPortal(<ClerkAccountControls />, slot.node, slot.key))}</>;
}

/**
 * Clerk chrome only. It mounts BESIDE the product tree and never wraps it, so
 * its arrival changes no element above the product and nothing remounts.
 * Controls that need Clerk context reach the product through ClerkAccountSlot.
 */
export default function ConfiguredClerkTree({
  appearance,
}: ConfiguredClerkTreeProps): React.JSX.Element {
  return (
    <ClerkProvider appearance={appearance}>
      <ClerkAuthRevision />
      <ClerkAccountPortals />
    </ClerkProvider>
  );
}

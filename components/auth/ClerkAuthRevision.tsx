"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";

import { setProviderIdentity } from "@/lib/authProviderRevision";

/** Publish Clerk account transitions to AuthProvider's opaque account seam. */
export default function ClerkAuthRevision(): null {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    setProviderIdentity("clerk", user?.id ?? null);
  }, [isLoaded, user?.id]);

  return null;
}

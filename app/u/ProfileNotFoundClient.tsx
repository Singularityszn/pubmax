"use client";

import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import { normalizeHandle } from "@/lib/handleNormalize";
import { isPubmaxxHandleImpersonationBlock } from "@/lib/pubmaxxIdentity";

import ProfilePageClient from "./[handle]/ProfilePageClient";

export default function ProfileNotFoundClient({ fallback }: { fallback: ReactNode }) {
  const pathname = usePathname();
  const handle = useMemo(() => {
    const match = /^\/u\/([^/]+)\/?$/.exec(pathname ?? "");
    try {
      return normalizeHandle(decodeURIComponent(match?.[1] ?? ""));
    } catch {
      return "";
    }
  }, [pathname]);
  const params = useMemo(() => Promise.resolve({ handle }), [handle]);

  if (!handle || handle === "you" || isPubmaxxHandleImpersonationBlock(handle)) return fallback;
  return <ProfilePageClient params={params} />;
}

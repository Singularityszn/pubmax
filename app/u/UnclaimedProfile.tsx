"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { EmptyGlassArt } from "@/components/brand/DotGlassArt";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { normalizeHandle } from "@/lib/handleNormalize";
import { isPubmaxxHandleImpersonationBlock } from "@/lib/pubmaxxIdentity";

export default function UnclaimedProfile({ fallback }: { fallback: ReactNode }) {
  const pathname = usePathname();
  return <UnclaimedProfileContent pathname={pathname} fallback={fallback} />;
}

export function UnclaimedProfileContent({
  pathname,
  fallback,
}: {
  pathname: string | null;
  fallback: ReactNode;
}) {
  const match = /^\/u\/([^/]+)\/?$/.exec(pathname ?? "");
  let handle = "";
  try {
    handle = normalizeHandle(decodeURIComponent(match?.[1] ?? ""));
  } catch {
    return fallback;
  }
  if (!handle || handle === "you" || isPubmaxxHandleImpersonationBlock(handle)) return fallback;

  return (
    <main id="main" style={{
      minHeight: "100svh",
      display: "grid",
      placeItems: "center",
      padding: "24px",
      background: "var(--paper)",
      color: "var(--ink)",
    }}>
      <div style={{ maxWidth: "34rem", textAlign: "center" }}>
        <span style={{ display: "inline-flex", fontSize: "1.6rem", marginBottom: "22px" }}>
          <PubmaxxWordmark />
        </span>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "18px" }}>
          <EmptyGlassArt />
        </div>
        <h1 style={{
          margin: "0 0 20px",
          fontFamily: "var(--font-display)",
          fontSize: "clamp(var(--text-xl), 4vw, var(--text-3xl))",
          lineHeight: 1.1,
        }}>
          Nobody has claimed @{handle}
        </h1>
        <Link href="/u/you" style={{
          minHeight: "44px",
          display: "inline-flex",
          alignItems: "center",
          padding: "0 20px",
          borderRadius: "var(--control-radius, 14px)",
          background: "var(--color-accent)",
          color: "var(--color-on-accent)",
          textDecoration: "none",
          fontWeight: 600,
        }}>
          Claim a handle
        </Link>
      </div>
    </main>
  );
}

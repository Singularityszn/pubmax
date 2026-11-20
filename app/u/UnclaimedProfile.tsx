"use client";

import Link from "next/link";

import { EmptyGlassArt } from "@/components/brand/DotGlassArt";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
export default function UnclaimedProfile({ handle }: { handle: string }) {
  return (
    <section style={{
      minHeight: "100svh",
      display: "grid",
      placeItems: "center",
      padding: "24px",
      background: "var(--paper)",
      color: "var(--ink)",
    }}>
      <div style={{ minWidth: 0, maxWidth: "34rem", textAlign: "center" }}>
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
          overflowWrap: "anywhere",
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
    </section>
  );
}

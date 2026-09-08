"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PubPal } from "@/lib/pubPal";
import { trackEvent } from "@/lib/analytics";
import { PubPalAvatar } from "./PubPalAvatar";

const RENDERED_HEIGHT = "--pal-summon-rendered-h";
let heightOwner: object | null = null;

/** Publish sibling clearance without changing this link's minimum height. */
export function observePubPalHeight(element: HTMLElement): () => void {
  const owner = {};
  const body = element.ownerDocument.body;
  heightOwner = owner;
  const publish = () => {
    if (heightOwner !== owner) return;
    const style = getComputedStyle(element);
    const visible = element.isConnected && style.display !== "none" && style.visibility !== "hidden";
    const height = visible ? element.getBoundingClientRect().height : 0;
    if (!Number.isFinite(height)) return;
    const value = `${Math.max(0, height)}px`;
    if (body.style.getPropertyValue(RENDERED_HEIGHT) !== value) body.style.setProperty(RENDERED_HEIGHT, value);
  };
  publish();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
  observer?.observe(element, { box: "border-box" });
  window.addEventListener("resize", publish);
  const fonts = element.ownerDocument.fonts;
  fonts?.addEventListener("loadingdone", publish);
  void fonts?.ready.then(publish, () => {});
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", publish);
    fonts?.removeEventListener("loadingdone", publish);
    if (heightOwner !== owner) return;
    heightOwner = null;
    body.style.removeProperty(RENDERED_HEIGHT);
  };
}

export function shouldShowPubPalSummon(pathname: string): boolean {
  return pathname === "/" || pathname === "/map" || pathname.startsWith("/map/") || pathname === "/plan" || pathname.startsWith("/plan/");
}

export default function PubPalSummon() {
  const pathname = usePathname() ?? "";
  const [pal, setPal] = useState<PubPal | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const shown = !!pal && !pal.hidden && shouldShowPubPalSummon(pathname);
  useEffect(() => { try { const value = JSON.parse(localStorage.getItem("pubmax_pub_pal_v1") ?? "null") as PubPal | null; queueMicrotask(() => setPal(value)); } catch {} }, [pathname]);
  useLayoutEffect(() => {
    if (!shown || !linkRef.current) return;
    return observePubPalHeight(linkRef.current);
  }, [shown, pathname, pal?.name]);
  if (!pal || pal.hidden || !shouldShowPubPalSummon(pathname)) return null;
  return <Link ref={linkRef} className="palSummon" href="/pal" aria-label={`Summon ${pal.name}, your Pub Pal`} onClick={() => trackEvent("pub_pal_summoned", { surface: pathname === "/" ? "home" : pathname.startsWith("/map") ? "map" : "plan" })}><PubPalAvatar appearance={pal.appearance} name={pal.name} compact/><span><strong>{pal.name}</strong><small>{pal.muted ? "Muted" : "Tap to talk or plan"}</small></span></Link>;
}

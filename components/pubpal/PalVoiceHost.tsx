"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth/authContext";
import {
  cancelPalVoiceStart,
  palVoiceCallMounted,
  palVoiceLoadFailed,
  readPalVoiceHost,
  subscribePalVoiceHost,
} from "@/lib/palVoiceHost";
import { loadPalVoiceSession, type PalVoiceSessionComponent } from "@/components/pubpal/palVoiceSessionLoader";

/**
 * The one voice call, held in the root shell. Client navigation keeps the
 * shell, so a call started on either /pal or /map survives moves between them.
 */
export default function PalVoiceHost() {
  const host = useSyncExternalStore(subscribePalVoiceHost, readPalVoiceHost, readPalVoiceHost);
  const pathname = usePathname() ?? "";
  const ownerId = useAuth().user?.id ?? null;
  // A tap on the map chip is for this page, this account, and while the page
  // is in view: a phone locked or a tab put away drops a tap not yet taken.
  useEffect(() => cancelPalVoiceStart(pathname, ownerId), [pathname, ownerId]);
  useEffect(() => {
    const drop = () => {
      if (document.visibilityState === "hidden") cancelPalVoiceStart(pathname, ownerId, true);
    };
    const leave = () => cancelPalVoiceStart(pathname, ownerId, true);
    document.addEventListener("visibilitychange", drop);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", drop);
      window.removeEventListener("pagehide", leave);
    };
  }, [pathname, ownerId]);
  const mounted = palVoiceCallMounted(host, pathname);
  // The session carries the ElevenLabs SDK. The /pal panel or a map-chip tap
  // loads it. A cold /map loads none of it. A download that fails is told to
  // the chip or panel, never thrown into the root layout.
  const [Session, setSession] = useState<PalVoiceSessionComponent | null>(null);
  useEffect(() => {
    if (!mounted || Session) return;
    let live = true;
    loadPalVoiceSession().then(
      (loaded) => { if (live) setSession(() => loaded); },
      () => { if (live) palVoiceLoadFailed(); },
    );
    return () => { live = false; };
  }, [mounted, Session]);
  if (!mounted || !Session) return null;
  const props = host.panel?.props ?? host.props ?? {};
  // A new account never inherits the last account's call.
  return <Session key={ownerId ?? "signed-out"} {...props} panel={host.panel?.element ?? null} />;
}

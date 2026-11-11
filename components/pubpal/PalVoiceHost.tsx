"use client";

import { useEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth/authContext";
import {
  cancelPalVoiceStart,
  palVoiceCallMounted,
  readPalVoiceHost,
  subscribePalVoiceHost,
} from "@/lib/palVoiceHost";

// The session carries the ElevenLabs SDK. The available /pal panel mounts it,
// and an engaged call retains it across routes. A cold /map loads none of it.
const PubPalVoiceSession = dynamic(() => import("@/components/pubpal/PubPalVoiceSession"), {
  ssr: false,
});

/**
 * The one voice call, held in the root shell. Client navigation keeps the
 * shell, so a call started on /pal carries on after the move to /map.
 */
export default function PalVoiceHost() {
  const host = useSyncExternalStore(subscribePalVoiceHost, readPalVoiceHost, readPalVoiceHost);
  const pathname = usePathname() ?? "";
  const ownerId = useAuth().user?.id ?? null;
  // A tap on the map chip is for this page and this account only.
  useEffect(() => cancelPalVoiceStart(pathname, ownerId), [pathname, ownerId]);
  if (!palVoiceCallMounted(host, pathname)) return null;
  const props = host.panel?.props ?? host.props ?? {};
  // A new account never inherits the last account's call.
  return <PubPalVoiceSession key={ownerId ?? "signed-out"} {...props} panel={host.panel?.element ?? null} />;
}

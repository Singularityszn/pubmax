"use client";

import { useEffect, useMemo, useState } from "react";
import { authedActionFetch } from "@/lib/authedFetch";
import { cleanNightProfile, type NightProfile } from "@/lib/nightProfile";

export type MapNearbyProfileState = {
  profile: NightProfile | null;
  status: "signed-out" | "loading" | "ready" | "unavailable";
};

type OwnedProfileState = MapNearbyProfileState & { request: object | null };

/** Pass an account ID plus its session revision. A changed key immediately hides the old answer. */
export function useMapNearbyProfile(ownerKey: string | null): MapNearbyProfileState {
  const request = useMemo(() => ({ ownerKey }), [ownerKey]);
  const [state, setState] = useState<OwnedProfileState>({ request: null, profile: null, status: "signed-out" });
  useEffect(() => {
    if (!ownerKey) return;
    const controller = new AbortController();
    void authedActionFetch("/api/me/night-profile", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    }, { requiresIdentity: true }).then(async (response) => {
      if (!response.ok) throw new Error("Night Profile unavailable");
      const body: unknown = await response.json();
      if (controller.signal.aborted) return;
      const raw = body && typeof body === "object" && "profile" in body ? body.profile : undefined;
      const profile = raw === null ? null : cleanNightProfile(raw);
      if (raw !== null && !profile) throw new Error("Invalid Night Profile");
      setState({ request, profile, status: "ready" });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ request, profile: null, status: "unavailable" });
    });
    return () => controller.abort();
  }, [ownerKey, request]);
  if (!ownerKey) return { profile: null, status: "signed-out" };
  if (state.request !== request) return { profile: null, status: "loading" };
  return { profile: state.profile, status: state.status };
}

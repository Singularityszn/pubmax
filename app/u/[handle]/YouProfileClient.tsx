"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { accountClaimReturnToFromUrl } from "@/lib/accountClaimReturnTo";

import ProfilePageClient from "./ProfilePageClient";

type Props = { params: Promise<{ handle: string }> };
type Resolution = { handle: string; status: "public" | "hidden" | "error" };

export default function YouProfileClient({ params }: Props) {
  const { user, identityResolved, handle } = useAuth();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ownerParams = useMemo(() => Promise.resolve({ handle: handle ?? "" }), [handle]);

  useEffect(() => {
    if (!identityResolved || !user || !handle) return;
    const controller = new AbortController();
    void fetch(`/api/identity/handle/resolve?handle=${encodeURIComponent(handle)}`, {
      signal: controller.signal,
    }).then((response) => {
      if (!controller.signal.aborted) {
        setResolution({ handle, status: response.status === 404 ? "hidden" : response.ok ? "public" : "error" });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setResolution({ handle, status: "error" });
    });
    return () => controller.abort();
  }, [attempt, handle, identityResolved, user]);

  if (!identityResolved || !user || !handle) return <ProfilePageClient params={params} />;
  if (resolution?.handle !== handle) return <p role="status">Checking your profile.</p>;
  if (resolution.status === "error") {
    return <p role="status">Your profile could not be checked. <button type="button" onClick={() => {
      setResolution(null);
      setAttempt((value) => value + 1);
    }}>Retry</button></p>;
  }
  const returnTo = typeof window === "undefined" ? null : accountClaimReturnToFromUrl(window.location.href);
  if (resolution.status === "hidden" && !returnTo) return <ProfilePageClient params={ownerParams} />;
  return <ProfilePageClient params={params} />;
}

"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/authContext";
import { authedFetch } from "@/lib/authedFetch";
import { providerHasAnswered } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";

type Props = {
  src: string;
  alt: string;
  className?: string;
  width: number;
  height: number;
  priority?: boolean;
  unoptimized?: boolean;
  onError?: () => void;
};

/** Covers require the same bearer as their profile. Never send it off-origin. */
export default function ProfileCoverImage({ src, ...props }: Props) {
  const { accountRevision, providerAuthState, user } = useAuth();
  const ownerKey = `${accountRevision}:${user?.id ?? ""}:${providerAuthState}:${src}`;
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!user && !providerHasAnswered(providerAuthState)) return;
    if (!/^\/api\/cover\/[^/?#]+\/[^/?#]+$/.test(src)) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        // Version bypasses old public cache entries on clients upgrading in place.
        const response = await authedFetch(`${src}?privacy=2`, {
          cache: "no-store", redirect: "error", signal: controller.signal,
        }, { requiresIdentity: true });
        if (!response.ok) { discardBody(response); return; }
        const blob = await response.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ key: ownerKey, url: objectUrl });
      } catch {
        // A revoked/failed read leaves the existing neutral cover treatment.
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, ownerKey, providerAuthState, user]);

  // An account swap hides old bytes in render, before effect cleanup runs.
  if (!loaded || loaded.key !== ownerKey) return <span className={props.className} aria-hidden="true" />;
  return <Image {...props} alt={props.alt} src={loaded.url} unoptimized />;
}

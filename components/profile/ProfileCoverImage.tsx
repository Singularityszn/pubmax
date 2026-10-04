"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { AuthActionSessionError, authedActionFetch } from "@/lib/authedFetch";
import { providerHasAnswered, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";

type Props = {
  src: string;
  alt: string;
  className?: string;
  width: number;
  height: number;
  priority?: boolean;
  onError?: () => void;
};

/** Cover bytes need the reader's bearer token. Public avatars use their existing image path. */
export default function ProfileCoverImage({ src, alt, className, width, height, priority, onError }: Props) {
  const { accountRevision, providerAuthState, user } = useAuth();
  const userId = user?.id;
  const readerKey = `${accountRevision}:${userId ?? ""}:${providerAuthState}:${src}`;
  const [loaded, setLoaded] = useState<{ readerKey: string; url: string } | null>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!userId && !providerHasAnswered(providerAuthState)) return;
    // Never send a bearer token to a supplied external URL or another API route.
    if (!/^\/api\/cover\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(src)) return;
    const controller = new AbortController();
    const accountSignal = readProviderAccountSignal();
    let active = true;
    let objectUrl: string | null = null;
    const current = () => active && !controller.signal.aborted && !accountSignal.aborted;

    async function load() {
      try {
        // This versioned URL bypasses cover responses cached under the former public policy.
        const response = await authedActionFetch(`${src}?privacy=2`, {
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        }, { requiresIdentity: true });
        if (!current() || !response.ok) {
          discardBody(response);
          if (current()) onErrorRef.current?.();
          return;
        }
        const blob = await response.blob();
        if (!current()) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ readerKey, url: objectUrl });
      } catch (error) {
        // A waking session is not a broken photo. Keep it for the next auth answer.
        if (current() && !(error instanceof AuthActionSessionError)) onErrorRef.current?.();
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, readerKey, providerAuthState, userId]);

  // Account changes hide the previous bytes during render, before effect cleanup.
  if (loaded?.readerKey !== readerKey) return <span className={className} aria-hidden="true" />;
  return (
    <Image
      src={loaded.url}
      alt={alt}
      className={className}
      width={width}
      height={height}
      unoptimized
      loading={priority ? "eager" : undefined}
      onError={onError}
    />
  );
}

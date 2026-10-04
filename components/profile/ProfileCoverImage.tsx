"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { waitUnlessAborted } from "@/lib/abortableDelay";
import { authedActionFetch } from "@/lib/authedFetch";
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

const RETRY_DELAYS_MS = [0, 500, 1_500, 3_000] as const;

/** Cover bytes need the reader's bearer token. Public avatars use their existing image path. */
export default function ProfileCoverImage({ src, alt, className, width, height, priority, onError }: Props) {
  const { accountRevision, providerAuthState, session, user } = useAuth();
  const userId = user?.id;
  const readerKey = `${accountRevision}:${userId ?? ""}:${providerAuthState}:${src}`;
  const [loaded, setLoaded] = useState<{ readerKey: string; url: string } | null>(null);
  const onErrorRef = useRef(onError);
  const restartRef = useRef(() => {});
  const sessionRef = useRef(session);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!userId && !providerHasAnswered(providerAuthState)) return;
    // Never send a bearer token to a supplied external URL or another API route.
    if (!/^\/api\/cover\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(src)) return;
    const accountSignal = readProviderAccountSignal();
    let active = true;
    let attempt: AbortController | null = null;
    let objectUrl: string | null = null;

    async function read(signal: AbortSignal) {
      const current = () => active && !signal.aborted && !accountSignal.aborted;
      let retryAfterMs = 0;
      for (const delayMs of RETRY_DELAYS_MS) {
        const waitMs = Math.max(delayMs, retryAfterMs);
        // Respect a long server cooldown without keeping this read alive indefinitely.
        if (waitMs > 10_000) break;
        if (waitMs && !await waitUnlessAborted(waitMs, signal)) return;
        if (!current()) return;
        try {
          // This versioned URL bypasses cover responses cached under the former public policy.
          const response = await authedActionFetch(`${src}?privacy=2`, {
            cache: "no-store",
            redirect: "error",
            signal,
          }, { requiresIdentity: true });
          if (!current() || !response.ok) {
            discardBody(response);
            if (!current()) return;
            // A storage outage and an absent/hidden cover both answer 404. Keep
            // that ambiguity private and retry briefly before giving up.
            if ([404, 408, 429].includes(response.status) || response.status >= 500) {
              const retryAfter = response.headers.get("Retry-After");
              const seconds = Number(retryAfter);
              retryAfterMs = retryAfter
                ? (Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0)
                : 0;
              continue;
            }
            onErrorRef.current?.();
            return;
          }
          const blob = await response.blob();
          if (!current()) return;
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ readerKey, url: objectUrl });
          return;
        } catch {
          // Session warming and transport failures can recover without a reader change.
          if (!current()) return;
        }
      }
      // An exhausted read leaves until the reader or session changes.
      if (current()) onErrorRef.current?.();
    }
    function load() {
      if (objectUrl) return;
      attempt?.abort();
      attempt = new AbortController();
      void read(attempt.signal);
    }
    restartRef.current = load;
    load();
    return () => {
      active = false;
      restartRef.current = () => {};
      attempt?.abort();
      if (!objectUrl) return;
      URL.revokeObjectURL(objectUrl);
      const released = objectUrl;
      setLoaded((prev) => (prev?.url === released ? null : prev));
    };
  }, [src, readerKey, providerAuthState, userId]);

  // A same-account session refresh replaces any read that has not produced bytes.
  useEffect(() => {
    if (sessionRef.current === session) return;
    sessionRef.current = session;
    restartRef.current();
  }, [session]);

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

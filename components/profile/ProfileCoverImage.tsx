"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { waitUnlessAborted } from "@/lib/abortableDelay";
import { authedActionFetch } from "@/lib/authedFetch";
import { providerHasAnswered, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";

// One cover photo, read with the reader's own identity.
//
// A private account's cover answers only its owner and its mates, and that
// decision is made from the bearer token (`lib/profileImageServe.server.ts`).
// A plain <img> cannot carry a bearer, so the bytes are fetched here and shown
// from an object URL. A public account's cover answers the same read with or
// without a token, so every cover takes this one path.
//
// THREE things this component is careful about.
//
// 1. A TOKEN GOES ONLY TO THE COVER ROUTE. Any other src renders nothing, so a
//    stored URL can never carry a reader's bearer somewhere else.
//
// 2. ANOTHER ACCOUNT NEVER SEES THE LAST ONE'S BYTES. The loaded photo is keyed
//    to the account revision, the user and the auth state, so a switch or a
//    sign-out hides it during render, before the effect cleans up.
//
// 3. A WAKING SESSION IS NOT A BROKEN PHOTO. A transport failure, a timeout, a
//    rate limit or a server error is retried briefly. A 404 is final, as it
//    always was for the <img>: the cover is hidden, gone or not ours to see.

type Props = {
  src: string;
  alt: string;
  className?: string;
  width: number;
  height: number;
  priority?: boolean;
  onError?: () => void;
};

const COVER_SRC = /^\/api\/cover\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/;
const RETRY_DELAYS_MS = [0, 500, 1_500, 3_000] as const;
const MAX_RETRY_WAIT_MS = 10_000;

function retryAfterMs(response: Response): number {
  const header = response.headers.get("Retry-After");
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  return Math.max(0, Date.parse(header) - Date.now()) || 0;
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export default function ProfileCoverImage({
  src,
  alt,
  className,
  width,
  height,
  priority,
  onError,
}: Props) {
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
    if (!COVER_SRC.test(src)) return;
    const accountSignal = readProviderAccountSignal();
    let active = true;
    let attempt: AbortController | null = null;
    let objectUrl: string | null = null;

    async function read(signal: AbortSignal) {
      const current = () => active && !signal.aborted && !accountSignal.aborted;
      let waitAtLeastMs = 0;
      for (const delayMs of RETRY_DELAYS_MS) {
        const waitMs = Math.max(delayMs, waitAtLeastMs);
        // A long server cooldown ends this read rather than holding it open.
        if (waitMs > MAX_RETRY_WAIT_MS) break;
        if (waitMs && !(await waitUnlessAborted(waitMs, signal))) return;
        if (!current()) return;
        try {
          const response = await authedActionFetch(
            src,
            { cache: "no-store", redirect: "error", signal },
            { requiresIdentity: true },
          );
          if (!current()) {
            discardBody(response);
            return;
          }
          if (!response.ok) {
            discardBody(response);
            const tryAgain = retryable(response.status);
            if (!tryAgain) {
              onErrorRef.current?.();
              return;
            }
            waitAtLeastMs = retryAfterMs(response);
            continue;
          }
          const blob = await response.blob();
          if (!current()) return;
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ readerKey, url: objectUrl });
          return;
        } catch {
          // A waking session or a dropped connection can recover on its own.
          if (!current()) return;
        }
      }
      // An exhausted read stays down until the reader or the session changes.
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

  // A refreshed session for the same account retries a read that has no bytes
  // yet. A photo already on screen stays.
  useEffect(() => {
    if (sessionRef.current === session) return;
    sessionRef.current = session;
    restartRef.current();
  }, [session]);

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

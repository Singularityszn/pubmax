"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { authedActionFetch, compositeActionSignal } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";

// One cover photo, read with the reader's own identity.
//
// A private account's cover answers only its owner and its mates, and that
// decision is made from the bearer token (`lib/profileImageServe.server.ts`).
// A plain <img> cannot carry a bearer, so the bytes are fetched here and shown
// from an object URL. A public account's cover answers the same read with or
// without a token, so every cover takes this one path.
//
// TWO things this component is careful about.
//
// 1. A TOKEN GOES ONLY TO THE COVER ROUTE. Any other src renders nothing, so a
//    stored URL can never carry a reader's bearer somewhere else.
//
// 2. ANOTHER ACCOUNT NEVER SEES THE LAST ONE'S BYTES. The loaded photo is keyed
//    to the account revision, the user and the auth state, so a switch or a
//    sign-out hides it during render, before the effect cleans up.

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

export default function ProfileCoverImage({
  src,
  alt,
  className,
  width,
  height,
  priority,
  onError,
}: Props) {
  const { accountRevision, providerAuthState, supabaseAuthState, session, user } = useAuth();
  const userId = user?.id;
  const readerKey = `${accountRevision}:${userId ?? ""}:${providerAuthState}:${supabaseAuthState}:${src}`;
  const [loaded, setLoaded] = useState<{ readerKey: string; url: string } | null>(null);
  const onErrorRef = useRef(onError);
  const restartRef = useRef(() => {});
  const sessionRef = useRef(session);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!userId && supabaseAuthState === "unresolved") return;
    if (!COVER_SRC.test(src)) return;
    const accountSignal = readProviderAccountSignal();
    let active = true;
    let attempt: AbortController | null = null;
    let objectUrl: string | null = null;

    async function read(signal: AbortSignal) {
      const current = () => active && !signal.aborted && !accountSignal.aborted;
      if (!current()) return;
      try {
        const response = await authedActionFetch(
          src,
          { cache: "no-store", redirect: "error", signal: compositeActionSignal([accountSignal, signal]) },
          { requiresIdentity: supabaseAuthState !== "signed-out" && supabaseAuthState !== "unavailable" },
        );
        if (!current()) {
          discardBody(response);
          return;
        }
        if (response.ok) {
          const blob = await response.blob();
          if (!current()) return;
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ readerKey, url: objectUrl });
          return;
        }
        discardBody(response);
      } catch {
        if (!current()) return;
      }
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
  }, [src, readerKey, supabaseAuthState, userId]);

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
      data-cover-src={src}
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

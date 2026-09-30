"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { accountBoundFetch, captureAccountAuth } from "@/lib/accountBoundFetch";
import { FriendLocationClient } from "@/lib/friendLocationClient";
import type { FriendLocationRead } from "@/lib/friendLocation";

export function useFriendLocations() {
  const { session, user, accountRevision } = useAuth();
  const userId = user?.id ?? null;
  const token = session?.access_token ?? null;
  const account = useMemo(() => ({
    key: `${userId}:${accountRevision}`,
    auth: captureAccountAuth(userId, token && userId ? { user: { id: userId }, access_token: token } : null),
  }), [userId, token, accountRevision]);
  const client = useMemo(() => {
    const auth = account.auth;
    return new FriendLocationClient(async (method, body, signal) => {
      const response = await accountBoundFetch(auth, "/api/friend-locations", {
        method, cache: "no-store", credentials: "omit", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "conflict" : data.error || "unavailable");
      return data as FriendLocationRead;
    }, typeof navigator === "undefined" ? undefined : navigator.geolocation, async () => {
      try { return (await navigator.permissions.query({ name: "geolocation" })).state; }
      catch { return "prompt"; }
    });
  }, [account]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useLayoutEffect(() => {
    if (!userId) return () => client.dispose();
    const visibility = () => client.setVisible(document.visibilityState === "visible");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); client.dispose(); };
  }, [client, userId]);
  return { state, client, signedIn: Boolean(userId), accountKey: account.key };
}

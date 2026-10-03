"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { accountBoundFetch, captureAccountAuth, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { FriendLocationClient, type FriendLocationRequest } from "@/lib/friendLocationClient";
import type { FriendLocationRead } from "@/lib/friendLocation";

/** One account's requests, always sent with that account's latest token. */
class FriendLocationTransport {
  private auth: AccountAuthSnapshot | null = null;
  constructor(private readonly userId: string | null) {}
  setAuth(next: AccountAuthSnapshot | null) { this.auth = next?.userId === this.userId ? next : null; }
  request: FriendLocationRequest = async (method, body, signal) => {
    const response = await accountBoundFetch(this.auth, "/api/friend-locations", {
      method, cache: "no-store", credentials: "omit", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? "conflict" : data.error || "unavailable");
    return data as FriendLocationRead;
  };
}

export function useFriendLocations() {
  const { session, user, accountRevision } = useAuth();
  const userId = user?.id ?? null;
  const token = session?.access_token ?? null;
  const account = useMemo(() => ({ key: `${userId}:${accountRevision}`, userId }), [userId, accountRevision]);
  const transport = useMemo(() => new FriendLocationTransport(account.userId), [account]);
  useLayoutEffect(() => {
    transport.setAuth(captureAccountAuth(userId, token && userId ? { user: { id: userId }, access_token: token } : null));
  }, [transport, userId, token]);
  const client = useMemo(() => new FriendLocationClient(
    transport.request,
    typeof navigator === "undefined" ? undefined : navigator.geolocation,
    async () => {
      try { return (await navigator.permissions.query({ name: "geolocation" })).state; }
      catch { return "prompt"; }
    },
  ), [transport]);
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

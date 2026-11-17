import { useEffect } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { getAccessToken } from "@/lib/authClient";
import { providerOwnsSession } from "@/lib/authProviderRevision";
import { currentMessagePushToken, MESSAGE_PUSH_DEPARTURE } from "@/lib/messageNotificationLifecycle";
import { authedActionFetch } from "@/lib/authedFetch";
import { MESSAGE_NOTIFICATION_SETTINGS_CHANGED } from "@/lib/messageNotificationClient";
import { discardBody } from "@/lib/responseBody";

export function useMessageThreadPresence(conversationId: string): void {
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let token: string | null = null;
    const controller = new AbortController();
    const clear = () => {
      if (!token || !providerOwnsSession("supabase", userId)) return;
      void getAccessToken().then((accessToken) => {
        if (!accessToken || !providerOwnsSession("supabase", userId)) return;
        return fetch("/api/message-notifications", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "presence", token, conversationId: null }), keepalive: true,
        signal: AbortSignal.timeout(3_000),
      }).then(discardBody);
      }).catch(() => undefined);
    };
    const heartbeat = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      token = await currentMessagePushToken();
      if (!token || disposed) return;
      const response = await authedActionFetch("/api/message-notifications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "presence", token, conversationId }), signal: controller.signal,
      }, { requiresIdentity: true });
      discardBody(response);
      const registration = await navigator.serviceWorker.getRegistration();
      for (const notification of await registration?.getNotifications({ tag: `message:${conversationId}` }) ?? []) notification.close();
    };
    const refresh = () => { if (document.visibilityState === "visible") void heartbeat().catch(() => undefined); else clear(); };
    refresh();
    const interval = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pagehide", clear);
    window.addEventListener(MESSAGE_NOTIFICATION_SETTINGS_CHANGED, refresh);
    window.addEventListener(MESSAGE_PUSH_DEPARTURE, clear);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener(MESSAGE_NOTIFICATION_SETTINGS_CHANGED, refresh);
      window.removeEventListener(MESSAGE_PUSH_DEPARTURE, clear);
      clear();
    };
  }, [conversationId, userId]);
}

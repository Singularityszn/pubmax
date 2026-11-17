import { useEffect } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { getAccessToken } from "@/lib/authClient";
import { providerOwnsSession } from "@/lib/authProviderRevision";
import { currentMessagePushToken, MESSAGE_PUSH_DEPARTURE } from "@/lib/messageNotificationLifecycle";
import { MESSAGE_NOTIFICATION_SETTINGS_CHANGED } from "@/lib/messageNotificationClient";
import { discardBody } from "@/lib/responseBody";

let lastPresenceActivity = 0;
function nextPresenceActivity(): number {
  lastPresenceActivity = Math.max(lastPresenceActivity + 1, Date.now() * 1_000);
  return lastPresenceActivity;
}

export function useMessageThreadPresence(conversationId: string): void {
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let token: string | null = null;
    let accessToken: string | null = null;
    let revision = 0;
    let activityId = 0;
    const controller = new AbortController();
    const clear = () => {
      revision += 1;
      if (!token || !accessToken || !providerOwnsSession("supabase", userId)) return;
      void fetch("/api/message-notifications", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "presence", token, conversationId: null, activityId, revision }), keepalive: true,
        signal: AbortSignal.timeout(3_000),
      }).then(discardBody).catch(() => undefined);
    };
    const heartbeat = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      const attempt = ++revision;
      activityId = nextPresenceActivity();
      const bearer = await getAccessToken();
      const subscription = await currentMessagePushToken();
      if (!subscription || !bearer || disposed || revision !== attempt || document.visibilityState !== "visible" || !providerOwnsSession("supabase", userId)) return;
      token = subscription;
      accessToken = bearer;
      const response = await fetch("/api/message-notifications", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "presence", token, conversationId, activityId, revision: attempt }), signal: controller.signal,
      });
      discardBody(response);
      if (disposed || revision !== attempt || document.visibilityState !== "visible") return;
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

import { useEffect } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { getAccessToken } from "@/lib/authClient";
import { providerOwnsSession } from "@/lib/authProviderRevision";
import { currentMessagePushToken, MESSAGE_PUSH_DEPARTURE } from "@/lib/messageNotificationLifecycle";
import { MESSAGE_NOTIFICATION_SETTINGS_CHANGED } from "@/lib/messageNotificationClient";
import { INITIAL_THREAD_PRESENCE, transitionThreadPresence, type ThreadPresenceEvent, type ThreadPresenceEffect } from "@/lib/messageThreadPresenceState";
import { discardBody } from "@/lib/responseBody";

export function useMessageThreadPresence(conversationId: string): void {
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let state = INITIAL_THREAD_PRESENCE;
    const controller = new AbortController();
    const ownsSession = () => providerOwnsSession("supabase", userId);
    const post = (bearer: string, body: object, clear = false) => fetch("/api/message-notifications", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body), keepalive: clear,
      signal: clear ? AbortSignal.timeout(3_000) : controller.signal,
    });
    const dispatch = (event: ThreadPresenceEvent, notifications: readonly Notification[] = []) => {
      const next = transitionThreadPresence(state, event);
      state = next.state;
      for (const effect of next.effects) {
        if (effect.type === "close-notifications") {
          for (const notification of notifications) notification.close();
        } else void run(effect).catch(() => {
          if ("revision" in effect) dispatch({ type: "failed", revision: effect.revision });
        });
      }
    };
    const run = async (effect: Exclude<ThreadPresenceEffect, { type: "close-notifications" }>): Promise<void> => {
      switch (effect.type) {
        case "credentials": {
          const [bearer, token] = await Promise.all([getAccessToken(), currentMessagePushToken()]);
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          dispatch({ type: "credentials", revision: effect.revision, binding: bearer && token ? { bearer, token } : null });
          return;
        }
        case "reserve": {
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          const response = await post(effect.binding.bearer, { action: "presence-start", token: effect.binding.token });
          const body = await response.json() as { activityId?: unknown };
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          dispatch({ type: "reserved", revision: effect.revision, activityId: response.ok && typeof body.activityId === "number" ? body.activityId : null });
          return;
        }
        case "send": {
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          const response = await post(effect.lease.bearer, {
            action: "presence", presenceVersion: 2, token: effect.lease.token,
            conversationId: effect.visible ? conversationId : null,
            activityId: effect.lease.activityId, revision: effect.revision,
          }, !effect.visible);
          discardBody(response);
          if (response.ok && effect.visible && ownsSession()) dispatch({ type: "delivered", revision: effect.revision });
          return;
        }
        case "notifications": {
          const registration = await navigator.serviceWorker.getRegistration();
          const notifications = await registration?.getNotifications({ tag: `message:${conversationId}` }) ?? [];
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          dispatch({ type: "notifications-loaded", revision: effect.revision }, notifications);
          return;
        }
        case "abort": controller.abort(); return;
        default: {
          const unreachable: never = effect;
          return unreachable;
        }
      }
    };
    const refresh = () => dispatch({ type: document.visibilityState === "visible" ? "refresh" : "hide" });
    const clear = () => dispatch({ type: "hide" });
    const stop = () => dispatch({ type: "stop" });
    refresh();
    const interval = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pagehide", clear);
    window.addEventListener(MESSAGE_NOTIFICATION_SETTINGS_CHANGED, refresh);
    window.addEventListener(MESSAGE_PUSH_DEPARTURE, stop);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener(MESSAGE_NOTIFICATION_SETTINGS_CHANGED, refresh);
      window.removeEventListener(MESSAGE_PUSH_DEPARTURE, stop);
      stop();
    };
  }, [conversationId, userId]);
}

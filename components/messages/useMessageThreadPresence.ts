import { useEffect } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { getAccessToken } from "@/lib/authClient";
import { compositeActionSignal } from "@/lib/authedFetch";
import { providerOwnsSession, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { currentMessagePushToken, MESSAGE_PUSH_DEPARTURE, messagePushDepartureRevision } from "@/lib/messageNotificationLifecycle";
import { MESSAGE_NOTIFICATION_SETTINGS_CHANGED, MESSAGE_PUSH_RESTORED, type MessagePushRestored } from "@/lib/messageNotificationClient";
import { messageNotificationSessionFromToken } from "@/lib/messageNotificationSession";
import { INITIAL_THREAD_PRESENCE, transitionThreadPresence, type ThreadPresenceEvent, type ThreadPresenceEffect } from "@/lib/messageThreadPresenceState";
import { discardBody } from "@/lib/responseBody";
import { waitForWebPushWork } from "@/lib/webPush";

export function useMessageThreadPresence(conversationId: string): void {
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let state = INITIAL_THREAD_PRESENCE;
    let controller = new AbortController();
    let attemptSignal = controller.signal;
    let notificationRead: Promise<Notification[]> | undefined;
    const accountSignal = readProviderAccountSignal();
    const ownsSession = () => !accountSignal.aborted && providerOwnsSession("supabase", userId);
    const post = (bearer: string, body: object, signal: AbortSignal, clear = false) => fetch("/api/message-notifications", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body), keepalive: clear, signal,
    });
    const dispatch = (event: ThreadPresenceEvent, notifications: readonly Notification[] = []) => {
      const next = transitionThreadPresence(state, event);
      state = next.state;
      for (const effect of next.effects) {
        if (effect.type === "close-notifications") {
          for (const notification of notifications) notification.close();
        } else void run(effect).catch(() => {
          if ("revision" in effect && !(effect.type === "send" && !effect.visible)) dispatch({ type: "failed", revision: effect.revision });
        });
      }
    };
    const run = async (effect: Exclude<ThreadPresenceEffect, { type: "close-notifications" }>): Promise<void> => {
      if (effect.type === "abort") { controller.abort(); return; }
      if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
      if (effect.type === "credentials") {
        controller.abort();
        controller = new AbortController();
        attemptSignal = compositeActionSignal([controller.signal, accountSignal, AbortSignal.timeout(3_000)]);
      }
      const signal = effect.type === "send" && !effect.visible ? AbortSignal.timeout(3_000) : attemptSignal;
      const wait = <T,>(work: PromiseLike<T>) => waitForWebPushWork(work, signal);
      switch (effect.type) {
        case "credentials": {
          const [bearer, token] = await wait(Promise.all([getAccessToken(), currentMessagePushToken(signal)]));
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          const sessionId = messageNotificationSessionFromToken(bearer, userId);
          dispatch({ type: "credentials", revision: effect.revision, binding: bearer && token && sessionId ? { bearer, token, sessionId } : null });
          return;
        }
        case "reserve": {
          const response = await wait(post(effect.binding.bearer, { action: "presence-start", token: effect.binding.token }, signal));
          const body: unknown = await wait(response.json());
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          const activityId = response.ok && body && typeof body === "object" && "activityId" in body && typeof body.activityId === "number" ? body.activityId : null;
          dispatch({ type: "reserved", revision: effect.revision, activityId });
          return;
        }
        case "send": {
          const response = await wait(post(effect.lease.bearer, {
            action: "presence", presenceVersion: 2, token: effect.lease.token,
            conversationId: effect.visible ? conversationId : null,
            activityId: effect.lease.activityId, revision: effect.revision,
          }, signal, !effect.visible));
          if (!effect.visible) { discardBody(response); return; }
          const body: unknown = await wait(response.json());
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          dispatch({ type: "delivered", revision: effect.revision, applied: response.ok && Boolean(body && typeof body === "object" && "applied" in body && body.applied === true) });
          return;
        }
        case "notifications": {
          if (notificationRead) return;
          const read = navigator.serviceWorker.getRegistration().then(registration =>
            signal.aborted || !ownsSession() ? [] : registration?.getNotifications({ tag: `message:${conversationId}` }) ?? []);
          notificationRead = read;
          const settled = () => { if (notificationRead === read) notificationRead = undefined; };
          void read.then(settled, settled);
          const notifications = await wait(read);
          if (!ownsSession()) { dispatch({ type: "ownership-lost" }); return; }
          dispatch({ type: "notifications-loaded", revision: effect.revision }, notifications);
          return;
        }
        default: {
          const unreachable: never = effect;
          return unreachable;
        }
      }
    };
    const refresh = () => dispatch({ type: document.visibilityState === "visible" ? "refresh" : "hide" });
    const clear = () => dispatch({ type: "hide" });
    const depart = () => dispatch({ type: "depart", departureRevision: messagePushDepartureRevision() });
    const restore = (event: Event) => {
      const { detail } = event as CustomEvent<MessagePushRestored>;
      if (!detail || detail.userId !== userId || !ownsSession()) return;
      const previous = state;
      dispatch({ type: "restored", ...detail });
      if (state !== previous) refresh();
    };
    refresh();
    const interval = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pagehide", clear);
    window.addEventListener(MESSAGE_NOTIFICATION_SETTINGS_CHANGED, refresh);
    window.addEventListener(MESSAGE_PUSH_DEPARTURE, depart);
    window.addEventListener(MESSAGE_PUSH_RESTORED, restore);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener(MESSAGE_NOTIFICATION_SETTINGS_CHANGED, refresh);
      window.removeEventListener(MESSAGE_PUSH_DEPARTURE, depart);
      window.removeEventListener(MESSAGE_PUSH_RESTORED, restore);
      dispatch({ type: "stop" });
    };
  }, [conversationId, userId]);
}

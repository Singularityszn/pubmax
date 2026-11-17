"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import { currentMessagePushToken, messagePushFingerprint, saveMessageNotificationSetting } from "@/lib/messageNotificationClient";
import { queueMessagePushOperation, flushMessagePushReleases } from "@/lib/messageNotificationLifecycle";
import { registerWebPush, webPushSupport } from "@/lib/webPush";
import "./messageNotificationSettings.css";

type Settings = { enabled: boolean; preview: boolean; muted: boolean; registered?: boolean };

export default function MessageNotificationSettings({ conversationId }: { conversationId?: string }): React.JSX.Element | null {
  const { user } = useAuth();
  return user ? <AccountMessageNotificationSettings key={`${user.id}:${conversationId ?? "inbox"}`} userId={user.id} conversationId={conversationId} /> : null;
}

function AccountMessageNotificationSettings({ userId, conversationId }: { userId: string; conversationId?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void currentMessagePushToken().then((token) => token ? messagePushFingerprint(token) : null).catch(() => null).then((fingerprint) => authedActionFetch(`/api/message-notifications${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`, {
      signal: controller.signal, headers: fingerprint ? { "x-message-push-fingerprint": fingerprint } : {},
    }, { requiresIdentity: true }))
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json() as Settings;
        if (!controller.signal.aborted) { setSettings(body); setError(""); }
      }).catch(() => { if (!controller.signal.aborted) setError("Could not load message alerts. Close this panel and try again."); });
    return () => controller.abort();
  }, [open, userId, conversationId]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function change(kind: "enabled" | "preview" | "muted") {
    if (!settings || pending) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError("");
    let next = { ...settings, [kind]: kind === "enabled" ? !(settings.enabled && settings.registered) : !settings[kind] };
    setSettings(next);
    try {
      if (kind === "enabled" && next.enabled) {
        await queueMessagePushOperation(flushMessagePushReleases);
        if (controller.signal.aborted) return;
        const token = await registerWebPush(controller.signal, undefined, async (token, signal) => {
          await saveMessageNotificationSetting({ action: "subscribe", token }, signal);
          return true;
        });
        if (!token) throw new Error("Could not enable alerts. Check notification permission and try again.");
        next = { ...next, registered: true };
      }
      await saveMessageNotificationSetting(kind === "muted"
        ? { action: "mute", conversationId, muted: next.muted }
        : { action: "preferences", enabled: next.enabled, preview: next.preview }, controller.signal);
      if (!controller.signal.aborted) setSettings(next);
    } catch {
      if (!controller.signal.aborted) {
        setSettings(settings);
        setError(webPushSupport() === "blocked" ? "Allow notifications in this browser’s site settings to enable alerts." : "Could not save message alerts. Try again.");
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const support = typeof window === "undefined" ? "unsupported" : webPushSupport();
  return (
    <div className="messageAlerts">
      <button className="messageAlertsToggle pressable" type="button" aria-label={conversationId ? "Chat notifications" : "Message notifications"} aria-expanded={open} onClick={() => setOpen(!open)}>
        {settings?.muted ? <BellOff size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
        {!conversationId ? "Message notifications" : null}
      </button>
      {open ? <div className="messageAlertsPanel" role="region" aria-label="Message alerts">
        <p>Message alerts</p>
        {settings ? <>
          {conversationId ? <button type="button" className="pressable" disabled={pending} onClick={() => void change("muted")}>{settings.muted ? "Unmute this chat" : "Mute this chat"}</button> : <>
            <button type="button" className="pressable" disabled={pending || (!(settings.enabled && settings.registered) && support !== "supported")} onClick={() => void change("enabled")}>{pending ? "Saving…" : settings.enabled && settings.registered ? "Turn off alerts on all devices" : "Turn on message alerts"}</button>
            <label><input type="checkbox" checked={settings.preview} disabled={pending} onChange={() => void change("preview")} /> Show the sender and a short preview on the lock screen</label>
            <p className="messageAlertsHint">Previews stay hidden unless you choose them. Muted chats stay quiet.</p>
            {settings.preview ? <p className="messageAlertsHint">A preview can stay in a notification after a message is unsent.</p> : null}
            {support === "unsupported" ? <p className="messageAlertsHint">On iPhone, open PubMaxxing in Safari, choose Share, then Add to Home Screen. Open the installed app to enable alerts.</p> : null}
            {support === "blocked" ? <p className="messageAlertsHint">Notifications are blocked. Allow them in this browser’s site settings.</p> : null}
          </>}
        </> : !error ? <p role="status">Loading message alerts…</p> : null}
        {error ? <p role="status">{error}</p> : null}
      </div> : null}
    </div>
  );
}

"use client";

import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { authedActionFetch } from "@/lib/authedFetch";
import { currentMessagePushToken, messagePushFingerprint, saveMessageNotificationSetting } from "@/lib/messageNotificationClient";
import { isNativeApp } from "@/lib/nativePlatform";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { registerWebPush, webPushSupport, waitForWebPushWork } from "@/lib/webPush";
import "./messageNotificationSettings.css";

type Settings = { enabled: boolean; preview: boolean; muted: boolean; registered?: boolean };
type Props = { conversationId?: string; compact?: boolean };

async function readSettings(conversationId: string | undefined, signal: AbortSignal): Promise<Settings> {
  const scope = new AbortController();
  const cancel = () => scope.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(() => scope.abort(new DOMException("The read timed out.", "TimeoutError")), 3_000);
  const read = async () => {
    const token = conversationId ? null : await currentMessagePushToken(scope.signal).catch(() => null);
    const fingerprint = token ? await messagePushFingerprint(token, scope.signal).catch(() => null) : null;
    const response = await authedActionFetch(`/api/message-notifications${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}&settingsOnly=1` : ""}`, {
      signal: scope.signal, headers: fingerprint ? { "x-message-push-fingerprint": fingerprint } : {},
    }, { requiresIdentity: true });
    if (!response.ok) throw new Error("Could not read message alerts.");
    return response.json() as Promise<Settings>;
  };
  try { return await waitForWebPushWork(read(), scope.signal); }
  finally { clearTimeout(deadline); signal.removeEventListener("abort", cancel); }
}

export default function MessageNotificationSettings({ conversationId, compact }: Props): React.JSX.Element | null {
  const { user } = useAuth();
  return user ? <AccountMessageNotificationSettings key={`${user.id}:${conversationId ?? "inbox"}`} userId={user.id} conversationId={conversationId} compact={compact} /> : null;
}

function AccountMessageNotificationSettings({ userId, conversationId, compact }: Props & { userId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<"enabled" | "preview" | "muted" | null>(null);
  const pending = saving !== null;
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);
  const panelId = useId();
  const native = isNativeApp();
  const dismiss = useCallback(() => { setOpen(false); toggleRef.current?.focus(); }, []);
  useDismissOnEscape(open, dismiss, rootRef);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, dismiss]);

  useEffect(() => {
    if (!open && (!conversationId || loadedRef.current)) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    void readSettings(conversationId, controller.signal).then((body) => {
      if (!controller.signal.aborted) { loadedRef.current = true; setSettings(body); setError(""); }
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load message alerts. Try again."); });
    return () => controller.abort();
  }, [open, userId, conversationId, retry]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function change(kind: "enabled" | "preview" | "muted", enabled?: boolean) {
    if (!settings || pending) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSaving(kind);
    setError("");
    let next = { ...settings, [kind]: kind === "enabled" ? enabled ?? !(settings.enabled && settings.registered) : !settings[kind] };
    setSettings(next);
    try {
      if (kind === "enabled" && next.enabled) {
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
    } catch (error) {
      if (!controller.signal.aborted && typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError") {
        const confirmation = new AbortController();
        controllerRef.current = confirmation;
        let confirmationError = "Could not confirm your change. Check the setting and try again.";
        const deadline = setTimeout(() => confirmation.abort(new DOMException("The read timed out.", "TimeoutError")), 3_000);
        try {
          const confirmed = await readSettings(conversationId, confirmation.signal);
          if (!confirmation.signal.aborted) {
            setSettings(confirmed);
            if (confirmed[kind] === next[kind] && (kind !== "enabled" || !next.enabled || confirmed.registered === true)) confirmationError = "";
          }
        } catch {
          if (!confirmation.signal.aborted || confirmation.signal.reason?.name === "TimeoutError") setSettings(null);
        } finally {
          clearTimeout(deadline);
          if (!confirmation.signal.aborted || confirmation.signal.reason?.name === "TimeoutError") {
            setError(confirmationError);
            setSaving(null);
          }
        }
      } else if (!controller.signal.aborted) {
        setSettings(settings);
        setError(webPushSupport() === "blocked" ? "Allow notifications in this browser’s site settings to enable alerts." : "Could not save message alerts. Try again.");
      }
    } finally {
      if (controllerRef.current === controller && !controller.signal.aborted) setSaving(null);
    }
  }

  const support = typeof window === "undefined" ? "unsupported" : webPushSupport();
  const onThisDevice = settings?.enabled && settings.registered;
  return (
    <div ref={rootRef} className={`messageAlerts${compact ? " messageAlerts--compact" : ""}`}>
      <IconButton variant="ghost" size={conversationId || compact ? "icon" : "default"} ref={toggleRef} className="messageAlertsToggle pressable" type="button" aria-label={conversationId ? `Chat notifications${settings?.muted ? ", muted" : ""}` : "Message notifications"} aria-controls={panelId} aria-expanded={open} aria-busy={pending} aria-disabled={pending && !open} onClick={() => { if (!pending || open) setOpen(!open); }}>
        {settings?.muted ? <BellOff size={20} aria-hidden="true" /> : <Bell size={20} aria-hidden="true" />}
        {!conversationId && !compact ? "Message notifications" : null}
      </IconButton>
      {open ? <div id={panelId} className="messageAlertsPanel" role="region" aria-label="Message alerts" aria-busy={pending || (!settings && !error)}>
        <h2>Message alerts</h2>
        {settings ? <>
          {conversationId ? <Button variant="secondary" className="pressable" aria-disabled={pending} onClick={() => void change("muted")}>{settings.muted ? "Unmute this chat" : "Mute this chat"}</Button> : <>
            {native ? <p className="messageAlertsHint">{settings.enabled ? "Message alerts are on for your account. You can turn them off for all devices here. This app shows unread badges and chat mutes." : "Message alerts outside the app aren’t available yet. Unread badges and chat mutes still work."}</p> : <>
              <Button className="pressable" disabled={!onThisDevice && support !== "supported"} aria-disabled={pending} onClick={() => void change("enabled")}>{saving === "enabled" ? "Saving…" : onThisDevice ? "Turn off alerts on all devices" : settings.enabled ? "Turn on alerts on this device" : "Turn on message alerts"}</Button>
              <label><input type="checkbox" checked={settings.preview} aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }} onChange={() => void change("preview")} /> Show the sender and a short preview while PubMaxxing is open in the background</label>
              <p className="messageAlertsHint">Closed-app alerts never show message text. Muted chats stay quiet.</p>
              {settings.preview ? <p className="messageAlertsHint">A preview can stay in a notification after a message is unsent.</p> : null}
              {support === "unsupported" ? <p className="messageAlertsHint">On iPhone, open PubMaxxing in Safari, choose Share, then Add to Home Screen. Open the installed app to enable alerts.</p> : null}
              {support === "blocked" ? <p className="messageAlertsHint">Notifications are blocked. Allow them in this browser’s site settings.</p> : null}
            </>}
            {settings.enabled && !settings.registered && !pending ? <Button variant="secondary" className="pressable" aria-disabled={pending} onClick={() => void change("enabled", false)}>Turn off alerts on all devices</Button> : null}
          </>}
        </> : !error ? <p role="status">Loading message alerts…</p> : null}
        {error ? <><p role="status">{error}</p><Button variant="secondary" aria-disabled={pending} onClick={() => { if (!pending) setRetry((value) => value + 1); }}>Try again</Button></> : null}
      </div> : null}
    </div>
  );
}

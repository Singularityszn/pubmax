"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import { detectA2hsPlatform } from "@/lib/a2hsPrompt";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { isNativeApp } from "@/lib/nativePlatform";
import { enablePersonalizedWebPush } from "@/lib/personalizedPushOptIn";
import { unregisterWebPush } from "@/lib/webPush";
import { Button } from "@/components/ui/button";

type PrefState = {
  enabled: boolean;
  lastSentAt: string | null;
  canSend: boolean;
  maxPerWeek: number;
};

function isStandaloneInstall(): boolean {
  if (typeof window === "undefined") return false;
  const platform = detectA2hsPlatform({
    userAgent: navigator.userAgent,
    isNativeApp: isNativeApp(),
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: Boolean(
      (navigator as unknown as { standalone?: boolean }).standalone,
    ),
    maxTouchPoints: navigator.maxTouchPoints,
  });
  return platform === "standalone";
}

function subscribeNoop(): () => void {
  return () => undefined;
}

/**
 * You → notifications: Step Out weekly nudge opt-in. Default OFF. Names the
 * weekly cap and iOS Home Screen install requirement honestly.
 */
export default function StepOutNudgePref(): React.JSX.Element | null {
  const { session, user } = useAuth();
  const viewerSession = useViewerSession();
  const [pref, setPref] = useState<PrefState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const registrationAbortRef = useRef<AbortController | null>(null);
  // Client-only install check via external store so SSR stays stable.
  const needsInstall = useSyncExternalStore(
    subscribeNoop,
    () => !isStandaloneInstall(),
    () => false,
  );

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void authedActionFetch("/api/step-out-nudge", { signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          setPref({ enabled: false, lastSentAt: null, canSend: false, maxPerWeek: 1 });
          return;
        }
        setPref({
          enabled: body.enabled === true,
          lastSentAt: typeof body.lastSentAt === "string" ? body.lastSentAt : null,
          canSend: body.canSend === true,
          maxPerWeek: typeof body.maxPerWeek === "number" ? body.maxPerWeek : 1,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPref({ enabled: false, lastSentAt: null, canSend: false, maxPerWeek: 1 });
        }
      });
    return () => controller.abort();
  }, [user]);

  useEffect(() => () => {
    registrationAbortRef.current?.abort();
  }, []);

  async function enable() {
    if (!user || !session?.access_token || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (needsInstall) {
        setNotice(
          "On iPhone, add PUBMAXX to your Home Screen first. Web push only works from the installed app.",
        );
        return;
      }
      const controller = new AbortController();
      registrationAbortRef.current = controller;
      const result = await enablePersonalizedWebPush({
        account: {
          userId: user.id,
          accessToken: session.access_token,
        },
        endpoint: "/api/step-out-nudge",
        body: (token) => ({ enabled: true, token }),
        signal: controller.signal,
      });
      if (registrationAbortRef.current === controller) {
        registrationAbortRef.current = null;
      }
      if (result.status === "cancelled") return;
      if (result.status === "account_changed") {
        setNotice("Account changed. Check the active account and try again.");
        return;
      }
      if (result.status === "coordination_unavailable") {
        setNotice("This browser cannot safely coordinate account notifications.");
        return;
      }
      if (result.status === "registration_failed") {
        setNotice("Could not turn on web push. Check notification permission and try again.");
        return;
      }
      if (result.status === "request_failed") {
        setNotice(offlineOrMessage("Could not save the preference. Try again."));
        return;
      }
      if (result.status === "binding_timed_out") {
        setNotice("Notification setup timed out and was safely cancelled. Try again.");
        return;
      }
      const response = result.response;
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setNotice(
          offlineOrMessage(errorMessageFrom(body, "Could not save the preference. Try again."))
        );
        return;
      }
      setPref({
        enabled: true,
        lastSentAt: typeof body.lastSentAt === "string" ? body.lastSentAt : null,
        canSend: body.canSend === true,
        maxPerWeek: 1,
      });
      setNotice("Step Out is on. At most one place-bound push a week.");
    } catch {
      setNotice(
        offlineOrMessage("Could not turn Step Out on. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!user || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await authedActionFetch("/api/step-out-nudge", { method: "DELETE" }, { requiresIdentity: true });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setNotice(
          offlineOrMessage(errorMessageFrom(body, "Could not turn Step Out off. Try again."))
        );
        return;
      }
      if (body.subscriptionRetained !== true) {
        await unregisterWebPush();
      }
      setPref({
        enabled: false,
        lastSentAt: null,
        canSend: false,
        maxPerWeek: 1,
      });
      setNotice("Step Out is off. No weekly nudge will be sent.");
    } catch {
      setNotice(
        offlineOrMessage("Could not turn Step Out off. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  // The live session has not answered: this owner-only card says nothing yet.
  if (!user && viewerSession.unresolved) return null;

  if (!user) {
    return (
      <div id="notifications-settings" data-testid="step-out-nudge-pref">
        <h3>Notifications</h3>
        <p>
          Step Out is a weekly, opt-in nudge for a Wanted pub near your patch, an
          open Soft Plan, or a sourced deal. Sign in to turn it on. Off by default.
          At most one push a week.
        </p>
      </div>
    );
  }

  const enabled = pref?.enabled === true;

  return (
    <div id="notifications-settings" data-testid="step-out-nudge-pref">
      <h3>Notifications</h3>
      <p>
        Step Out sends at most one place-bound push a week when something is
        owed to you: a Wanted pub near your patch, an open Soft Plan for tonight,
        or a sourced deal ending soon. Off by default. Never streak language or
        drink-more pressure.
      </p>
      {needsInstall ? (
        <p className="accountHubNightProfile" data-testid="step-out-ios-install-note">
          On iPhone, web push needs the Home Screen install. Use Share, then Add
          to Home Screen, then open PUBMAXX from the icon before turning this on.
        </p>
      ) : null}
      <div className="accountHubActions">
        {enabled ? (
          <Button variant="secondary" type="button" onClick={() => void withdraw()} disabled={busy}>
            {busy ? "Updating…" : "Turn Step Out off"}
          </Button>
        ) : (
          <Button variant="secondary" type="button" onClick={() => void enable()} disabled={busy}>
            {busy ? "Updating…" : "Turn Step Out on"}
          </Button>
        )}
      </div>
      <p className="accountHubConsentStatus" role="status">
        {enabled
          ? "Step Out on · one push a week maximum."
          : "Step Out off."}
      </p>
      {notice ? (
        <small className="accountHubReferralNotice" role="status">
          {notice}
        </small>
      ) : null}
    </div>
  );
}

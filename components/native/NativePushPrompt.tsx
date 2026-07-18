"use client";

// Contextual native push pre-permission explainer — mounted once at the app
// root (like FirstRunTour) so any plan success path can trigger it via
// recordPlanHighIntentAction() (lib/nativePushPrompt.ts) without needing its
// own copy of this UI. Renders nothing on the server, on the web, or once the
// user has already enabled push / dismissed this occurrence — the gate lives
// in lib/nativePushPrompt.ts (shouldOfferPushPrompt), this component is pure
// presentation + the two button actions.

import { useEffect, useSyncExternalStore } from "react";

import { registerNativePush } from "@/lib/nativePush";
import { trackEvent } from "@/lib/analytics";
import {
  getPushPromptServerSnapshot,
  getPushPromptVisibleSnapshot,
  markPushPromptDismissed,
  markPushPromptEnabled,
  subscribePushPrompt,
} from "@/lib/nativePushPrompt";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";

const PUSH_SURFACE = "native-push";
import "./nativePushPrompt.css";

export default function NativePushPrompt(): React.JSX.Element | null {
  const visible = useSyncExternalStore(
    subscribePushPrompt,
    getPushPromptVisibleSnapshot,
    getPushPromptServerSnapshot,
  );

  const canShow = visible && hasPromptBudgetFor(PUSH_SURFACE);

  // Claim the shared one-prompt-per-session budget at the moment it shows
  // (docs/PROMPT_ORCHESTRATION.md).
  useEffect(() => {
    if (canShow) claimPromptBudget(PUSH_SURFACE);
  }, [canShow]);

  if (!canShow) return null;

  function handleEnable() {
    // Persist immediately so the sheet can't double-fire on a slow
    // registration response; the OS permission dialog appears inside
    // registerNativePush() itself.
    markPushPromptEnabled();
    trackEvent("native_push_prompt_enable");
    void registerNativePush();
  }

  function handleLater() {
    markPushPromptDismissed();
    trackEvent("native_push_prompt_later");
  }

  return (
    <div className="nativePushPrompt">
      <div
        className="nativePushPrompt__card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="native-push-prompt-title"
        aria-describedby="native-push-prompt-body"
      >
        <p id="native-push-prompt-title" className="nativePushPrompt__title">
          Stay in the loop
        </p>
        <p id="native-push-prompt-body" className="nativePushPrompt__body">
          Get pinged when your crew votes or the get-in closes.
        </p>
        <div className="nativePushPrompt__actions">
          <button type="button" className="nativePushPrompt__later pressable" onClick={handleLater}>
            Later
          </button>
          <button type="button" className="nativePushPrompt__enable pressable" onClick={handleEnable}>
            Enable
          </button>
        </div>
      </div>
    </div>
  );
}

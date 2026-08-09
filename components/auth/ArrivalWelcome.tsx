"use client";

// The warm second after a sign-in lands. One line, no decisions, no chrome to
// dismiss before the page is usable. Mounted once at the app root beside
// AccountOnboarding (components/auth/AuthProvider.tsx).
//
// It is deliberately NOT a dialog. It has no backdrop, no aria-modal, no focus
// trap and no blocking layer, because the failure this replaces was exactly
// that: a root-mounted modal that covered every tab until React state cleared
// it. This is a polite live region that names the person and then leaves.
//
// It shows only for an account that already owns a handle. An account still
// choosing one meets the claim step instead, so the two never stack.

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  ARRIVAL_WELCOME_HANDLE_WAIT_MS,
  ARRIVAL_WELCOME_VISIBLE_MS,
  arrivalWelcomeLine,
  clearArrival,
  peekArrival,
  type ArrivalIntent,
} from "@/lib/arrivalWelcome";

import "./arrivalWelcome.css";

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function ArrivalWelcomeLine({
  line,
  leaving,
  onDismiss,
}: {
  line: string;
  leaving: boolean;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="arrivalWelcome" data-leaving={leaving ? "" : undefined}>
      <p className="arrivalWelcomeLine" role="status" aria-live="polite">
        {line}
      </p>
      <button
        type="button"
        className="arrivalWelcomeDismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export default function ArrivalWelcome(): React.JSX.Element | null {
  const { user, handle } = useAuth();
  const [intent, setIntent] = useState<ArrivalIntent | null>(null);
  const [leaving, setLeaving] = useState(false);
  const shown = useRef(false);

  // Check the one-shot marker once the handle lookup answers. Reading it is
  // cheap and side-effect free; the marker is only consumed once the line can
  // actually be written, or once the wait is spent.
  //
  // The check runs from a timer rather than the effect body because
  // react-hooks/set-state-in-effect is an error in this codebase: a synchronous
  // setState here would cascade a second render on every auth change.
  useEffect(() => {
    if (shown.current || !user) return;
    const check = window.setTimeout(() => {
      const storage = tabStorage();
      if (!peekArrival(storage, Date.now())) return;
      if (!handle) return;
      shown.current = true;
      const pending = peekArrival(storage, Date.now());
      clearArrival(storage);
      if (pending) setIntent(pending);
    }, 0);
    const giveUp = window.setTimeout(() => {
      if (!shown.current) clearArrival(tabStorage());
    }, ARRIVAL_WELCOME_HANDLE_WAIT_MS);
    return () => {
      window.clearTimeout(check);
      window.clearTimeout(giveUp);
    };
  }, [handle, user]);

  const dismiss = useCallback(() => {
    setLeaving(true);
  }, []);

  // Retire on its own. The exit is shorter than the entrance: the system is
  // responding, not deciding.
  useEffect(() => {
    if (!intent || leaving) return;
    const timer = window.setTimeout(() => setLeaving(true), ARRIVAL_WELCOME_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [intent, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      setIntent(null);
      setLeaving(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!intent || !handle) return null;
  const line = arrivalWelcomeLine(intent, handle);
  if (!line) return null;

  return <ArrivalWelcomeLine line={line} leaving={leaving} onDismiss={dismiss} />;
}

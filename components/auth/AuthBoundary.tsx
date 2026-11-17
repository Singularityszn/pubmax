"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import IdentityNudge from "@/components/identity/IdentityNudge";
import { loadAuthRuntime } from "@/components/auth/authRuntimeLoader";
import { AuthContext } from "@/components/auth/authContext";
import type { AuthProvider as Runtime } from "@/components/auth/AuthProvider";
import { ensureSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import { isAuthEntryPath } from "@/lib/authClientTurn";
import { createAuthContextBridge } from "@/lib/authContextBridge";
import { readProviderAccountSignal, setProviderAuthState } from "@/lib/authProviderRevision";
import { loadSocialAuthProviders, NO_SOCIAL_AUTH_PROVIDERS } from "@/lib/authProviderAvailability";
import {
  cancelBeforeAuthRuntime, captureBrowserAuthReturn, releaseBrowserAuthReturn, scrubLingeringBrowserAuthCallback,
} from "@/lib/browserAuthReturn";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import { requestDeploymentSkewCheck } from "@/lib/deploymentSkewRecovery";

/** Children and their context keep the same owner while the session runtime loads. */
export function AuthBoundary({ children, clerkIntegrationConfigured }: {
  children?: ReactNode; clerkIntegrationConfigured: boolean;
}) {
  const configured = isAuthConfigured();
  const [bridge] = useState(() => createAuthContextBridge({ configured, clerkIntegrationConfigured }, {
    cancelPending: cancelBeforeAuthRuntime, accountSignal: readProviderAccountSignal,
  }));
  const value = useSyncExternalStore(bridge.subscribe, bridge.read, bridge.read);
  const [loaded, setRuntime] = useState<{ component: typeof Runtime; callback: ReturnType<typeof captureBrowserAuthReturn> } | null>(null);
  const SessionRuntime = loaded?.component;
  const callback = useRef<ReturnType<typeof captureBrowserAuthReturn> | undefined>(undefined);
  const [failed, setFailed] = useState(false);


  useEffect(() => {
    const version = bridge.mount();
    let active = true;
    setProviderAuthState("supabase", configured ? "unresolved" : "signed-out");
    markPubmaxTiming("pubmax:auth-provider-mounted");
    // Capture and scrub before starting the runtime import or any network await.
    const captured = callback.current ??= captureBrowserAuthReturn();
    if (isAuthEntryPath(window.location.pathname)) void ensureSupabaseBrowser().catch(() => {});
    const sweep = window.setTimeout(scrubLingeringBrowserAuthCallback, 2_000);
    if (configured) void loadSocialAuthProviders().then((providers) => {
      if (active) bridge.socialProviders(providers ?? NO_SOCIAL_AUTH_PROVIDERS);
    });
    void loadAuthRuntime().then((AuthProvider) => {
      if (active) setRuntime({ component: AuthProvider, callback: captured });
    }, () => {
      if (!active) return;
      bridge.fail();
      void captured.then((result) => { if (active && result?.attempt) setFailed(true); }, () => {});
      releaseBrowserAuthReturn(captured);
      requestDeploymentSkewCheck();
    });
    return () => {
      active = false;
      window.clearTimeout(sweep);
      // Strict Mode replays the effect before this microtask runs.
      queueMicrotask(() => {
        if (!bridge.ownsMount(version)) return;
        bridge.dispose();
        releaseBrowserAuthReturn(captured);
      });
    };
  }, [bridge, configured]);

  return <AuthContext.Provider value={value}>
    {children}
    {SessionRuntime ? <SessionRuntime
      clerkIntegrationConfigured={clerkIntegrationConfigured}
      capturedAuthReturn={loaded.callback}
      initialSocialProviders={value.socialProvidersResolved ? value.socialProviders : null}
      publishContext={bridge.publish}
    /> : null}
    {failed ? <div className="authCallbackNotice" role="alert">Sign-in could not load. Check your connection and reload this page.</div> : null}
    <IdentityNudge />
  </AuthContext.Provider>;
}

"use client";

import { useCallback, useRef } from "react";

import {
  fetchCurrentDeploymentId,
  getClientDeploymentId,
  getSessionStorage,
  hasUnsavedUserInput,
  recoverDeploymentSkew,
} from "@/lib/deploymentSkewRecovery";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";

const DEPLOYMENT_RECOVERY_EVENTS = ["visible", "pageshow"] as const;

export default function DeploymentSkewRecovery(): null {
  const checkingRef = useRef(false);
  const checkDeployment = useCallback(() => {
    if (checkingRef.current) return;
    const clientDeploymentId = getClientDeploymentId();
    if (!clientDeploymentId) return;

    checkingRef.current = true;
    void fetchCurrentDeploymentId().then((currentDeploymentId) => {
      recoverDeploymentSkew({
        clientDeploymentId,
        currentDeploymentId,
        storage: getSessionStorage(),
        isDirty: () => hasUnsavedUserInput(document),
        reload: () => window.location.reload(),
      });
    }).finally(() => {
      checkingRef.current = false;
    });
  }, []);

  useReconnectRecovery(true, checkDeployment, {
    debounceMs: 0,
    events: DEPLOYMENT_RECOVERY_EVENTS,
  });

  return null;
}

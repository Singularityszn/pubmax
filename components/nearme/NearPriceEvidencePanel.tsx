"use client";

import { Component, lazy, Suspense, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";

import { ReadyButton } from "@/components/ui/ready-button";

import type NearPriceEvidenceMission from "./NearPriceEvidenceMission";

type MissionProps = ComponentProps<typeof NearPriceEvidenceMission>;
type MissionLoader = () => Promise<{ default: ComponentType<MissionProps> }>;

class MissionBoundary extends Component<{
  children: ReactNode;
  failed: ReactNode;
  onFailure: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.failed : this.props.children; }
}

/** Keep an optional price check local, including a fresh import after failure. */
export function createNearPriceEvidencePanel(load: MissionLoader): ComponentType<MissionProps> {
  let Current = lazy(load);
  const reload = () => { Current = lazy(load); };
  return function NearPriceEvidencePanel(props: MissionProps) {
    const [attempt, setAttempt] = useState(0);
    const Mission = Current;
    return (
      <MissionBoundary
        key={attempt}
        onFailure={reload}
        failed={<div className="nmnStatus nmnStatusFail" role="alert">
          <p>Price check could not load.</p>
          <ReadyButton type="button" className="nmnRetry" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </ReadyButton>
        </div>}
      >
        <Suspense fallback={<div className="nmnStatus" role="status">Loading price check.</div>}>
          <Mission {...props} />
        </Suspense>
      </MissionBoundary>
    );
  };
}

export default createNearPriceEvidencePanel(() => import("./NearPriceEvidenceMission"));

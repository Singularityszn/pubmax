"use client";

import { Component, lazy, Suspense, useLayoutEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode, type RefObject } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { ReadyButton } from "@/components/ui/ready-button";

import type NearPriceEvidenceMission from "./NearPriceEvidenceMission";

type MissionProps = ComponentProps<typeof NearPriceEvidenceMission>;
type MissionLoader = () => Promise<{ default: ComponentType<MissionProps> }>;

/** Keep the mission layout intact and transfer only focus held by its previous phase. */
function MissionFocus({ children, transfer }: { children: ReactNode; transfer: RefObject<boolean> }) {
  const start = useRef<HTMLSpanElement>(null);
  const end = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const anchor = start.current;
    const nodes: HTMLElement[] = [];
    for (let node = start.current?.nextElementSibling; node && node !== end.current; node = node.nextElementSibling) {
      if (node instanceof HTMLElement) nodes.push(node);
    }
    if (transfer.current) {
      const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
      const target = nodes.flatMap((node) => [node, ...node.querySelectorAll<HTMLElement>(selector)])
        .find((node) => node.matches(selector) && !node.closest('[hidden], [inert], [aria-hidden="true"]'));
      (target ?? anchor)?.focus();
    }
    return () => {
      transfer.current = document.activeElement === anchor || nodes.some((node) => node.contains(document.activeElement));
    };
  }, [transfer]);
  return <><span ref={start} className="sr-only" tabIndex={-1}>Price check</span>{children}<span ref={end} hidden /></>;
}

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
  function EligibleMissionPanel(props: MissionProps) {
    const [attempt, setAttempt] = useState(0);
    const transfer = useRef(false);
    const Mission = Current;
    return (
      <MissionBoundary
        key={attempt}
        onFailure={reload}
        failed={<MissionFocus key="failed" transfer={transfer}><div className="nmnStatus nmnStatusFail" role="alert">
          <p>Price check could not load.</p>
          <ReadyButton type="button" className="nmnRetry" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </ReadyButton>
        </div></MissionFocus>}
      >
        <Suspense fallback={<MissionFocus key="loading" transfer={transfer}><div className="nmnStatus" role="status">Loading price check.</div></MissionFocus>}>
          <MissionFocus key="ready" transfer={transfer}><Mission {...props} /></MissionFocus>
        </Suspense>
      </MissionBoundary>
    );
  }
  return function NearPriceEvidencePanel(props: MissionProps) {
    const { user, identityResolved } = useAuth();
    if (!props.enabled || !identityResolved || !user) return null;
    return <EligibleMissionPanel key={user.id} {...props} />;
  };
}

export default createNearPriceEvidencePanel(() => Promise.all([
  import("../map/venuePriceSubmit.css"),
  import("./NearPriceEvidenceMission"),
]).then(([, mission]) => mission));

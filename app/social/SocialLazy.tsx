"use client";

import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";

type BoundaryProps = { children: ReactNode; failed: ReactNode; onFailure: () => void };

class SocialLoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.failed : this.props.children; }
}

/** A failed optional Social tool stays local and can request its chunk again. */
export function socialLazy<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
  loading: ReactNode,
): ComponentType<P> {
  let Current = lazy(load);
  function SocialLazyTool(props: P) {
    const [attempt, setAttempt] = useState(0);
    const Tool = Current;
    return (
      <SocialLoadBoundary
        key={attempt}
        onFailure={() => { Current = lazy(load); }}
        failed={<div role="alert">{label} could not load. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
      >
        <Suspense fallback={loading}><Tool {...props} /></Suspense>
      </SocialLoadBoundary>
    );
  }
  return SocialLazyTool;
}

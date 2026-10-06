"use client";

import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";

import "./lazyPanel.css";

// A map panel that loads on demand (the search field, today) and fails INSIDE
// itself. A bare `React.lazy` caches its rejected import for the life of the
// module, and a rejected chunk reaches the nearest error boundary, which for the
// map is app/error.tsx: one lost request replaced the whole screen with "Spilled."
// and the next tap on the panel could only throw again. Here the boundary is the
// panel's own, the fallback says what is missing, and Try again mounts a fresh
// `lazy()` so the import is asked for again rather than read back from the cache.

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

type BoundaryProps = { fallback: ReactNode; children: ReactNode };
type BoundaryState = { failed: boolean };

class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[lazy panel]", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function lazyPanel<P extends object>(
  load: Loader<P>,
  failedLabel: string,
): ComponentType<P> {
  function LazyPanel(props: P) {
    // Each attempt owns its own lazy component and its own boundary (the key),
    // so a retry starts from a clean cache and a clean error state.
    const [attempt, setAttempt] = useState(0);
    const Panel = useMemo(() => lazy(load), [attempt]); // eslint-disable-line react-hooks/exhaustive-deps
    const retry = useCallback(() => setAttempt((current) => current + 1), []);
    return (
      <PanelBoundary
        key={attempt}
        fallback={
          <div className="lazyPanelFailed" role="alert">
            <span className="lazyPanelFailedCopy">{failedLabel}</span>
            <Button type="button" variant="secondary" onClick={retry}>
              Try again
            </Button>
          </div>
        }
      >
        <Suspense fallback={null}>
          <Panel {...(props as P & object)} />
        </Suspense>
      </PanelBoundary>
    );
  }
  LazyPanel.displayName = "LazyPanel";
  return LazyPanel;
}

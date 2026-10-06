"use client";

import {
  Component,
  lazy,
  Suspense,
  useCallback,
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
// panel's own and the fallback says what is missing. Every mount shares one
// `lazy()`, so a panel that has loaded once opens at once; a failure swaps in a
// fresh one, so Try again or the next open asks for the import again rather than
// reading the rejection back from the cache.

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

type BoundaryProps = { fallback: ReactNode; onFailed: () => void; children: ReactNode };
type BoundaryState = { failed: boolean };

class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[lazy panel]", error, info.componentStack);
    this.props.onFailed();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function lazyPanel<P extends object>(
  load: Loader<P>,
  failedLabel: string,
): ComponentType<P> {
  let current = lazy(load);
  const reload = () => {
    current = lazy(load);
  };
  function LazyPanel(props: P) {
    // Each attempt owns its own boundary (the key), so a retry starts from a
    // clean error state and renders the lazy component the failure swapped in.
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((count) => count + 1), []);
    const Panel = current;
    return (
      <PanelBoundary
        key={attempt}
        onFailed={reload}
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

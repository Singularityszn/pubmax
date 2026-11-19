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

// Keep a failed search import inside its panel so the map remains usable.
// A fresh lazy component clears React's rejected promise. The bundler can keep
// the failed chunk cached, so a ChunkLoadError after an explicit retry reloads
// the document. The initial attempt never reloads, which prevents a reload loop.

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

export const SEARCH_CHUNK_RELOAD_KEY = "pubmax:search-chunk-reload";

type BoundaryProps = { fallback: ReactNode; onFailed: (error: Error) => void; children: ReactNode };
type BoundaryState = { failed: boolean };

class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[lazy panel]", error, info.componentStack);
    this.props.onFailed(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function lazyPanel<P extends object>(
  load: Loader<P>,
  failedLabel: string,
): ComponentType<P> {
  const loadPanel: Loader<P> = () => load().then((panel) => {
    try { sessionStorage.removeItem(SEARCH_CHUNK_RELOAD_KEY); } catch { /* Storage may be unavailable. */ }
    return panel;
  });
  let current = lazy(loadPanel);
  const reload = () => {
    current = lazy(loadPanel);
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
        onFailed={(error) => {
          reload();
          if (attempt === 0 || error.name !== "ChunkLoadError") return;
          try {
            sessionStorage.setItem(SEARCH_CHUNK_RELOAD_KEY, location.href);
          } catch {}
          location.reload();
        }}
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

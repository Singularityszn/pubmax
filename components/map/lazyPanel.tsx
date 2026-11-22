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

/** A lazy panel that can fetch its chunk ahead of the tap that opens it. */
export type LazyPanel<P> = ComponentType<P> & { warm: () => Promise<void> };

export function lazyPanel<P extends object>(
  load: Loader<P>,
  failedLabel: string,
): LazyPanel<P> {
  // React.lazy reads a module only when it first renders, so a warmed module
  // is held here and drawn in the opening commit rather than one frame later.
  let ready: ComponentType<P> | null = null;
  let loading: Promise<{ default: ComponentType<P> }> | null = null;
  const loadPanel: Loader<P> = () => (loading ??= load().then(
    (panel) => {
      try { sessionStorage.removeItem(SEARCH_CHUNK_RELOAD_KEY); } catch { /* Storage may be unavailable. */ }
      ready = panel.default;
      return panel;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));
  let current = lazy(loadPanel);
  const reload = () => {
    current = lazy(loadPanel);
  };
  function LazyPanel(props: P) {
    // Each attempt owns its own boundary (the key), so a retry starts from a
    // clean error state and renders the lazy component the failure swapped in.
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((count) => count + 1), []);
    // One component type for the life of a mount, so a warm that lands while
    // the panel is suspended never remounts it.
    const [Warmed] = useState(() => ready);
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
        {Warmed && attempt === 0 ? (
          <Warmed {...(props as P & object)} />
        ) : (
          <Suspense fallback={null}>
            <Panel {...(props as P & object)} />
          </Suspense>
        )}
      </PanelBoundary>
    );
  }
  LazyPanel.displayName = "LazyPanel";
  LazyPanel.warm = () => loadPanel().then(() => undefined, () => undefined);
  return LazyPanel;
}

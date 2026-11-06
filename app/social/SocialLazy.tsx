"use client";

import { Component, lazy, Suspense, useLayoutEffect, useRef, useSyncExternalStore, type ComponentType, type ReactNode, type RefObject } from "react";

function SocialToolFocus({ children, label, transfer }: { children: ReactNode; label: string; transfer: RefObject<boolean> }) {
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
  return <><span ref={start} className="srOnly" tabIndex={-1}>{label}</span>{children}<span ref={end} hidden /></>;
}

type BoundaryProps = { children: ReactNode; failed: ReactNode; onFailure: () => void };

class SocialLoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.failed : this.props.children; }
}

/**
 * A failed optional Social tool stays local and can request its chunk again.
 * Every instance of one tool shares a single download, so a retry from any of
 * them recovers them all. `frame` places the wait and the failure, for a tool
 * whose loaded form is not drawn where it is mounted (a full-screen layer).
 */
export type SocialLazyTool<P extends object> = ComponentType<P> & {
  /** Start the download early. A copy mounted after it lands draws at once. */
  preload: () => Promise<void>;
};

export function socialLazy<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
  loading: ReactNode,
  frame?: (state: ReactNode, props: P) => ReactNode,
): SocialLazyTool<P> {
  // Code that has arrived renders directly, so no wait is ever committed for
  // it. React.lazy suspends on the first render of each lazy even when its
  // download already finished.
  let loaded: ComponentType<P> | null = null;
  const remember = (module: { default: ComponentType<P> }) => {
    loaded = module.default;
    return module;
  };
  const fresh = () => lazy(() => load().then(remember));
  let Current = fresh();
  let early: Promise<void> | null = null;
  const preload = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    // A failed early download is left to the mounted tool, which retries.
    early ??= load().then(remember).then(() => undefined, () => { early = null; });
    return early;
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const readGeneration = () => generation;
  const retry = () => {
    generation += 1;
    for (const listener of listeners) listener();
  };
  function SocialLazyTool(props: P) {
    const attempt = useSyncExternalStore(subscribe, readGeneration, readGeneration);
    const transfer = useRef(false);
    const Tool = loaded ?? Current;
    const place = (state: ReactNode) => (frame ? frame(state, props) : state);
    return (
      <SocialLoadBoundary
        key={attempt}
        onFailure={() => {
          // One rejected download fails every mounted instance. Replace it
          // once, and never replace a newer download that has not failed.
          if (Current === Tool) Current = fresh();
        }}
        failed={place(<SocialToolFocus key="failed" label={label} transfer={transfer}><div role="alert">{label} could not load. <button type="button" onClick={retry}>Try again</button></div></SocialToolFocus>)}
      >
        <Suspense fallback={place(<SocialToolFocus key="loading" label={label} transfer={transfer}>{loading}</SocialToolFocus>)}>
          <SocialToolFocus key="ready" label={label} transfer={transfer}><Tool {...props} /></SocialToolFocus>
        </Suspense>
      </SocialLoadBoundary>
    );
  }
  return Object.assign(SocialLazyTool, { preload });
}

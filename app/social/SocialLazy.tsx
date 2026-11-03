"use client";

import { Component, lazy, Suspense, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";

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

/** A failed optional Social tool stays local and can request its chunk again. */
export function socialLazy<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
  loading: ReactNode,
): ComponentType<P> {
  let Current = lazy(load);
  function SocialLazyTool(props: P) {
    const [attempt, setAttempt] = useState(0);
    const transfer = useRef(false);
    const Tool = Current;
    return (
      <SocialLoadBoundary
        key={attempt}
        onFailure={() => { Current = lazy(load); }}
        failed={<SocialToolFocus key="failed" label={label} transfer={transfer}><div role="alert">{label} could not load. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div></SocialToolFocus>}
      >
        <Suspense fallback={<SocialToolFocus key="loading" label={label} transfer={transfer}>{loading}</SocialToolFocus>}>
          <SocialToolFocus key="ready" label={label} transfer={transfer}><Tool {...props} /></SocialToolFocus>
        </Suspense>
      </SocialLoadBoundary>
    );
  }
  return SocialLazyTool;
}

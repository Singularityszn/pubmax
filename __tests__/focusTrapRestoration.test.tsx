// @vitest-environment jsdom
import { act, Fragment, StrictMode, useEffect, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import {
  readStrictModalFocusTrap,
  serverStrictModalFocusTrap,
  subscribeStrictModalFocusTrap,
  useFocusTrap,
} from "@/lib/useFocusTrap";

function Modal() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <div ref={ref} role="dialog" tabIndex={-1}>Modal</div>;
}

function Surface({ open }: { open: boolean }) {
  const blocked = useSyncExternalStore(
    subscribeStrictModalFocusTrap,
    readStrictModalFocusTrap,
    serverStrictModalFocusTrap,
  );
  return (
    <>
      <nav inert={blocked || undefined}><button>Map</button></nav>
      {open ? <Modal /> : null}
    </>
  );
}

it.each([false, true])("restores focus after navigation clears inert (StrictMode=%s)", async (strict) => {
  const Wrapper = strict ? StrictMode : Fragment;
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Wrapper><Surface open={false} /></Wrapper>));
    const opener = host.querySelector("button")!;
    opener.focus();
    await act(async () => root.render(<Wrapper><Surface open /></Wrapper>));
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
    expect(opener.closest("[inert]")).not.toBeNull();

    await act(async () => root.render(<Wrapper><Surface open={false} /></Wrapper>));
    expect(opener.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (original) Object.defineProperty(HTMLElement.prototype, "inert", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "inert");
  }
});

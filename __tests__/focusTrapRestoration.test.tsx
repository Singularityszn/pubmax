// @vitest-environment jsdom
import { act, Fragment, StrictMode, useEffect, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import {
  FocusTrapOwner,
  readStrictModalFocusTrap,
  serverStrictModalFocusTrap,
  subscribeStrictModalFocusTrap,
  useFocusTrap,
} from "@/lib/useFocusTrap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const searchReturnTarget = () => document.querySelector<HTMLElement>("[data-return-search]");
function ReturningModal({ trapped }: { trapped: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(trapped, ref, "map-surface", undefined, searchReturnTarget);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div ref={ref} role="dialog" tabIndex={-1}>Night</div>;
}
function ReturningSurface({ open, trapped = true }: { open: boolean; trapped?: boolean }) {
  return <>
    <nav><button data-return-search>Search</button>{open ? null : <button data-opener>Draw</button>}</nav>
    {open ? <ReturningModal trapped={trapped} /> : null}
  </>;
}

it.each([false, true])("returns to Search after the WebKit Close origin leaves the DOM (trapped=%s)", async (trapped) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReturningSurface open={false} />));
    host.querySelector<HTMLElement>("[data-opener]")!.focus();
    await act(async () => root.render(<ReturningSurface open trapped={trapped} />));
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
    await act(async () => root.render(<ReturningSurface open={false} />));
    const search = host.querySelector<HTMLElement>("[data-return-search]")!;
    expect(search.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(search);
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});

it("retains focus inside the result when its sheet moves from half to peek", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReturningSurface open />));
    const heading = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(heading);
    await act(async () => root.render(<ReturningSurface open trapped={false} />));
    expect(document.activeElement).toBe(heading);
    await act(async () => root.render(<ReturningSurface open={false} />));
    expect(document.activeElement).toBe(host.querySelector("[data-return-search]"));
  } finally {
    await act(async () => root.unmount()); host.remove();
  }
});

it("releases inert ownership before resolving an explicit return target", () => {
  const nav = document.createElement("nav"), opener = document.createElement("button"), search = document.createElement("button");
  nav.append(opener, search); document.body.append(nav); opener.focus();
  const owner = new FocusTrapOwner();
  let wasInert: boolean | undefined;
  owner.captureFocus(opener, () => { wasInert = nav.inert; return search; });
  try {
    owner.reconcile([nav]); opener.remove(); owner.release();
    expect(wasInert).toBeFalsy();
    expect(document.activeElement).toBe(search);
  } finally { owner.release(); nav.remove(); }
});

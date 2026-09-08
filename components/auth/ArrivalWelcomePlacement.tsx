"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { retainArrivalWelcomeSpace, useArrivalWelcomeHost } from "./ArrivalWelcomeSlot";

export default function ArrivalWelcomePlacement({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const host = useArrivalWelcomeHost();
  const content = useRef<HTMLDivElement>(null);
  const recipientPage = pathname === "/messages/new";

  useLayoutEffect(() => {
    if (!recipientPage || !host) return;
    let live = true;
    const retainSpace = () => {
      const node = content.current;
      if (!live || !node) return;
      retainArrivalWelcomeSpace(node);
    };
    retainSpace();
    void document.fonts.ready.then(retainSpace);
    window.addEventListener("resize", retainSpace);
    return () => { live = false; window.removeEventListener("resize", retainSpace); };
  }, [children, host, recipientPage]);

  if (!recipientPage) return children;
  if (!host?.isConnected) return null;
  return createPortal(<div className="messageRecipientArrivalContent" ref={content}>{children}</div>, host);
}

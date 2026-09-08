"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

export default function ArrivalWelcomePlacement({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const recipientPage = pathname === "/messages/new";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHost(recipientPage ? document.getElementById("message-recipient-arrival") : null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, recipientPage]);

  useLayoutEffect(() => {
    if (!recipientPage || !host) return;
    let live = true;
    const retainSpace = () => {
      const node = content.current;
      if (!live || !node || !host.contains(node)) return;
      // The page owns this slot, so its occupied space survives the greeting's dismissal.
      host.style.minHeight = `${Math.max(parseFloat(host.style.minHeight) || 0, Math.ceil(node.getBoundingClientRect().height))}px`;
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

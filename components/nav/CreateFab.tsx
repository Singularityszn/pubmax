"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";

import { shouldShowMobileTabBar } from "@/components/nav/MobileTabBar";
import { momentHref } from "@/components/nav/navigationModel";
import { trackEvent } from "@/lib/analytics";
import {
  readSoftKeyboardOpen,
  serverSoftKeyboardOpen,
  subscribeSoftKeyboard,
} from "@/lib/softKeyboard";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

import "./createFab.css";

const ACTIONS = [
  { action: "moment", label: "Post a moment", hrefFor: (returnTo: string) => momentHref(returnTo) },
  { action: "price", label: "Log a price", hrefFor: () => "/map?log=1" },
  { action: "plan", label: "Start a plan", hrefFor: () => "/plan" },
] as const;

export default function CreateFab() {
  const pathname = usePathname() ?? "";
  if (!shouldShowMobileTabBar(pathname)) return null;
  return <CreateFabContent pathname={pathname} />;
}

function CreateFabContent({ pathname }: { pathname: string }) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const keyboardOpen = useSyncExternalStore(
    subscribeSoftKeyboard,
    readSoftKeyboardOpen,
    serverSoftKeyboardOpen,
  );

  const returnTo = pathname;

  const close = useCallback(() => setOpen(false), []);
  useDismissOnEscape(open, close);

  useEffect(() => {
    if (keyboardOpen) close();
  }, [keyboardOpen, close]);

  return (
    <div
      className={"createFabRoot" + (keyboardOpen ? " isKeyboardHidden" : "")}
      aria-hidden={keyboardOpen || undefined}
    >
      {open ? (
        <div className="createFabMenu" id={menuId} role="menu" aria-label="Create">
          {ACTIONS.map((item) => (
            <Link
              key={item.action}
              role="menuitem"
              className="createFabRow"
              href={item.action === "plan" ? "/plan" : item.hrefFor(returnTo)}
              onClick={() => {
                trackEvent("create_fab_action", { action: item.action });
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="createFab"
        data-testid="create-fab"
        aria-label="Create"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={24} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}

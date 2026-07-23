"use client";

// Desktop SiteNav "More" overflow (Wave D2.2). Secondary destinations that are
// not in the primary Today/Map/Tonight/Stories/You row. Desktop ≥641 only —
// CSS hides this entire control on phones so the compact bar stays unchanged.
// Links only: no feature rewrites. Esc closes; ArrowUp/Down move focus.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export const SITE_NAV_MORE_LINKS = [
  { href: "/plan", label: "Plan" },
  { href: "/near", label: "Near" },
  { href: "/pubs", label: "Pubs" },
  { href: "/historic", label: "Historic" },
  { href: "/pal", label: "Pal" },
] as const;

function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteNavMore(): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    if (!items.length) return;
    const current = document.activeElement;
    const index = items.findIndex((el) => el === current);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = index < 0 ? 0 : (index + 1) % items.length;
      items[next]?.focus();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <div className="siteNavMore" ref={rootRef} onKeyDown={onMenuKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? "siteNavMoreBtn isOpen" : "siteNavMoreBtn"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>More</span>
        <ChevronDown size={14} aria-hidden="true" className="siteNavMoreChevron" />
      </button>
      {open ? (
        <div className="siteNavMoreMenu" id={menuId} role="menu" aria-label="More pages">
          {SITE_NAV_MORE_LINKS.map((link, index) => {
            const active = pathMatches(pathname, link.href);
            return (
              <Link
                key={link.href}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                href={link.href}
                role="menuitem"
                className={active ? "siteNavMoreItem isActive" : "siteNavMoreItem"}
                aria-current={active ? "page" : undefined}
                onClick={close}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

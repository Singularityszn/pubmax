"use client";

// Desktop SiteNav "More" overflow (Wave D2.2). Secondary destinations that are
// not in the primary Today/Map/Tonight/Stories/You row. Desktop ≥641 only —
// CSS hides this entire control on phones so the compact bar stays unchanged.
// Links only: no feature rewrites. Esc closes; ArrowUp/Down move focus.
//
// Menu is portaled to document.body with position:fixed. The siteNavBar uses
// backdrop-filter + pill border-radius, which clips absolutely positioned
// descendants (design-gate: Historic/Pal were cut off). Portaling escapes that.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

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

type MenuCoords = { top: number; right: number };

export default function SiteNavMore(): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const measure = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onReposition() {
      measure();
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    // Capture scroll from any ancestor so fixed coords stay aligned.
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, measure]);

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

  const menuStyle: CSSProperties | undefined = coords
    ? { top: coords.top, right: coords.right }
    : undefined;

  // Portal only in the browser (document exists after hydration). Avoid a
  // mounted-flag effect — house lint forbids setState in effect bodies.
  const menu =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="siteNavMoreMenu siteNavMoreMenuPortaled"
            id={menuId}
            role="menu"
            aria-label="More pages"
            style={menuStyle}
            onKeyDown={onMenuKeyDown}
          >
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
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="siteNavMore">
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
      {menu}
    </div>
  );
}

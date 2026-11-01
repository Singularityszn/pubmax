import {
  Activity,
  Component,
  HomeIcon,
  Mail,
  Package,
  ScrollText,
  SunMoon,
} from "lucide-react";

import { Dock, DockIcon, DockItem, DockLabel } from "@/components/ui/dock";

/**
 * The Motion Primitives demo, kept as the Dock's worked example. Each item is
 * a real link with its own name; the label above it is only what a sighted
 * reader sees. `__tests__/dock.test.tsx` renders it.
 */
const data = [
  { title: "Home", icon: HomeIcon, href: "#" },
  { title: "Products", icon: Package, href: "#" },
  { title: "Components", icon: Component, href: "#" },
  { title: "Activity", icon: Activity, href: "#" },
  { title: "Change Log", icon: ScrollText, href: "#" },
  { title: "Email", icon: Mail, href: "#" },
  { title: "Theme", icon: SunMoon, href: "#" },
] as const;

export function AppleStyleDock() {
  return (
    <div className="absolute bottom-2 left-1/2 max-w-full -translate-x-1/2">
      <Dock className="items-end">
        {data.map((item) => (
          <DockItem
            key={item.title}
            className="aspect-square rounded-[var(--radius-pill)] bg-[var(--state-selected-surface)]"
          >
            <DockLabel>{item.title}</DockLabel>
            <a
              href={item.href}
              aria-label={item.title}
              className="flex h-full w-full items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-text-muted)]"
            >
              <DockIcon>
                <item.icon className="h-full w-full" />
              </DockIcon>
            </a>
          </DockItem>
        ))}
      </Dock>
    </div>
  );
}

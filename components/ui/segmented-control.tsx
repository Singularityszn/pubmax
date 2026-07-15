import * as React from "react";
import { cn } from "@/lib/utils";

export function SegmentedControl({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={cn("inline-flex min-h-11 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-1", className)} {...props} />;
}

export function SegmentedControlItem({ active, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" aria-pressed={active} className={cn("min-h-9 rounded-[calc(var(--radius)-4px)] px-3 text-sm font-bold text-[var(--color-text-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]", active && "bg-[var(--color-surface-raised)] text-[var(--color-text)] shadow-sm", className)} {...props} />;
}

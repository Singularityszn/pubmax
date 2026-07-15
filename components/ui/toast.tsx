import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";

export function Toast({ title, description, onDismiss, className }: { title: string; description?: string; onDismiss?: () => void; className?: string }) {
  return <div role="status" className={cn("grid min-h-11 grid-cols-[1fr_auto] gap-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 shadow-[var(--shadow)]", className)}><strong>{title}</strong>{description ? <p className="col-start-1 m-0 text-sm text-[var(--color-text-soft)]">{description}</p> : null}{onDismiss ? <IconButton className="col-start-2 row-span-2 row-start-1" aria-label="Dismiss notification" onClick={onDismiss}><X size={16} /></IconButton> : null}</div>;
}

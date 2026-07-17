import * as React from "react";
import { Search, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export function SearchField({ className, value, onChange, label = "Search pubs", ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <label className={cn("flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 focus-within:ring-2 focus-within:ring-[var(--color-accent)]", className)}>
      <Search size={18} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input className="min-w-0 flex-1 border-0 bg-transparent text-base text-[var(--color-text)] outline-none" type="search" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
      {value ? <IconButton className="-mr-2 size-11 border-0 bg-transparent" aria-label="Clear search" onClick={() => onChange("")}><X size={17} /></IconButton> : null}
    </label>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-panel)] motion-reduce:animate-none", className)} {...props} />;
}

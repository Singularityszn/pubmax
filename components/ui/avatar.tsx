import * as React from "react";
import { cn } from "@/lib/utils";

export const Avatar = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => <span ref={ref} className={cn("inline-grid size-11 shrink-0 place-items-center overflow-hidden rounded-full", className)} {...props} />,
);
Avatar.displayName = "Avatar";

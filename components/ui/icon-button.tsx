import * as React from "react";
import { clsx } from "clsx";
import { Button, type ButtonProps } from "@/components/ui/button";

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "icon", variant = "secondary", ...props }, ref) => (
    <Button ref={ref} size={size} variant={variant} className={clsx("shrink-0 uiButton--pill", className)} {...props} />
  ),
);
IconButton.displayName = "IconButton";

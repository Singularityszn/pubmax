import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { chipVariants, renderChip } from "./chipBase";

export interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, variant, ...props }, ref) => renderChip({
    ...props,
    className: cn(chipVariants({ variant, className })),
  }, ref),
);
Chip.displayName = "Chip";

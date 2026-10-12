import * as React from "react";
import { chipVariants, renderChip } from "./chipBase";

/** The same number chip, with no arbitrary class or variant override. */
export type NumberChipProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "variant">;

export const NumberChip = React.forwardRef<HTMLButtonElement, NumberChipProps>(
  (props, ref) => renderChip({
    ...props,
    className: chipVariants({ variant: "number" }),
  }, ref),
);
NumberChip.displayName = "NumberChip";

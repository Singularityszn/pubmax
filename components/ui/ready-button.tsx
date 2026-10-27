"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useClientReady } from "@/lib/useClientReady";

export const ReadyButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ disabled, ...props }, ref) => {
    const ready = useClientReady();
    return <button {...props} ref={ref} disabled={disabled || !ready} />;
  },
);
ReadyButton.displayName = "ReadyButton";

"use client";

import { Button } from "@/components/ui/button";

import "./detailLoadNotice.css";

type DetailLoadNoticeProps = {
  /** The sheet's honest line for a detail read that failed. */
  label: string;
  /** Re-asks `/api/venue/[id]` for the selected pub. */
  onRetry: () => void;
};

/** The venue sheet's notice when the full listing read fails: what the pin still shows, and a way to ask again. */
export default function DetailLoadNotice({ label, onRetry }: DetailLoadNoticeProps) {
  return (
    <div className="detailLoadNotice" role="status">
      <span>{label}</span>{" "}
      <Button type="button" variant="ghost" className="detailLoadNoticeRetry" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

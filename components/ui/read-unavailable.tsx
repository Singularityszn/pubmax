"use client";

import { Button } from "./button";
import EmptyState from "./empty-state";

export default function ReadUnavailable({ subject, onRetry, pending = false }: { subject: string; onRetry: () => void; pending?: boolean }) {
  return (
    <EmptyState
      title={`We couldn't check ${subject}.`}
      action={<Button type="button" variant="secondary" disabled={pending} aria-busy={pending} onClick={onRetry}>Retry</Button>}
    />
  );
}

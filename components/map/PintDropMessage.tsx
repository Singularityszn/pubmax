"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

import { PintDropAgeRecovery } from "@/components/map/PintDropAgeRecovery";
import ReceiptShareStep from "@/components/pintdrop/ReceiptShareStep";
import type { DropMsg } from "@/components/map/usePintDrops";

// The line a Pint Drop answers with, wherever the venue sheet shows it: the
// words, the age recovery, the next-step links and, for a saved public drop,
// the receipt to share.
export default function PintDropMessage({
  msg,
  onAgeAsserted,
  block = false,
}: {
  msg: DropMsg;
  onAgeAsserted: () => void;
  /** On its own line under the Log button, as the Pints tab shows it. */
  block?: boolean;
}) {
  return (
    <>
      <span
        role={msg.ok ? "status" : "alert"}
        className={`composerMsg ${msg.ok ? "ok" : "error"}`}
        style={block ? { display: "block", marginTop: "8px" } : undefined}
      >
        {msg.text}
        {msg.retry ? (
          <Button type="button" variant="secondary" onClick={() => { void msg.retry?.send(); }}>Retry</Button>
        ) : null}
        <PintDropAgeRecovery recovery={msg.ageRecovery} onAsserted={onAgeAsserted} />
        {msg.links && msg.links.length > 0 ? (
          <span className="composerMsgLinks">
            {msg.links.map((link) => (
              <Link key={link.href} href={link.href} className="composerMsgLink">
                {link.label}
              </Link>
            ))}
          </span>
        ) : null}
      </span>
      {msg.ok && msg.receipt ? <ReceiptShareStep key={msg.receipt.dropId} share={msg.receipt} /> : null}
    </>
  );
}
